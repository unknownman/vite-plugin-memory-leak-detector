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
  let emittedViaRollup = false;

  return {
    name: 'vite-plugin-memory-leak-detector',
    // 'pre' ensures we get the raw source code before transpilers like Babel or SWC mangle it
    enforce: 'pre',

    // 1. Determine operating mode (dev vs build)
    configResolved(viteConfig) {
      isBuild = viteConfig.command === 'build';
    },

    buildStart() {
      emittedViaRollup = false;
    },

    // 2. Clean up cache on file deletion during dev mode
    configureServer(server: ViteDevServer) {
      server.watcher.on('unlink', (id) => {
        // Filesystem events never carry query strings; normalize so the key
        // matches the keys written by `transform` below.
        diagnosticMap.delete(id.split('?')[0]);
      });
    },

    // 3. Process each file
    async transform(code, id) {
      // Virtual modules (e.g. `App.vue?vue&type=script`, `App.ts?raw`) are
      // slices of their primary file and are already covered by this primary
      // transform. The cache is keyed by the bare physical path so each file
      // holds exactly one entry and HMR updates/unlinks never leak or wipe it.
      const normalizedId = id.split('?')[0];
      if (!filter(normalizedId)) return null;
      if (normalizedId !== id) return null;

      const extraction = await extractSource(normalizedId, code);
      if (!extraction) return null;

      const diagnostics = engine.analyze(normalizedId, code, extraction);

      // Update cache
      if (diagnostics.length === 0) {
        diagnosticMap.delete(normalizedId);
        return null;
      }

      diagnosticMap.set(normalizedId, diagnostics);

      // Real-time terminal/browser reporting
      if (config.mode !== 'report-only') {
        const hasTerminalReport = config.reports.some(
          (r) => r.format === 'stylish' || r.format === 'default'
        );

        if (hasTerminalReport) {
          // Never call context.error() during transform — it fatally aborts the
          // module chain. Emit everything as warnings here; the build is only
          // failed via context.error() in buildEnd when thresholds are exceeded.
          rollupReporter(this, diagnostics);
          emittedViaRollup = true;
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

      // Only dispatch terminal/stylish reports if they were NOT already emitted via rollupReporter,
      // and skip them in dev mode since Vite outputs warnings during HMR transforms.
      const shouldSkipTerminalReports = emittedViaRollup || !isBuild;
      const reportsToDispatch = shouldSkipTerminalReports
        ? config.reports.filter((r) => r.format !== 'stylish' && r.format !== 'default')
        : config.reports;

      // Dispatch structured reports (HTML, SARIF, Markdown, JSON)
      dispatchReports(allDiagnostics, reportsToDispatch, config.outputDir);

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
