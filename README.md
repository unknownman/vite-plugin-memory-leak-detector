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

## Upgrading from 1.x to 2.0.0

Version 2.0.0 changes how findings are fingerprinted and reported:

- **Regenerate your baseline.** The fingerprint now includes a normalized
  source snippet and an occurrence index, so two leaks of the same variable in
  one file are tracked separately. v1 baseline files still suppress what they
  recorded (with a one-time console warning), but entries will drift as you
  edit — run once with `baseline: { update: true }` and commit the result:

  ```typescript
  memoryLeakDetector({ baseline: { path: '.leak-baseline.json', update: true } })
  ```

- **Custom rules must declare `triggers`.** The new parser prefilter skips any
  file that contains none of the enabled rules' trigger substrings. Declare the
  identifiers a report cannot exist without, or pass `triggers: []` to opt out
  (this disables the prefilter for the whole engine).

- **Paths resolve against the Vite project root**, not `process.cwd()`. If you
  ran Vite from a different directory than your project root, move
  `reports.outputDir` and `baseline.path` targets accordingly.

- **`react/react-useeffect-cleanup` now defaults to `warn`.** Set
  `rules: { 'react/react-useeffect-cleanup': 'error' }` to keep the old
  build-failing behavior.

No option was removed; every 1.x configuration still parses.

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

### The React effect rule is noisy. What severity does it use?

`react/react-useeffect-cleanup` defaults to `'warn'`, like every other built-in rule. It is a heuristic — a bare `el.addEventListener` inside an effect, or a store subscription the effect never tears down, is idiomatic React — so it is not an error by default. Raise it in your own config if you want it to gate:

```typescript
memoryLeakDetector({
  rules: { 'react/react-useeffect-cleanup': 'error' }
})
```

A `setTimeout` inside `useEffect` is never reported: a one-shot timer has nothing to clean up.

### How do I silence a specific pattern project-wide?

Set its severity to `'off'` in the `rules` config:

```typescript
memoryLeakDetector({
  rules: { 'generic/no-unregistered-listeners': 'off' }
})
```

### Will this slow down my Vite dev server?

Almost undetectably. Three things keep it cheap:

- **Most files are never parsed.** Every rule declares the identifiers it looks for (`triggers`). If a file contains none of them, it is skipped before `oxc-parser` runs at all. On a benchmark of 300 leak-free modules with all 11 rules enabled, this cut analysis from ~135 ms to ~0.6 ms. Even when 30% of the clean modules contain a trigger (`addEventListener`) and must be parsed anyway, analysis stays at ~13 ms.
- **Each file is analyzed once.** Results are cached by path and content hash, so a single edit is not re-analyzed by several Vite hooks.
- **One traversal for all rules.** Visitors are indexed by node type, so the walk is not `O(nodes x rules)`.

`oxc-parser` is written in Rust, and analysis results are cached across HMR updates, so only files you actually change are re-analyzed.

### How does the baseline system work?

The baseline stores a fingerprint of each known issue. When the plugin runs, any issue whose fingerprint is already in the baseline is suppressed, so a new leak fails the build while grandfathered ones stay quiet.

The fingerprint is derived from `ruleId + project-relative file path + the source line of the leak + which occurrence it is on that line` — deliberately **not** from the line number and **not** from the message text. That means:

- inserting or deleting code above a known leak does not resurrect it;
- two separate leaks of the same variable in one file stay separate entries, so adding a second one *is* reported;
- renaming the variable is reported as a new leak;
- re-wording a rule's message does not invalidate the whole baseline.

Files are stored relative to the Vite `root`, so the same baseline works across machines and CI checkout paths.

> **Baseline format v2.** The fingerprint algorithm changed, so baselines written by 1.0.x no longer match. They still load — matching falls back to the old `ruleId + file + message` hash — but the plugin prints a one-time warning. **Regenerate** for the precise behaviour:
>
> ```bash
> # set baseline: { path: '.leak-baseline.json', update: true }, run a build, then revert
> ```

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
  // Required. The file is not even parsed unless the source contains one of
  // these substrings, so list every identifier your rule reports on. Teardown
  // names usually don't belong: a rule only inspects a cleanup *after* it has
  // seen an allocation. Use `triggers: []` only as a last resort: an empty
  // list disables the prefilter for the whole engine, so every file is parsed
  // on every analysis (and `verbose` mode warns once about it).
  triggers: ['indexedDB.open', 'indexedDB.deleteDatabase'],

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

CI runs the suite on Node 18, 20, 22 and 24, and separately against Vite 4, 5, 6, 7 and 8, since the plugin supports each of those majors as a peer. A `package` job also asserts that `npm pack` produces nothing but publishable files.

## Security

`vite-plugin-memory-leak-detector` is a **static analysis tool**.

- It **does not** execute your source code.
- It **does not** collect, transmit, or phone-home any data.
- It is entirely safe to run in isolated, air-gapped CI/CD environments.

All AST parsing is done locally using `oxc-parser`.

## Performance Considerations

Adding AST analysis to a bundler can sometimes slow down development. We engineered this plugin to have an imperceptible footprint:

1. **Prefilter before parsing**: each rule declares the identifiers it can possibly report on (`triggers`). A file containing none of them is never handed to the parser. This is the single biggest win, because most files in a real app allocate nothing.
2. **Rust Parser**: `oxc-parser` is drastically faster than Babel or Acorn, and line/column numbers are only computed for nodes a rule actually reports on.
3. **Analyze once per edit**: results are cached by path and content hash. Vite can hand the same edit to several hooks (`transform`, `handleHotUpdate`, `hotUpdate`, the watcher), and the plugin re-analyzes and re-prints only once.
4. **Single-pass traversal**: whether you have 2 rules enabled or 50, the AST is walked exactly *once*. Visitors are indexed by node type, so the cost is `O(nodes + handler calls)`, not `O(nodes x rules)`.
5. **Environment-aware state**: under Vite 6+ a module is transformed once per environment (client, ssr). Results are tracked per environment and de-duplicated before reporting, so one leak is counted once.

Run the benchmark yourself with `npx tsx benchmarks/phase4.ts`.

Reproduce the numbers above on 300 leak-free modules plus 20 leaky ones (397 kB, all 11 rules): prefilter off ~135 ms, prefilter on ~0.6 ms, and ~13 ms when 30% of the clean modules contain `addEventListener` and are parsed anyway; traversal alone ~6.8 ms to ~5.5 ms. See [`benchmarks/phase4.ts`](benchmarks/phase4.ts).

## License

MIT License
