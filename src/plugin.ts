import type { Plugin } from 'vite';
import { createFilter } from '@rollup/pluginutils';
import type { PluginOptions } from './types/config.js';
import type { Diagnostic } from './types/diagnostic.js';
import { LeakDetectorEngine } from './core/engine.js';
import { extractSource } from './core/extractors/index.js';
import { builtinRules } from './rules/index.js';
import { rollupReporter } from './reporter/rollup.js';
import { dispatchReporter } from './reporter/index.js';

/**
 * Vite plugin factory for memory leak detection.
 */
export function memoryLeakDetectorPlugin(options: PluginOptions = {}): Plugin {
  const filter = createFilter(
    options.include || /\.[jt]sx?$|\.vue$|\.svelte$/,
    options.exclude || /node_modules/
  );

  const failOnError = options.failOnError ?? false;
  const reporterType = options.reporter ?? 'stylish';
  const verbose = options.verbose ?? false;

  const activeRules = [...builtinRules, ...(options.customRules ?? [])];
  const engine = new LeakDetectorEngine({
    customRules: activeRules,
    ruleConfig: options.rules,
    verbose,
  });

  // Register each rule's default severity on the engine so overrides resolve correctly.
  for (const rule of activeRules) {
    engine.setDefaultSeverity(rule.id, rule.defaultSeverity);
  }

  return {
    name: 'vite-plugin-memory-leak-detector',
    enforce: 'pre',

    buildStart() {
      // Nothing to initialize; kept for symmetry and future caching.
    },

    transform(code, id) {
      if (!filter(id)) return null;

      const extraction = extractSource(id, code);
      if (!extraction) return null;

      const diagnostics: Diagnostic[] = engine.analyze(id, code, extraction);

      if (diagnostics.length === 0) return null;

      // If JSON reporter is selected, print to stdout instead of emitting
      // individual warnings (typically used for CI tooling).
      if (reporterType === 'json') {
        dispatchReporter(reporterType, diagnostics, { file: id, sourceCode: code, verbose });
      } else if (reporterType === 'stylish' || reporterType === 'default') {
        // Forward error/warn diagnostics to Rollup's context for normal
        // Vite terminal integration.
        const errorDiagnostics = diagnostics.filter((d) => d.severity === 'error');
        const warnDiagnostics = diagnostics.filter((d) => d.severity === 'warn');

        rollupReporter(this, [...warnDiagnostics, ...errorDiagnostics], failOnError);
      }

      // We do not modify the code; this is a read-only analyzer.
      return null;
    },
  };
}
