# vite-plugin-memory-leak-detector

A Vite plugin that detects potential memory leaks in your frontend code at build time using AST-based static analysis.

## Features
- 🚀 **Fast**: Runs efficiently during the Vite transform phase using the OXC Rust parser (ESTree AST).
- 🧩 **Extensible**: Pluggable rule system with generic and framework-specific rules (React, Vue, Svelte, Solid).
- 🛡 **Type Safe**: Fully written in strict TypeScript.
- 🔍 **SFC Aware**: Extracts `<script>` / `<script setup>` blocks from Vue `.vue` and Svelte `.svelte` files with accurate line/column reporting.
- 🚨 **Vite Integration**: Emits diagnostics through Vite's terminal output, including file, line, and column locations.
- 🎚 **Modes**: `warn`, `error`, or `report-only` operating modes.
- 🚦 **Thresholds**: Fail the build when warning/error/total counts exceed limits.
- 💬 **Comment Directives**: Suppress rules inline (`// vite-leak-disable-next-line`).
- 📦 **Baselines**: Fix known issues once and ignore them going forward.
- 🎨 **Reporting**: Stylish codeframes, JSON, SARIF, HTML, and Markdown reports.

## Installation

```bash
npm install vite-plugin-memory-leak-detector -D
# or
yarn add vite-plugin-memory-leak-detector -D
# or
pnpm add vite-plugin-memory-leak-detector -D
```

## Usage

Add the plugin to your `vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import memoryLeakDetector from 'vite-plugin-memory-leak-detector';

export default defineConfig({
  plugins: [
    memoryLeakDetector({
      // Operating mode: 'warn' | 'error' | 'report-only'
      mode: 'warn',
    })
  ]
});
```

## Configuration Options

| Option | Type | Default | Description |
|---|---|---|---|
| `mode` | `'warn' \| 'error' \| 'report-only'` | `'warn'` | Operating mode. `'error'` emits errors and fails when thresholds are exceeded; `'report-only'` writes reports without failing/blowing up the build. |
| `frameworks` | `'auto' \| ('react'\|'vue'\|'svelte'\|'solid')[]` | `'auto'` | Frameworks to analyze. `'auto'` runs all rules. Generic rules always run. |
| `thresholds.maxWarnings` | `number` | `Infinity` | Max warnings before failing the build. |
| `thresholds.maxErrors` | `number` | `0` in `error` mode, `Infinity` otherwise | Max errors before failing the build. |
| `thresholds.maxTotal` | `number` | `Infinity` | Max total diagnostics before failing the build. |
| `include` | `FilterPattern` | `/\.[jt]sx?$\|\.vue$\|\.svelte$/` | Files to analyze. |
| `exclude` | `FilterPattern` | `/node_modules/` | Files to ignore. |
| `rules` | `RuleSeverityConfig` | `{}` | Per-rule severity overrides (`'error' \| 'warn' \| 'info' \| 'off'`). |
| `ignores` | `IgnoreConfig` | `[]` | Advanced glob-based ignore system for files and specific rules. |
| `allowlist.functions` | `string[]` | `[]` | Function names to skip (e.g., hooks that auto-clean their own timers). |
| `allowlist.methods` | `string[]` | `[]` | Object method names to skip (e.g., safe wrappers that clean up internally). |
| `customRules` | `RuleDefinition[]` | `[]` | Custom rules to extend detection capabilities. |
| `comments.enabled` | `boolean` | `true` | Enable inline suppression comments. |
| `comments.prefix` | `string` | `'memory-leak'` | Directive prefix. |
| `baseline` | `string \| BaselineConfig` | `undefined` | Baseline file path or config to ignore known issues. |
| `reports` | `ReportFormat \| (ReportFormat \| ReportDestination)[]` | `'stylish'` | Report formats/destinations: `'stylish'`, `'json'`, `'sarif'`, `'html'`, `'markdown'`. |
| `outputDir` | `string` | `'.leak-reports'` | Directory for file-based reports. |
| `verbose` | `boolean` | `false` | Enable verbose debugging logs. |

## Operating Modes

