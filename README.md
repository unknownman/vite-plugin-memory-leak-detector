# vite-plugin-memory-leak-detector

A Vite plugin that detects potential memory leaks in your frontend code at build time using AST-based static analysis.

## Features
- 🚀 **Fast**: Runs efficiently during the Vite transform phase using a Babel AST.
- 🧩 **Extensible**: Pluggable rule system with generic and framework-specific rules (React, Vue, Svelte, Solid).
- 🛡 **Type Safe**: Fully written in strict TypeScript.
- 🔍 **SFC Aware**: Extracts `<script>` / `<script setup>` blocks from Vue `.vue` and Svelte `.svelte` files with accurate line/column reporting.
- 🚨 **Vite Integration**: Emits diagnostics through Vite's terminal output, including file, line, and column locations.
- 🎨 **Reporter System**: Colorized codeframe console reporter and JSON output for CI.

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
      failOnError: false, // Set to true to break the build on error-level diagnostics (useful in CI)
      reporter: 'stylish', // 'stylish' | 'json' | 'default'
    })
  ]
});
```

## Configuration Options

| Option | Type | Default | Description |
|---|---|---|---|
| `include` | `FilterPattern` | `/\.[jt]sx?$\|\.vue$\|\.svelte$/` | Files to analyze. |
| `exclude` | `FilterPattern` | `/node_modules/` | Files to ignore. |
| `failOnError` | `boolean` | `false` | If `true`, Vite emits an error (instead of a warning) for error-level diagnostics, breaking the build. |
| `rules` | `RuleSeverityConfig` | `{}` | Per-rule severity overrides (`'error' \| 'warn' \| 'off'`). |
| `customRules` | `RuleDefinition[]` | `[]` | Custom rules to extend detection capabilities. |
| `reporter` | `'stylish' \| 'json' \| 'default'` | `'stylish'` | Output formatting. |
| `verbose` | `boolean` | `false` | Enable verbose logging for parser/rule errors. |

## Built-in Rules

| Rule ID | Category | Default Severity | Description |
|---|---|---|---|
| `generic/no-uncleared-timers` | generic | `warn` | Detects `setInterval` / `setTimeout` calls whose timer handle is never cleared. |
| `generic/no-unregistered-listeners` | generic | `warn` | Detects `addEventListener` calls without a matching `removeEventListener`. |
| `react/react-useeffect-cleanup` | react | `error` | Detects `useEffect` / `useLayoutEffect` callbacks that create subscriptions, timers, or listeners without returning a cleanup function. |

## Severity Overrides

```typescript
memoryLeakDetector({
  rules: {
    'generic/no-uncleared-timers': 'error',        // promote to error
    'react/react-useeffect-cleanup': 'warn',       // demote to warning
    'generic/no-unregistered-listeners': 'off',    // disable
  }
});
```

## Writing Custom Rules

Custom rules are plain objects with a `create(context)` method that returns a Babel `Visitor`. Use `context.report(...)` to emit diagnostics.

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
      CallExpression(path) {
        const callee = path.node.callee;
        if (callee.type === 'MemberExpression') {
          const hasUnsubscribeInFile = context.code.includes('.unsubscribe(');
          if (!hasUnsubscribeInFile) {
            context.report({
              ruleId: 'generic/unsubscribed-rxjs',
              message: 'RxJS subscription created without unsubscribing.',
              suggestion: 'Store the subscription and call unsubscribe on unmount.',
              severity: 'warn',
              line: path.node.loc?.start.line ?? 1,
              column: path.node.loc?.start.column ?? 0,
            });
          }
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
├── plugin.ts                 # Vite plugin lifecycle hooks
├── types/                    # TypeScript interfaces
│   ├── config.ts             # Plugin options, severity
│   ├── diagnostic.ts         # Diagnostic, SourceLocation, CodeFrame
│   └── rule.ts               # RuleDefinition, RuleContext, ExtractionResult
├── core/
│   ├── engine.ts             # LeakDetector orchestration engine
│   ├── parser.ts             # @babel/parser wrapper
│   └── extractors/           # SFC source extractors
│       ├── index.ts          # Extractor dispatcher
│       ├── vue.ts            # Vue <script> / <script setup> extractor
│       ├── svelte.ts         # Svelte <script> extractor
│       └── generic.ts        # JS/TS/JSX/TSX passthrough
├── reporter/
│   ├── index.ts              # Reporter dispatcher
│   ├── console.ts            # Colorized codeframe reporter + JSON
│   └── rollup.ts             # Vite/Rollup this.warn/error adapter
└── rules/
    ├── index.ts              # Rule registry
    ├── generic/              # Generic rules
    │   ├── no-uncleared-timers.ts
    │   └── no-unregistered-listeners.ts
    └── react/
        └── react-useeffect-cleanup.ts
```

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