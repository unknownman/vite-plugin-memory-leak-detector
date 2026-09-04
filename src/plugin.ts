import type { Plugin, ViteDevServer } from 'vite';
import { createFilter } from '@rollup/pluginutils';
import pc from 'picocolors';

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

  // Per-file diagnostic cache. In `vite dev`, Vite's transform cache ensures
  // only changed files get re-analyzed — this map cleanly replaces old state
  // without running a full project scan.
  const diagnosticMap = new Map<string, Diagnostic[]>();
  let isBuild = false;

  return {
    name: 'vite-plugin-memory-leak-detector',
    // 'pre' ensures we get the raw source code before transpilers like Babel or SWC mangle it
    enforce: 'pre',

    // 1. Determine operating mode (dev vs build)
    configResolved(viteConfig) {
      isBuild = viteConfig.command === 'build';
    },

    // 2. Clean up cache on file deletion during dev mode
    configureServer(server: ViteDevServer) {
      server.watcher.on('unlink', (id) => {
        diagnosticMap.delete(id);
      });
    },

    // 3. Process each file
    transform(code, id) {
      if (!filter(id)) return null;

      const extraction = extractSource(id, code);
      if (!extraction) return null;

      const diagnostics = engine.analyze(id, code, extraction);

      // Update cache
      if (diagnostics.length === 0) {
        diagnosticMap.delete(id);
        return null;
      }

      diagnosticMap.set(id, diagnostics);

      // Real-time terminal/browser reporting
      if (config.mode !== 'report-only') {
        const hasTerminalReport = config.reports.some(
          (r) => r.format === 'stylish' || r.format === 'default'
        );

        if (hasTerminalReport) {
          // In DEV mode, if mode is 'error', trigger Vite's red error overlay immediately.
          // In BUILD mode, defer fatal errors until `buildEnd` so the developer sees
          // a full list of all leaks rather than crashing on the very first file.
          const triggerImmediateFatalError = config.mode === 'error' && !isBuild;
          rollupReporter(this, diagnostics, triggerImmediateFatalError);
        }
      }

      // We do not mutate the code; this is purely an analysis plugin.
      return null;
    },

    // 4. Summarize, report, and assert thresholds at the end of the build
    buildEnd(error) {
      // Only run the heavy summary during a full build, unless the build already failed
      if (!isBuild || error) return;

      const allDiagnostics = Array.from(diagnosticMap.values()).flat();

      // Write baseline if requested
      if (config.baseline.enabled && config.baseline.update) {
        const baselineManager = new BaselineManager(config.baseline.path);
        baselineManager.updateBaseline(allDiagnostics);
        console.log(
          pc.green(
            `\n[vite-plugin-memory-leak-detector] Recorded ${allDiagnostics.length} leak(s) to ${config.baseline.path}`
          )
        );
      }

      // Dispatch structured reports (HTML, SARIF, Markdown, JSON)
      dispatchReports(allDiagnostics, config.reports, config.outputDir);

      if (config.mode === 'report-only') {
        console.log(
          pc.blue(
            `\n[vite-plugin-memory-leak-detector] Analyzed ${diagnosticMap.size} files. Report-only mode active, thresholds ignored.`
          )
        );
        return;
      }

      const errors = allDiagnostics.filter((d) => d.severity === 'error').length;
      const warnings = allDiagnostics.filter((d) => d.severity === 'warn').length;
      const total = allDiagnostics.length;

      // Beautiful terminal summary
      if (total > 0) {
        const summary = [
          pc.bold('\n🛡️  Memory Leak Summary'),
          `  ${pc.red('✖ ' + errors + ' errors')}`,
          `  ${pc.yellow('⚠ ' + warnings + ' warnings')}`,
          `  ${pc.cyan('ℹ ' + total + ' total issues')}`,
          '',
        ].join('\n');

        console.log(summary);
      } else {
        console.log(pc.green(`\n[vite-plugin-memory-leak-detector] Clean run! No memory leaks detected. 🎉\n`));
      }

      // Evaluate thresholds
      const { maxErrors, maxWarnings, maxTotal } = config.thresholds;
      const failures: string[] = [];

      if (errors > maxErrors) {
        failures.push(`Error threshold exceeded: ${errors} errors found (limit: ${maxErrors}).`);
      }
      if (warnings > maxWarnings) {
        failures.push(`Warning threshold exceeded: ${warnings} warnings found (limit: ${maxWarnings}).`);
      }
      if (total > maxTotal) {
        failures.push(`Total issue threshold exceeded: ${total} issues found (limit: ${maxTotal}).`);
      }

      // Fail the build if any thresholds are broken
      if (failures.length > 0) {
        const errorMsg =
          pc.red('\n🚨 Memory Leak Detection Failed:\n') +
          failures.map((f) => pc.red(`  - ${f}`)).join('\n');

        this.error(errorMsg);
      }
    },
  };
}