```typescript
// Fail the build on any error-level diagnostic
memoryLeakDetector({ mode: 'error' });

// Emit warnings, but fail if thresholds are exceeded
memoryLeakDetector({
  mode: 'warn',
  thresholds: { maxWarnings: 100, maxErrors: 0 },
});

// Never fail, just write reports (great for CI artifact generation)
memoryLeakDetector({
  mode: 'report-only',
  reports: ['json', 'sarif', 'html', 'markdown'],
});
```

## Inline Comment Directives

Suppress diagnostics inline using comments. The default prefix is `memory-leak`.

```typescript
// memory-leak-ignore-next-line generic/no-uncleared-timers
const timer = setInterval(() => {}, 1000);

window.addEventListener('click', h); // memory-leak-ignore-line

// memory-leak-ignore (ignores the entire file)
setInterval(() => {}, 1000);

/* memory-leak-ignore-start */
window.addEventListener('click', h);
/* memory-leak-ignore-end */
```

Each directive can optionally target specific rules (comma or space separated). An omitted rule list ignores **all** rules.

```typescript
// memory-leak-ignore-next-line generic/no-uncleared-timers, generic/no-unregistered-listeners
const timer = setInterval(() => {}, 1000);

/* memory-leak-ignore-start generic/no-unregistered-listeners */
window.addEventListener('click', h);
/* memory-leak-ignore-end */
```

Customize the prefix:

```typescript
memoryLeakDetector({ comments: { prefix: 'myleak' } });
// now supports: // myleak-ignore-next-line ...
```

## Ignore & Allowlist

Control detection with a multi-layered filtering system.

### Glob-based file/rule ignores

Skip entire files, or specific rules for specific files, using glob patterns. Because Vite passes absolute paths to the analyzer, prefix patterns with `**/` to match files reliably.

```typescript
memoryLeakDetector({
  ignores: [
    // Skip test directories entirely (all rules)
    '**/*.test.{ts,tsx}',
    '**/*.spec.{ts,tsx}',
    // Skip specific rules for legacy code
    { glob: '**/src/legacy/**/*.js', rules: ['generic/no-unregistered-listeners'] },
    // Skip multiple rules for multiple globs
    { glob: ['**/dist/**', '**/generated/**'], rules: ['generic/no-unsubscribed-events'] },
  ],
});
```

### Function / method allowlist

Bypass detection for functions and methods that are known to clean up after themselves (e.g., your own hook that wraps `setInterval` and clears it on unmount).

```typescript
memoryLeakDetector({
  allowlist: {
    // Ignore global function names
    functions: ['useInterval'],
    // Ignore object method names (e.g., safe wrappers)
    methods: ['subscribeSafe', 'onCustomEvent'],
  },
});
```

## Baselines

Fix known issues once, then ignore them going forward using a baseline file.

```typescript
// First: record the current leaks into a baseline
memoryLeakDetector({
  baseline: { path: '.leak-baseline.json', update: true },
});
```

```typescript
// Later: only NEW leaks are reported; baselined ones are ignored
memoryLeakDetector({ baseline: '.leak-baseline.json' });
```

## Reports

The plugin can emit structured reports in multiple formats:

```typescript
memoryLeakDetector({
  reports: [
    { format: 'html', outputFile: 'build/leak-report.html' },
    'sarif',
    'markdown',
    'stylish',
  ],
  outputDir: '.leak-reports',
});
```

Supported formats: `'stylish'` (terminal), `'default'` (terminal), `'json'`, `'sarif'`, `'html'`, `'markdown'`.

## Built-in Rules

| Rule ID | Category | Default Severity | Description |
|---|---|---|---|
| `generic/no-uncleared-timers` | generic | `warn` | Detects `setInterval` / `setTimeout` calls whose timer handle is never cleared. |
| `generic/no-unregistered-listeners` | generic | `warn` | Detects `addEventListener` calls without a matching `removeEventListener`. |
| `generic/no-unconnected-observers` | generic | `warn` | Detects `IntersectionObserver` / `MutationObserver` / `ResizeObserver` instances that are created but never disconnected. |
| `generic/no-unsubscribed-events` | generic | `warn` | Detects reactive subscriptions via `.subscribe()` / `.on()` without a matching `.unsubscribe()` / `.off()`. |
| `react/react-useeffect-cleanup` | react | `error` | Detects `useEffect` / `useLayoutEffect` callbacks that create subscriptions, timers, or listeners without returning a cleanup function. |

