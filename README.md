# vite-plugin-memory-leak-detector

A powerful, AST-based Vite plugin that detects potential memory leaks in your frontend code at build time. Catch forgotten event listeners, runaway intervals, and missing component teardowns before they reach production.

[![NPM Version](https://img.shields.io/npm/v/vite-plugin-memory-leak-detector)](https://npmjs.com/package/vite-plugin-memory-leak-detector)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

## Features

- **Blazing Fast**: Uses the Rust-powered `oxc-parser` combined with standard ESTree traversal.
- **Multi-Framework**: Built-in intelligence for **React**, **Vue 3**, **Svelte**, and **SolidJS**.
- **Beautiful Reports**: Generates interactive HTML dashboards, CI-ready Markdown, and GitHub SARIF annotations.
- **Baseline System**: Introduce the plugin to legacy codebases immediately without breaking the build. Fix known issues once and ignore them going forward.
- **Highly Pluggable**: Write your own custom AST rules in just a few lines of code.

## Installation

```bash
npm install vite-plugin-memory-leak-detector -D
# or
pnpm add vite-plugin-memory-leak-detector -D
# or
yarn add vite-plugin-memory-leak-detector -D
```

## Quick Start

Add the plugin to your `vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import memoryLeakDetector from 'vite-plugin-memory-leak-detector';

export default defineConfig({
  plugins: [
    memoryLeakDetector({
      mode: process.env.NODE_ENV === 'production' ? 'error' : 'warn',
      reports: ['stylish', { format: 'html', outputFile: 'dist/leak-report.html' }],
    }),
  ],
});
```

## Detected Patterns (Rules)

### Generic Rules (Vanilla JS/TS)

| Rule ID | Default Severity | Description |
|---|---|---|
| `generic/no-uncleared-timers` | `warn` | `setInterval` / `setTimeout` allocated without being cleared. |
| `generic/no-unregistered-listeners` | `warn` | `addEventListener` allocated without `removeEventListener`. |
| `generic/no-unconnected-observers` | `warn` | `IntersectionObserver` / `ResizeObserver` without `.disconnect()`. |
| `generic/no-unsubscribed-events` | `warn` | `RxJS` / `EventEmitter` subscriptions without `.unsubscribe()`. |

### Framework Rules

| Rule ID | Default Severity | Description |
|---|---|---|
| `react/react-useeffect-cleanup` | `error` | `useEffect` allocating timers/listeners without returning a cleanup function. |
| `vue/missing-onunmounted` | `error` | Intervals/listeners in `<script setup>` without `onUnmounted`. |
| `svelte/missing-ondestroy` | `error` | Intervals/listeners in `<script>` without `onDestroy`. |
| `solid/missing-oncleanup` | `error` | Unmanaged allocations inside components/effects without `onCleanup`. |

Framework rules are auto-enabled based on file extensions, or can be explicitly configured via `frameworks: ['react', 'vue']`.

## Configuration Options

| Option | Type | Default | Description |
|---|---|---|---|
| `mode` | `'warn' \| 'error' \| 'report-only'` | `'warn'` | `'error'` fails the build on error-level diagnostics; `'report-only'` writes reports without failing. |
| `frameworks` | `'auto' \| ('react'\|'vue'\|'svelte'\|'solid')[]` | `'auto'` | Frameworks to analyze. Generic rules always run. |
| `thresholds.maxWarnings` | `number` | `Infinity` | Max warnings before failing the build. |
| `thresholds.maxErrors` | `number` | `0` (error mode), `Infinity` | Max errors before failing the build. |
| `thresholds.maxTotal` | `number` | `Infinity` | Max total diagnostics before failing the build. |
| `include` | `FilterPattern` | `/\.[jt]sx?$\|\.vue$\|\.svelte$/` | Files to analyze. |
| `exclude` | `FilterPattern` | `/node_modules/` | Files to ignore. |
| `rules` | `RuleSeverityConfig` | `{}` | Per-rule severity overrides (`'error' \| 'warn' \| 'info' \| 'off'`). |
| `ignores` | `IgnoreConfig` | `[]` | Advanced glob-based ignore system for files and specific rules. |
| `allowlist.functions` | `string[]` | `[]` | Function names to skip (e.g., custom hooks that auto-clean). |
| `allowlist.methods` | `string[]` | `[]` | Object method names to skip. |
| `customRules` | `RuleDefinition[]` | `[]` | Custom rules to extend detection capabilities. |
| `comments.enabled` | `boolean` | `true` | Enable inline suppression comments. |
| `comments.prefix` | `string` | `'memory-leak'` | Directive prefix. |
| `baseline` | `string \| BaselineConfig` | `undefined` | Baseline file path or config to ignore known issues. |
| `reports` | `ReportFormat \| (ReportFormat \| ReportDestination)[]` | `'stylish'` | Report formats: `'stylish'`, `'json'`, `'sarif'`, `'html'`, `'markdown'`. |
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
```

Customize the prefix:

```typescript
memoryLeakDetector({ comments: { prefix: 'myleak' } });
// now supports: // myleak-ignore-next-line ...
```

## Ignore & Allowlist

### Glob-based file/rule ignores

Skip entire files, or specific rules for specific files, using glob patterns. Because Vite passes absolute paths to the analyzer, prefix patterns with `**/` to match files reliably.

```typescript
memoryLeakDetector({
  ignores: [
    '**/*.test.{ts,tsx}',
    '**/*.spec.{ts,tsx}',
    { glob: '**/src/legacy/**/*.js', rules: ['generic/no-unregistered-listeners'] },
    { glob: ['**/dist/**', '**/generated/**'], rules: ['generic/no-unsubscribed-events'] },
  ],
});
```

### Function / method allowlist

Bypass detection for functions and methods that are known to clean up after themselves.

```typescript
memoryLeakDetector({
  allowlist: {
    functions: ['useInterval', 'useEventListener'],
    methods: ['subscribeSafe', 'onCustomEvent'],
  },
});
```

## Baselines

Fix known issues once, then ignore them going forward using a baseline file.

**Step 1: Record Baseline**

```typescript
memoryLeakDetector({
  baseline: { path: '.leak-baseline.json', update: true },
});
```

**Step 2: Enforce Baseline**

```typescript
memoryLeakDetector({
  baseline: '.leak-baseline.json',
});
```

## Reports

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

### CI/CD Integration & SARIF

Generate a SARIF file to annotate Pull Requests directly in GitHub Actions:

```typescript
memoryLeakDetector({
  mode: 'report-only',
  reports: ['sarif'],
  outputDir: '.github/reports',
});
```

Upload the output to `github/codeql-action/upload-sarif` in your pipeline workflow.

## Severity Overrides

```typescript
memoryLeakDetector({
  rules: {
    'generic/no-uncleared-timers': 'error',
    'react/react-useeffect-cleanup': 'warn',
    'generic/no-unregistered-listeners': 'off',
  },
});
```

## Writing Custom Rules

Custom rules are plain objects with a `create(context)` method that returns an ESTree visitor. Use `context.report(...)` to emit diagnostics.

```typescript
import { defineConfig } from 'vite';
import memoryLeakDetector, { type RuleDefinition } from 'vite-plugin-memory-leak-detector';

const customWebsocketRule: RuleDefinition = {
  id: 'custom/websocket-cleanup',
  description: 'Ensure websockets are closed.',
  category: 'generic',
  defaultSeverity: 'error',

  create(context) {
    let wsCreated = false;
    let wsClosed = false;

    return {
      NewExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'WebSocket') {
          wsCreated = true;
        }
      },
      CallExpression(node) {
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'close'
        ) {
          wsClosed = true;
        }
      },
      'Program:exit'(node) {
        if (wsCreated && !wsClosed) {
          context.report({
            ruleId: 'custom/websocket-cleanup',
            message: 'WebSocket instantiated but never closed.',
            suggestion: 'Call .close() when the component is unmounted.',
            line: node.loc?.start?.line ?? 1,
            column: node.loc?.start?.column ?? 0,
          });
        }
      },
    };
  },
};

