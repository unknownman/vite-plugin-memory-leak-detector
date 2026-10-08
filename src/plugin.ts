import fs from 'node:fs';
import { createHash } from 'node:crypto';
import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite';
import { createFilter } from '@rollup/pluginutils';
import pc from 'picocolors';

import type { PluginOptions } from './types/config.js';
import type { Diagnostic } from './types/diagnostic.js';
import type { ExtractionResult } from './types/rule.js';
import { resolvePluginConfig } from './config/index.js';
import { LeakDetectorEngine } from './core/engine.js';
import { extractSource } from './core/extractors/index.js';
import { builtinRules } from './rules/index.js';
import { dispatchReports } from './reporter/index.js';
import { consoleReporter } from './reporter/console.js';

export function memoryLeakDetectorPlugin(options: PluginOptions = {}): Plugin {
  const config = resolvePluginConfig(options);
  const filter = createFilter(config.include, config.exclude);

  const activeRules = [...builtinRules, ...config.customRules];
  config.customRules = activeRules;

  const engine = new LeakDetectorEngine(config);

  // Per-environment diagnostic cache. Key is `${environmentName}::${file}`:
  // under the Environment API a single file can be transformed once per
  // environment (client + ssr), and collapsing them would either double-report
  // or drop findings. When there is no environment (Vite 4/5) the name is
  // empty and this behaves like the previous file-keyed map.
  const diagnosticMap = new Map<string, Diagnostic[]>();
  let isBuild = false;

  // 3.1 `transform` and `reportChangedFile` can both fire for the same edit, so
  // the analysis result is cached by (file, content) and reused. The cache is
  // bounded to avoid growing for the lifetime of a long dev session.
  const ANALYSIS_CACHE_LIMIT = 500;
  const analysisCache = new Map<string, Diagnostic[]>();
  const analysisCacheKey = (file: string, content: string): string =>
    `${file}\u0000${createHash('sha1').update(content).digest('hex')}`;

  function analyzeCached(file: string, code: string, extraction?: ExtractionResult): Diagnostic[] {
    const key = analysisCacheKey(file, code);
    const hit = analysisCache.get(key);
    if (hit) return hit;

    const diagnostics = engine.analyze(file, code, extraction);
    if (analysisCache.size >= ANALYSIS_CACHE_LIMIT) {
      // Drop the oldest entry; Map preserves insertion order.
      const oldest = analysisCache.keys().next().value;
      if (oldest !== undefined) analysisCache.delete(oldest);
    }
    analysisCache.set(key, diagnostics);
    return diagnostics;
  }

  // Vite's own logger, so `--logLevel` and `clearScreen` are respected. Falls
  // back to the console until `configResolved` supplies the real one.
  let viteLogger: ResolvedConfig['logger'] | undefined;
  const logInfo = (msg: string) => (viteLogger ? viteLogger.info(msg) : console.log(msg));
  const logWarn = (msg: string) => (viteLogger ? viteLogger.warn(msg) : console.warn(msg));
  const logError = (msg: string) => (viteLogger ? viteLogger.error(msg) : console.error(msg));

  // Project root from the resolved Vite config; `process.cwd()` is only a
  // fallback for the window before `configResolved` runs.
  let root = process.cwd();

  const hasTerminalReport = () =>
    config.mode !== 'report-only' &&
    config.reports.some((r) => r.format === 'stylish' || r.format === 'default');

  const normalizedIdOf = (id: string) => id.split('?')[0];

  const isRelevant = (id: string) => filter(normalizedIdOf(id));

  /**
   * Vite 6+ exposes the active environment on the plugin context; Vite 4/5 do
   * not. The unnamed case is canonicalized to `'client'` so one file analyzed
   * through hooks with and without an environment (e.g. `hotUpdate` then the
   * legacy `handleHotUpdate`) lands in the same bucket instead of being
   * tracked — and printed — twice.
   */
  const environmentNameOf = (ctx: unknown): string => {
    const name = (ctx as { environment?: { name?: string } } | undefined)?.environment?.name;
    return name ?? 'client';
  };

  const cacheKeyOf = (ctx: unknown, file: string): string =>
    `${environmentNameOf(ctx)}\u0000${file}`;

  /**
   * 3.3 The same file can be analyzed once per environment, which would repeat
   * identical findings. Collapse anything that matches on file, rule and
   * position, and drop exact fingerprint duplicates outright.
   *
   * The fingerprint is only a dedup key when it exists: two distinct
   * diagnostics without one must not collide on an empty key.
   */
  function dedupeDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
    const seen = new Set<string>();
    const out: Diagnostic[] = [];
    for (const d of diagnostics) {
      if (d.fingerprint !== undefined && seen.has(`fp:${d.fingerprint}`)) continue;
      const key = `${d.file}|${d.ruleId}|${d.line}|${d.column}|${d.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (d.fingerprint !== undefined) seen.add(`fp:${d.fingerprint}`);
      out.push(d);
    }
    return out;
  }

  // --- Terminal reporting -----------------------------------------------------
  // Real-time warnings are printed from the dev-server side (handleHotUpdate +
  // debounced summaries) instead of the `transform` hook. Vite aggressively
  // caches transformed modules, so relying on `transform` alone makes warnings
  // disappear on server restarts or cache hits. The debounced full summary
  // re-prints totals once a batch of changes settles.
  let summaryTimer: ReturnType<typeof setTimeout> | null = null;
  let printedSummaryKey = '';

  // 3.2 The fingerprint set last printed per (environment, file). Several hooks
  // can observe one edit, so without this the same report is printed twice.
  const printedFileState = new Map<string, string>();
  const stateOf = (diagnostics: Diagnostic[]): string =>
    diagnostics
      .map((d) => d.fingerprint ?? `${d.file}|${d.ruleId}|${d.line}|${d.column}|${d.message}`)
      .sort()
      .join('|');

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

    // Collapse the per-environment copies of one file before summarizing, so a
    // file analyzed for both client and ssr counts — and prints — once.
    const allDiagnostics = dedupeDiagnostics(Array.from(diagnosticMap.values()).flat());
    if (allDiagnostics.length === 0) return;

    // 3.6 Key on the sorted fingerprint list, not per-file counts: swapping one
    // leak for another in the same file leaves the counts unchanged but changes
    // the fingerprint set, so the replacement still reprints.
    const stateKey = allDiagnostics
      .map((d) => d.fingerprint ?? `${d.file}|${d.ruleId}|${d.line}|${d.column}|${d.message}`)
      .sort()
      .join('|');
    if (stateKey === printedSummaryKey) return;
    printedSummaryKey = stateKey;

    consoleReporter(allDiagnostics, undefined, { verbose: false, root, write: logInfo });
  }

  /**
   * Re-analyzes a single changed source file (reading the current content from
   * disk) and prints a stylish terminal report for just that file. Used from
   * `handleHotUpdate` so warnings survive cases where Vite's transform cache
   * short-circuits our transform hook.
   */
  async function reportChangedFile(id: string, ctx?: unknown) {
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

    const key = cacheKeyOf(ctx, normalizedId);
    const diagnostics = analyzeCached(normalizedId, code, extraction);
    if (diagnostics.length === 0) {
      diagnosticMap.delete(key);
      printedFileState.delete(key);
      return;
    }

    diagnosticMap.set(key, diagnostics);

    // Already reported this exact set of findings for this file.
    const state = stateOf(diagnostics);
    if (printedFileState.get(key) === state) return;
    printedFileState.set(key, state);

    if (!hasTerminalReport()) return;
    consoleReporter(diagnostics, code, { root, write: logInfo });
  }

  const plugin: Plugin = {
    name: 'vite-plugin-memory-leak-detector',
    // 'pre' ensures we get the raw source code before transpilers like Babel or SWC mangle it
    enforce: 'pre',

    // 1. Determine operating mode (dev vs build) and project root
    configResolved(viteConfig) {
      isBuild = viteConfig.command === 'build';
      viteLogger = viteConfig.logger;
      root = viteConfig.root ?? process.cwd();
      // Fingerprints and the baseline path must be relative to the Vite project
      // root, not to whatever directory the CLI was launched from.
      engine.setRoot(root);
    },

    // 2. Dev-server lifecycle: keep the cache tidy, refresh totals when a batch
    // of changes settles, and surface an initial summary after a restart even if
    // the changed files were served from Vite's transform cache.
    configureServer(server: ViteDevServer) {
      server.watcher.on('all', (event, id) => {
        const path = String(id);
        const normalizedId = normalizedIdOf(path);

        if (event === 'unlink' || event === 'unlinkDir') {
          // Filesystem events never carry query strings, and carry no
          // environment either — drop every environment's entry for the file.
          for (const key of Array.from(diagnosticMap.keys())) {
            if (key.endsWith(`\u0000${normalizedId}`)) diagnosticMap.delete(key);
          }
          for (const key of Array.from(printedFileState.keys())) {
            if (key.endsWith(`\u0000${normalizedId}`)) printedFileState.delete(key);
          }
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

      // In build/watch mode nothing clears the map between rebuilds, so entries
      // from a previous pass would be re-reported as if still present. Dev keeps
      // its map: there the entries are the current state of the module graph.
      //
      // Only the current environment's bucket is dropped: a multi-environment
      // build (client + ssr + ...) runs this hook once per environment, and a
      // full clear here would make the last environment's pass erase every
      // earlier one's findings. `buildEnd` then reports the cumulative union.
      if (isBuild) {
        const prefix = `${environmentNameOf(this)}\u0000`;
        for (const key of Array.from(diagnosticMap.keys())) {
          if (key.startsWith(prefix)) diagnosticMap.delete(key);
        }
        for (const key of Array.from(printedFileState.keys())) {
          if (key.startsWith(prefix)) printedFileState.delete(key);
        }
        analysisCache.clear();
      }
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

      const key = cacheKeyOf(this, normalizedId);
      const diagnostics = analyzeCached(normalizedId, code, extraction);

      // Update cache
      if (diagnostics.length === 0) {
        diagnosticMap.delete(key);
        printedFileState.delete(key);
        return null;
      }

      diagnosticMap.set(key, diagnostics);
      printedFileState.set(key, stateOf(diagnostics));

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
    //
    // Vite 6+ calls `hotUpdate` (Environment API); Vite 4/5 call
    // `handleHotUpdate`. Some versions can dispatch both for one edit, so
    // `reportChangedFile` de-duplicates on the (file, content) hash: the second
    // call reuses the cached analysis and finds nothing new to print.
    async handleHotUpdate(ctx) {
      reportChangedFile(ctx.file, this);
      return undefined;
    },

    // 5. Summarize, report, and assert thresholds at the end of the build
    buildEnd(error) {
      // Only run the heavy summary during a full build, unless the build already failed
      if (!isBuild || error) return;

      // Collapse per-environment duplicates so a file transformed for both
      // client and SSR is reported (and counted toward thresholds) once.
      const allDiagnostics = dedupeDiagnostics(Array.from(diagnosticMap.values()).flat());

      // Write baseline if requested
      if (config.baseline.enabled && config.baseline.update) {
        const baselineManager = engine.getBaselineManager();
        baselineManager?.updateBaseline(allDiagnostics);
        logInfo(
          pc.green(
            `\n[vite-plugin-memory-leak-detector] Recorded ${allDiagnostics.length} leak(s) to ${config.baseline.path}`
          )
        );
      }

      // Dispatch structured reports (HTML, SARIF, Markdown, JSON, stylish)
      dispatchReports(allDiagnostics, config.reports, config.outputDir, undefined, root, logInfo);

      if (config.mode === 'report-only') {
        logInfo(
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

        logInfo(summary);
      } else {
        logInfo(pc.green(`\n[vite-plugin-memory-leak-detector] Clean run! No memory leaks detected. 🎉\n`));
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

  // 3.2 `hotUpdate` is the Vite 6+ Environment API equivalent of
  // `handleHotUpdate`. It is absent from the Vite 5 `Plugin` type and is never
  // called there, so it is attached after the typed literal rather than
  // widening the hook table to `Record<string, unknown>`.
  (plugin as unknown as Record<string, unknown>).hotUpdate = async function hotUpdate(this: unknown, ctx: any) {
    const files: string[] = Array.isArray(ctx?.modules)
      ? ctx.modules.map((m: any) => m?.file ?? m?.id).filter(Boolean)
      : ctx?.file
        ? [ctx.file]
        : [];
    for (const file of files) {
      await reportChangedFile(file, this);
    }
    return undefined;
  };

  return plugin;
}