## Severity Overrides

```typescript
memoryLeakDetector({
  rules: {
    'generic/no-uncleared-timers': 'error',   // promote to error
    'react/react-useeffect-cleanup': 'warn',  // demote to warning
    'generic/no-unregistered-listeners': 'off', // disable
  },
});
```

## Writing Custom Rules

Custom rules are plain objects with a `create(context)` method that returns an ESTree visitor. Each handler receives the AST `node` and its `parent`. Use `context.report(...)` to emit diagnostics.

```typescript
import { defineConfig } from 'vite';
import memoryLeakDetector, { type RuleDefinition } from 'vite-plugin-memory-leak-detector';

const unsubscribedRxJsRule: RuleDefinition = {
  id: 'generic/unsubscribed-rxjs',
  description: 'Checks for missing unsubscribe calls.',
  category: 'generic',
  defaultSeverity: 'warn',
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type === 'MemberExpression' && callee.property.name === 'subscribe') {
          context.report({
            ruleId: 'generic/unsubscribed-rxjs',
            message: 'RxJS subscription created without unsubscribing.',
            suggestion: 'Store the subscription and call unsubscribe on unmount.',
            severity: 'warn',
            line: node.loc?.start.line ?? 1,
            column: node.loc?.start.column ?? 0,
          });
        }
      },
    };
  },
};

export default defineConfig({
  plugins: [memoryLeakDetector({ customRules: [unsubscribedRxJsRule] })],
});
```

## Architecture

```
src/
├── index.ts                  # Main entry point & default export
├── plugin.ts                 # Vite plugin lifecycle hooks (transform, buildEnd)
├── config/
│   ├── index.ts              # resolvePluginConfig
│   ├── defaults.ts           # DEFAULT_CONFIG
│   └── validator.ts          # Options validation
├── types/                    # TypeScript interfaces
│   ├── config.ts             # PluginOptions, ResolvedPluginConfig, severity
│   ├── diagnostic.ts         # Diagnostic, SourceLocation, CodeFrame
│   └── rule.ts               # RuleDefinition, RuleContext, ExtractionResult
├── core/
│   ├── engine.ts             # LeakDetector orchestration engine (estree-walker single-pass)
│   ├── parser.ts             # OXC `parseSync` wrapper + ESTree normalization
│   ├── comments.ts           # Inline suppression directives
│   ├── ignore.ts             # Glob-based file/rule ignores (picomatch)
│   ├── baseline.ts           # Baseline manager + fingerprinting
│   └── extractors/           # SFC source extractors
│       ├── index.ts          # Extractor dispatcher
│       ├── vue.ts            # Vue <script> / <script setup> extractor
│       ├── svelte.ts         # Svelte <script> extractor
│       └── generic.ts        # JS/TS/JSX/TSX passthrough
├── reporter/
│   ├── index.ts              # Report dispatcher
│   ├── console.ts            # Colorized console reporter + JSON
│   ├── rollup.ts             # Vite/Rollup this.warn/error adapter
│   ├── sarif.ts              # SARIF JSON report
│   ├── html.ts               # HTML report
│   └── markdown.ts           # Markdown report
└── rules/
    ├── index.ts              # Rule registry
    ├── generic/
    │   ├── no-uncleared-timers.ts
    │   ├── no-unregistered-listeners.ts
    │   ├── no-unconnected-observers.ts
    │   └── no-unsubscribed-events.ts
    └── react/
        └── react-useeffect-cleanup.ts
```

## Dependencies

- [`oxc-parser`](https://www.npmjs.com/package/oxc-parser) — Rust-powered JavaScript/TypeScript parser producing an ESTree AST.
- [`estree-walker`](https://www.npmjs.com/package/estree-walker) — lightweight ESTree AST traversal used by the engine.
- [`@rollup/pluginutils`](https://www.npmjs.com/package/@rollup/pluginutils) — file include/exclude filtering.
- [`picocolors`](https://www.npmjs.com/package/picocolors) — terminal styling for stylish console reports.

## Development

```bash
# Install dependencies
npm install

# Type check
npm run typecheck

# Build dist outputs (CJS + ESM + types)
npm run build

# Watch mode
npm run dev
```

## License

MIT License