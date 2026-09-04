import type { Plugin } from 'vite';
import { createFilter } from '@rollup/pluginutils';
import type { PluginOptions } from './types/config.js';
import type { Diagnostic } from './types/diagnostic.js';
import { resolvePluginConfig } from './config/index.js';
import { LeakDetectorEngine } from './core/engine.js';
import { extractSource } from './core/extractors/index.js';
import { builtinRules } from './rules/index.js';
import { rollupReporter } from './reporter/rollup.js';
import { dispatchReports } from './reporter/index.js';
import { BaselineManager } from './core/baseline.js';

export function memoryLeakDetectorPlugin(options: PluginOptions = {}): Plugin {
  const config = resolvePluginConfig(options);
  const filter = createFilter(config.include, config.exclude);

  const activeRules = [...builtinRules, ...config.customRules];
  config.customRules = activeRules;

  const engine = new LeakDetectorEngine(config);
  const collectedDiagnostics: Diagnostic[] = [];

  return {
    name: 'vite-plugin-memory-leak-detector',
    enforce: 'pre',

    transform(code, id) {
      if (!filter(id)) return null;

      const extraction = extractSource(id, code);
      if (!extraction) return null;

      const diagnostics = engine.analyze(id, code, extraction);
      if (diagnostics.length === 0) return null;

      collectedDiagnostics.push(...diagnostics);

      // In report-only mode, skip terminal diagnostics during compilation
      if (config.mode !== 'report-only') {
        const consoleReports = config.reports.filter(
          (r) => r.format === 'stylish' || r.format === 'default'
        );
        if (consoleReports.length > 0) {
          rollupReporter(this, diagnostics, config.mode === 'error');
        }
      }

      return null;
    },

    buildEnd() {
      // 1. Record baseline if requested
      if (config.baseline.enabled && config.baseline.update) {
        const baselineManager = new BaselineManager(config.baseline.path);
        baselineManager.updateBaseline(collectedDiagnostics);
        console.log(`[vite-plugin-memory-leak-detector] Recorded ${collectedDiagnostics.length} leak(s) to ${config.baseline.path}`);
      }

      // 2. Dispatch all structured report outputs (HTML, Markdown, SARIF, JSON)
      dispatchReports(collectedDiagnostics, config.reports, config.outputDir);

      // 3. Evaluate thresholds & mode constraints
      if (config.mode !== 'report-only') {
        const errors = collectedDiagnostics.filter((d) => d.severity === 'error').length;
        const warnings = collectedDiagnostics.filter((d) => d.severity === 'warn').length;
        const total = collectedDiagnostics.length;

        const { maxErrors, maxWarnings, maxTotal } = config.thresholds;

        if (errors > maxErrors) {
          this.error(`Memory leak error threshold exceeded: ${errors} errors found (limit: ${maxErrors}).`);
        }
        if (warnings > maxWarnings) {
          this.error(`Memory leak warning threshold exceeded: ${warnings} warnings found (limit: ${maxWarnings}).`);
        }
        if (total > maxTotal) {
          this.error(`Total memory leak threshold exceeded: ${total} issues found (limit: ${maxTotal}).`);
        }
      }
    },
  };
}