export default defineConfig({
  plugins: [memoryLeakDetector({ customRules: [customWebsocketRule] })],
});
```

## Architecture

```
src/
├── index.ts                  # Main entry point & public API
├── plugin.ts                 # Vite plugin lifecycle hooks
├── config/
│   ├── index.ts              # resolvePluginConfig
│   ├── defaults.ts           # DEFAULT_CONFIG
│   └── validator.ts          # Options validation
├── types/
│   ├── config.ts             # PluginOptions, ResolvedPluginConfig
│   ├── diagnostic.ts         # Diagnostic, SourceLocation, CodeFrame
│   └── rule.ts               # RuleDefinition, RuleContext, ExtractionResult
├── core/
│   ├── engine.ts             # LeakDetector orchestration engine (single-pass traversal)
│   ├── parser.ts             # OXC parser wrapper + ESTree normalization
│   ├── comments.ts           # Inline suppression directives
│   ├── ignore.ts             # Glob-based file/rule ignores (picomatch)
│   ├── baseline.ts           # Baseline manager + fingerprinting
│   └── extractors/           # SFC source extractors
│       ├── index.ts          # Extractor dispatcher
│       ├── vue.ts            # Vue <script> / <script setup>
│       ├── svelte.ts         # Svelte <script>
│       └── generic.ts        # JS/TS/JSX/TSX passthrough
├── reporter/
│   ├── index.ts              # Report dispatcher
│   ├── console.ts            # Colorized console reporter
│   ├── rollup.ts             # Vite/Rollup this.warn/error adapter
│   ├── sarif.ts              # SARIF JSON report
│   ├── html.ts               # Interactive HTML report
│   └── markdown.ts           # Markdown table report
└── rules/
    ├── index.ts              # Rule registry
    ├── generic/
    │   ├── no-uncleared-timers.ts
    │   ├── no-unregistered-listeners.ts
    │   ├── no-unconnected-observers.ts
    │   └── no-unsubscribed-events.ts
    ├── react/
    │   └── react-useeffect-cleanup.ts
    ├── vue/
    │   └── vue-missing-onunmounted.ts
    ├── svelte/
    │   └── svelte-missing-ondestroy.ts
    └── solid/
        └── solid-missing-oncleanup.ts
```

## Dependencies

- [`oxc-parser`](https://www.npmjs.com/package/oxc-parser) — Rust-powered JavaScript/TypeScript parser producing an ESTree AST.
- [`estree-walker`](https://www.npmjs.com/package/estree-walker) — lightweight ESTree AST traversal.
- [`@rollup/pluginutils`](https://www.npmjs.com/package/@rollup/pluginutils) — file include/exclude filtering.
- [`picocolors`](https://www.npmjs.com/package/picocolors) — terminal styling for console reports.
- [`picomatch`](https://www.npmjs.com/package/picomatch) — glob pattern matching for ignores.

## Development

```bash
npm install
npm run typecheck
npm run build
npm run dev
```

## License

MIT License
