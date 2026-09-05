import fs from 'node:fs';
import type { Plugin, ViteDevServer } from 'vite';
import { createFilter } from '@rollup/pluginutils';
import pc from 'picocolors';

import type { PluginOptions } from './types/config.js';
import type { Diagnostic } from './types/diagnostic.js';
import { resolvePluginConfig } from './config/index.js';
import { LeakDetectorEngine } from './core/engine.js';
import { extractSource } from './core/extractors/index.js';
import { builtinRules } from './rules/index.js';
import { dispatchReports } from './reporter/index.js';
import { consoleReporter } from './reporter/console.js';
import { BaselineManager } from './core/baseline.js';

export function memoryLeakDetectorPlugin(options: PluginOptions = {}): Plugin {
  const config = resolvePluginConfig(options);
  const filter = createFilter(config.include, config.exclude);

  const activeRules = [...builtinRules, ...config.customRules];
  config.customRules = activeRules;

  const engine = new LeakDetectorEngine(config);

  // Per-file diagnostic cache, keyed by the bare physical path. In `vite dev`,
  // Vite's own transform cache decides which files get re-analyzed; this map
  // holds the *latest* known diagnostics so summarize/buildEnd always see the
  // current state, whether or not Vite re-ran our transform hook.
  const diagnosticMap = new Map<string, Diagnostic[]>();
  let isBuild = false;

  const hasTerminalReport = () =>
    config.mode !== 'report-only' &&
    config.reports.some((r) => r.format === 'stylish' || r.format === 'default');

  const normalizedIdOf = (id: string) => id.split('?')[0];

  const isRelevant = (id: string) => filter(normalizedIdOf(id));

  // --- Terminal reporting -----------------------------------------------------
  // Real-time warnings are printed from the dev-server side (handleHotUpdate +
  // debounced summaries) instead of the `transform` hook. Vite aggressively
  // caches transformed modules, so relying on `transform` alone makes warnings
  // disappear on server restarts or cache hits. The debounced full summary
  // re-prints totals once a batch of changes settles.
  let summaryTimer: ReturnType<typeof setTimeout> | null = null;
  let printedSummaryKey = '';

  function scheduleFullSummary(delay = 1200) {
    if (summaryTimer) clearTimeout(summaryTimer);
    summaryTimer = setTimeout(() => {
      summaryTimer = null;
      printFullSummary();
    }, delay);
  }

  function printFullSummary() {
    if (!hasTerminalReport() || isBuild) return;
    if (diagnosticMap.size === 0) return;

    const allDiagnostics = Array.from(diagnosticMap.values()).flat();
    if (allDiagnostics.length === 0) return;

    const stateKey = Array.from(diagnosticMap.entries())
      .map(([file, diags]) => `${file}:${diags.length}`)
      .join('|');
    if (stateKey === printedSummaryKey) return;
    printedSummaryKey = stateKey;

    consoleReporter(allDiagnostics, undefined, { verbose: false });
  }

  /**
   * Re-analyzes a single changed source file (reading the current content from
   * disk) and prints a stylish terminal report for just that file. Used from
   * `handleHotUpdate` so warnings survive cases where Vite's transform cache
   * short-circuits our transform hook.
   */
  async function reportChangedFile(id: string) {
    const normalizedId = normalizedIdOf(id);
    if (!filter(normalizedId)) return;
    if (isBuild) return;

    let code: string;
    try {
      code = fs.readFileSync(normalizedId, 'utf8');
    } catch {
      return;
    }

    let extraction;
    try {
      extraction = await extractSource(normalizedId, code);
    } catch {
      return;
    }
    if (!extraction) return;

    const diagnostics = engine.analyze(normalizedId, code, extraction);
    if (diagnostics.length === 0) {
      diagnosticMap.delete(normalizedId);
      return;
    }

    diagnosticMap.set(normalizedId, diagnostics);

    if (!hasTerminalReport()) return;
    consoleReporter(diagnostics, code);
  }

  return {
    name: 'vite-plugin-memory-leak-detector',
    // 'pre' ensures we get the raw source code before transpilers like Babel or SWC mangle it
    enforce: 'pre',

    // 1. Determine operating mode (dev vs build)
    configResolved(viteConfig) {
      isBuild = viteConfig.command === 'build';
    },

    // 2. Dev-server lifecycle: keep the cache tidy, refresh totals when a batch
    // of changes settles, and surface an initial summary after a restart even if
    // the changed files were served from Vite's transform cache.
    configureServer(server: ViteDevServer) {
      server.watcher.on('all', (event, id) => {
        const path = String(id);
        const normalizedId = normalizedIdOf(path);

        if (event === 'unlink' || event === 'unlinkDir') {
          // Filesystem events never carry query strings; normalize so the key
          // matches the keys written by `transform` / `reportChangedFile`.
          diagnosticMap.delete(normalizedId);
        }

        if (isRelevant(path)) {
          scheduleFullSummary();
        }
      });

      // After a fresh `vite dev` start (or a server restart followed by a page
      // reload), the initial transforms re-populate the map. Once things quiet
      // down, print the full summary so warnings reappear in the terminal even
      // when individual modules were served from cache.
      scheduleFullSummary(1500);
    },

    // 3. Process each file
    buildStart() {
      // A fresh build/serve cycle begins; drop any pending dev-mode summary
      // timers and allow summaries to re-print for the new batch of files.
      if (summaryTimer) {
        clearTimeout(summaryTimer);
        summaryTimer = null;
      }
      printedSummaryKey = '';
    },

    async transform(code, id) {
      // Virtual modules (e.g. `App.vue?vue&type=script`, `App.ts?raw`) are
      // slices of their primary file and are already covered by this primary
      // transform. The cache is keyed by the bare physical path so each file
      // holds exactly one entry and HMR updates/unlinks never leak or wipe it.
      const normalizedId = normalizedIdOf(id);
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

      // Schedule a debounced full summary so a freshly-loaded page (or an HMR
      // refresh) prints its warnings once the module graph quiets down. Dev-only
      // — build reporting is handled once in buildEnd.
      if (hasTerminalReport() && !isBuild) {
        scheduleFullSummary();
      }

      // We do not mutate the code; this is purely an analysis plugin.
      return null;
    },

    // 4. Live per-file reporting on HMR updates. This runs for a watched source
    // file whenever it changes during `vite dev` — regardless of whether the
    // transform hook fires — so memory leak warnings never disappear from the
    // terminal due to Vite caching transformed output.
    async handleHotUpdate(ctx) {
      const { file } = ctx;
      reportChangedFile(file);
      return undefined;
    },

    // 5. Summarize, report, and assert thresholds at the end of the build
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

      // Dispatch structured reports (HTML, SARIF, Markdown, JSON, stylish)
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