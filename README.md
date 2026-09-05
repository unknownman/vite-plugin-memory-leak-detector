# 🛡️ vite-plugin-memory-leak-detector

A powerful, AST-based Vite plugin that detects potential memory leaks in your frontend code at build time. Catch forgotten event listeners, runaway intervals, and missing component teardowns before they reach production.

[![NPM Version](https://img.shields.io/npm/v/vite-plugin-memory-leak-detector)](https://npmjs.com/package/vite-plugin-memory-leak-detector)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

![Vite Plugin Memory Leak Detector Demo](./demo.gif)

*"Watch the plugin catch missing useEffect cleanups, unclosed WebSockets, and uncleared timers live during `vite build`"*

- ⚡ **Build-Time Detection**: Real-time identification of leaks with precise line numbers and remediation suggestions.
- 📊 **Rich Artifacts**: Automatic generation of HTML dashboards, SARIF annotations, and Markdown summaries.
- 🛡️ **Baseline System**: Grandfathering legacy leaks so existing large projects can adopt the tool instantly without failing CI.

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

---

## Recommended Configurations

Choose the setup that best fits your team's workflow.

### 1. Strict (For New/Greenfield Projects)
Fails the build if any rule is broken. Perfect for maintaining a spotless codebase.

```typescript
// vite.config.ts
import memoryLeakDetector from 'vite-plugin-memory-leak-detector';

export default {
  plugins: [
    memoryLeakDetector({
      mode: 'error', // Immediately fail on any detection
    })
  ]
};
```

### 2. Gradual Adoption (For Legacy Projects)
Shows warnings in development, but fails the build in CI *only* if new memory leaks are introduced. Older leaks are grandfathered in via a baseline file.

```typescript
// vite.config.ts
import memoryLeakDetector from 'vite-plugin-memory-leak-detector';

export default {
  plugins: [
    memoryLeakDetector({
      mode: process.env.CI ? 'error' : 'warn',
      baseline: '.leak-baseline.json', // Ignore legacy issues!
      reports: ['stylish', { format: 'html', outputFile: 'dist/leak-report.html' }]
    })
  ]
};
```

### 3. CI-Only / Report-Only
Does not affect the developer terminal or fail builds. Runs purely in CI to generate artifact reports.

```typescript
// vite.config.ts
import memoryLeakDetector from 'vite-plugin-memory-leak-detector';

export default {
  plugins: [
    memoryLeakDetector({
      mode: 'report-only',
      reports: ['sarif', 'markdown'],
      outputDir: '.github/reports'
    })
  ]
};
```

---

## Migrating an Existing Large Codebase

When you add this plugin to a legacy codebase, you might see hundreds of warnings. Don't panic — here is the battle-tested adoption strategy:

**Step 1: Whitelist safe abstractions**

Does your team use a custom `useInterval` hook that handles cleanup automatically? Add it to the allowlist so the plugin ignores it.

```typescript
memoryLeakDetector({
  allowlist: { functions: ['useInterval', 'useEventListener'] }
})
```

**Step 2: Ignore "safe" legacy directories**

If `src/legacy-utils/` is old, stable, and rarely touched, tell the plugin to skip it.

```typescript
memoryLeakDetector({
  ignores: ['**/src/legacy-utils/**']
})
```

**Step 3: Generate a baseline**

Run the plugin once with `update: true` to snapshot all existing leaks.

```typescript
memoryLeakDetector({
  baseline: { path: '.leak-baseline.json', update: true }
})
```

Run your build, then revert `update: true` back to `baseline: '.leak-baseline.json'` and commit the JSON file to Git.

**Result:** Your CI will now pass perfectly. If a developer introduces a *new* memory leak, the build will fail, but the 100 legacy leaks will be completely ignored.

**Step 4: Fix incrementally**

Pick one rule (e.g., `generic/no-uncleared-timers`) and fix all violations in a single PR. Remove the baseline entry for that rule. Repeat weekly until the baseline is empty.

---

## GitHub Actions Integration (SARIF)

If you use GitHub, the plugin can automatically annotate your PRs with memory leak warnings right on the lines of code.

1. Update your Vite config to generate a SARIF report:

```typescript
memoryLeakDetector({ mode: 'report-only', reports: ['sarif'] })
```

2. Add this step to your GitHub Actions workflow (`.github/workflows/build.yml`):

```yaml
name: Build and Check
on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build

      - name: Upload Memory Leak Report
        uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: .github/reports/leak-report.sarif
          category: memory-leak-detector
```

---

## FAQ

### I'm getting too many false positives. What do I do?

Because the plugin uses static analysis (AST), it doesn't execute your code. If you allocate a timer and pass it through 3 different files before clearing it, the plugin won't trace it across files.

- **Extract into a utility**: Move the logic into an allowlisted function (`allowlist.functions: ['myCustomTimer']`).
- **Suppress inline**: Add `// memory-leak-ignore-next-line` above the offending line.
- **Turn off per-file**: Use `// memory-leak-ignore-file` at the top of a file.
- **Turn off per-rule**: Set `rules: { 'generic/no-uncleared-timers': 'off' }` in the plugin config.

### How do I silence a specific pattern project-wide?

Set its severity to `'off'` in the `rules` config:

```typescript
memoryLeakDetector({
  rules: { 'generic/no-unregistered-listeners': 'off' }
})
```

### Will this slow down my Vite dev server?

Almost undetectably. The plugin uses `oxc-parser` (written in Rust), the fastest JavaScript parser available. It also leverages Vite's transform cache, so only files that actually change during HMR are re-analyzed.

### How does the baseline system work?

The baseline stores a SHA-256 fingerprint of each known issue (derived from `ruleId + file + message`, independent of line numbers). When the plugin runs, any issue whose fingerprint is in the baseline is suppressed. If a developer introduces a *new* leak (a fingerprint not in the baseline), it's reported normally.

To update the baseline: set `baseline.update: true` in your config, run a build, then commit the resulting JSON file and revert `update: true`.

### Can I write custom rules?

Yes. Custom rules are plain objects with a `create(context)` method that returns an ESTree visitor. See [Writing Custom Rules](#writing-custom-rules) below.

---

## Detected Patterns (Rules)

### Generic Rules (Vanilla JS/TS)

| Rule ID | Default Severity | Description |
|---|---|---|
| `generic/no-uncleared-timers` | `warn` | `setInterval` allocated without being cleared. |
| `generic/no-uncleared-animation-frames` | `warn` | `requestAnimationFrame` allocated without being canceled. |
| `generic/no-unregistered-listeners` | `warn` | `addEventListener` allocated without `removeEventListener`. |
| `generic/no-unconnected-observers` | `warn` | `IntersectionObserver`, `PerformanceObserver`, etc. without `.disconnect()`. |
| `generic/no-unclosed-websockets` | `warn` | `new WebSocket()` or `EventSource` without `.close()`. |
| `generic/no-missing-abort-controller` | `warn` | `new AbortController()` without `.abort()` called. |
| `generic/no-unsubscribed-events` | `warn` | `RxJS` / `EventEmitter` subscriptions without `.unsubscribe()`. |

### Framework Rules

| Rule ID | Default Severity | Description |
|---|---|---|
| `react/react-useeffect-cleanup` | `error` | `useEffect` allocating timers/listeners/websockets without returning a cleanup function. |
| `vue/missing-onunmounted` | `error` | Intervals/listeners in `<script setup>` without `onUnmounted`. |
| `svelte/missing-ondestroy` | `error` | Intervals/listeners in `<script>` without `onDestroy`. |
| `solid/missing-oncleanup` | `error` | Unmanaged allocations inside components/effects without `onCleanup`. |

---

## Writing Custom Rules

Custom rules are plain objects with a `create(context)` method that returns an ESTree visitor.

```typescript
import { defineConfig } from 'vite';
import memoryLeakDetector, { type RuleDefinition } from 'vite-plugin-memory-leak-detector';

const customIndexDBRule: RuleDefinition = {
  id: 'custom/indexdb-cleanup',
  description: 'Ensure databases are closed.',
  category: 'generic',
  defaultSeverity: 'error',

  create(context) {
    let dbOpened = false;
    let dbClosed = false;

    return {
      CallExpression(node) {
        if (node.callee.property?.name === 'open') dbOpened = true;
        if (node.callee.property?.name === 'close') dbClosed = true;
      },
      'Program:exit'(node) {
        if (dbOpened && !dbClosed) {
          context.report({
            ruleId: 'custom/indexdb-cleanup',
            message: 'Database opened but never closed.',
            line: node.loc?.start?.line ?? 1,
            column: node.loc?.start?.column ?? 0,
          });
        }
      },
    };
  },
};

export default defineConfig({
  plugins: [memoryLeakDetector({ customRules: [customIndexDBRule] })],
});
```

---

## Comment Directives

You can suppress specific issues directly in source code:

| Directive | Scope |
|---|---|
| `// memory-leak-ignore-next-line` | Suppresses the next line only |
| `// memory-leak-ignore-line` | Suppresses the current line |
| `// memory-leak-ignore-file` | Suppresses all issues in the file |
| `// memory-leak-ignore-start` | Suppresses a block (pair with `// memory-leak-ignore-end`) |
| `// memory-leak-ignore-end` | Ends a suppression block |

---

## Testing

The plugin ships with a comprehensive test suite powered by [Vitest](https://vitest.dev/). Tests cover all rules, comment directives, baselines, glob ignores, and full engine integration.

```bash
npm run test
npm run test:watch
npm run test:coverage
```

## Security

`vite-plugin-memory-leak-detector` is a **static analysis tool**.

- It **does not** execute your source code.
- It **does not** collect, transmit, or phone-home any data.
- It is entirely safe to run in isolated, air-gapped CI/CD environments.

All AST parsing is done locally using `oxc-parser`.

## Performance Considerations

Adding AST analysis to a bundler can sometimes slow down development. We engineered this plugin to have an imperceptible footprint:

1. **Rust Parser**: We use `oxc-parser`, which is drastically faster than Babel or Acorn.
2. **Vite Cache**: During `vite dev`, the plugin leverages Vite's internal module cache. It only re-analyzes files that you actually modify and save.
3. **Single-Pass Traversal**: Whether you have 2 rules enabled or 50, the `estree-walker` engine only traverses the AST of a file exactly *once*, executing all rules simultaneously.

## License

MIT License
