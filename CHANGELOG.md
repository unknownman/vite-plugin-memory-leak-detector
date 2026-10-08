# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.0] - 2026-10-08

### Breaking

- **Custom rules must declare `triggers`.** `RuleDefinition` gained a required
  `triggers: string[]` field. A source file is skipped before parsing when none
  of the enabled rules' triggers occur in it, so a rule that does not declare
  the identifiers it reports on would silently stop firing. Declare the
  identifiers a report cannot exist without:

  ```ts
  const myRule: RuleDefinition = {
    id: 'custom/indexdb-cleanup',
    description: 'Ensure databases are closed.',
    category: 'generic',
    defaultSeverity: 'error',
    triggers: ['indexedDB.open'],
    create(context) { /* ... */ },
  };
  ```

  Rules that cannot describe their requirements this way can use `triggers: []`.
  This disables the prefilter for the **whole engine** — every source file is
  parsed on every analysis, for all rules — so reserve it for rules that
  genuinely cannot be described as a substring check. In `verbose` mode the
  plugin warns once identifying the rule.

- **Baseline files are regenerated for the v2 fingerprint.** See Changed.

### Changed

- **Paths resolve against the Vite project root.** `viteConfig.root` is threaded
  from `configResolved` into the engine and on into the baseline manager,
  fingerprinting and every reporter. `outputDir` and `baseline.path` are
  resolved against that root rather than `process.cwd()`, so running Vite from a
  monorepo package subdirectory no longer writes reports or baselines to the
  wrong place. `generateFingerprint(diag, cwd?)` keeps its old signature.
- **Baseline fingerprint is precise.** The key changed from
  `ruleId + file + message` to
  `ruleId + relative file + normalized source line + occurrence index`.
  Previously two leaks of the same variable in one file collapsed into a single
  entry, so adding a second one stayed hidden; and renaming a variable made the
  old leak look new. Line numbers are still excluded, so a known leak stays
  recognized after code is inserted above it.
- **Baseline format v2 (`2.0.0`).** v1 files still suppress what they recorded
  by falling back to the legacy `ruleId + file + message` hash, and the plugin
  prints a one-time warning recommending regeneration.
- **A file is analyzed once per edit.** Results are cached by path and content
  hash, and a fingerprint set remembered per file prevents the same edit from
  being analyzed or printed twice when several Vite hooks observe it.
- **State is keyed per environment.** Under the Vite 6+ Environment API a module
  is transformed once per environment (client, ssr). Diagnostics are tracked per
  environment and collapsed by `file + ruleId + line + column + message` before
  reporting, so cross-environment duplicates are reported and threshold-counted
  once.
- **Watch rebuilds start clean.** `buildStart` clears cached diagnostics when
  `command` is `build`; previously nothing cleared them between rebuilds, so a
  leak fixed in the first pass was still reported by every later one.
- **`react/react-useeffect-cleanup` defaults to `warn`** instead of `error`. It
  fires on idiomatic React — a bare `el.addEventListener` inside an effect, a
  store subscription the effect never tears down — so defaulting it to `error`
  failed builds for correct code. Raise it per project with
  `rules: { 'react/react-useeffect-cleanup': 'error' }`.
- **All output goes through Vite's logger**, so `--logLevel` and `clearScreen`
  are respected. `consoleReporter` accepts an injectable `write`.
- **The dev summary key is built from fingerprints** rather than per-file
  diagnostic counts, so replacing one leak with a different one in the same file
  reprints the summary instead of being swallowed.

### Fixed

- **Class-scoped teardown tracking.** Leaks are now matched against the class that
  allocated them: sibling classes no longer clear each other's `this.*` resources,
  nested classes resolve to the innermost class, and a clearance in *any* method
  of the same class counts.
- **Conditional teardown guards.** `if (id && ready) clearInterval(id)` and
  `if (ready) { clearInterval(id) } else { clearInterval(other) }` are recognized
  as self-guards; a clearance in an unreachable branch no longer suppresses a
  report, and `useEffect` bodies wrapped in a guard are no longer skipped.
- **Method-style teardown guards.** `id && clearInterval(id)`,
  `ready && obj.stop()` and other method callees in a short-circuit `&&`
  are recognized as clearances (they were only detected as call arguments
  or bare statements before).
- **Wildcard visitor dispatch.** Rules declaring `'*'` / `'*:exit'` visitors
  (or their own `ReturnStatement` handler) are no longer dropped; branch
  tracking for ternaries and non-block `if` bodies now runs through the
  wildcard hook instead of a wrapper that overwrote the rule's own visitor.
  Self-guard detection also rejects clearances in a ternary's *alternate*
  branch, matching the `if/else` behavior.
- **`react/react-useeffect-cleanup` prefilter trigger widened** from
  `useEffect` to `Effect`, so files that only use `useLayoutEffect` or
  `useInsertionEffect` reach the rule.
- **Multi-environment builds are reported cumulatively.** `buildStart` now
  clears only the current environment's cached diagnostics, so a `vite build`
  that runs both client and ssr environments no longer loses the first
  environment's findings when the second starts. The dev summary also
  deduplicates by fingerprint, so the same file seen from client and ssr
  environments prints once.
- **Missing environment is canonicalized to `client`.** Vite 5 (and hooks
  without an Environment API context) no longer create a second, unnamed
  state bucket alongside `client`.
- **Baseline snippets normalize more aggressively.** String and template
  literal contents collapse to empty and numeric literals to `0`, so changing
  a delay, URL or event name does not orphan a baseline entry. Occurrence
  indices are now assigned before any suppression (rule off, ignore comment,
  baseline), so adding an ignore comment no longer re-keys the surviving
  leak's fingerprint. Baseline version checks compare majors numerically
  (`10.0.0` no longer reads as "older than 2.0.0") and a single fingerprint
  set serves both v1 and v2 matching.
- **`setTimeout` is not a leak.** One-shot timers are excluded from
  `generic/no-uncleared-timers` and from `react/react-useeffect-cleanup`.

### Added

- **Parser prefilter.** Rules declare `triggers`; a file with none of them is never
  parsed. Roughly 340x faster on leak-free modules in the bundled benchmark.
- **Visitor map.** Rule visitors are indexed by node type, so the traversal is
  `O(nodes + handler calls)` rather than `O(nodes x rules)`.
- **Benchmark** (`benchmarks/phase4.ts`, `npx tsx benchmarks/phase4.ts`),
  including a case where 30% of leak-free modules contain a trigger and must
  be parsed anyway.
- **CI**: Node 18/20/22/24, a Vite 4/5/6/7/8 compatibility matrix, a job that
  runs the multi-environment build test on Vite 6/7/8 and fails if it
  silently skips, and a job asserting the published tarball contains nothing
  but publishable files.
- **Verbose warning for `triggers: []`.** A custom rule that disables the
  parser prefilter now logs a one-time warning identifying the rule when
  `verbose` is enabled.

### Removed

- The self-referential `vite-plugin-memory-leak-detector` devDependency. It was
  unused, shipped a second copy of the package into `node_modules`, and its
  `vite` peer range blocked installing Vite 7 or 8.

### Fixed (docs)

- Corrected the `svelte/missing-ondestroy` typo; the rule id is
  `svelte/missing-ondestroy`.

---

## [1.0.1] - 2026-09-05

### Changed

- **Peer range**: support Vite 7 and Vite 8 (`^4.0.0 || ^5.0.0 || ^6.0.0 || ^7.0.0 || ^8.0.0`).

## [1.0.0] - 2026-09-04

### Added

- **Core Engine**: High-performance AST parser (`oxc-parser`) with single-pass `estree-walker` traversal.
- **Framework Support**: Intelligent memory leak detection for React, Vue 3, Svelte, and SolidJS.
- **Generic Rules**:
  - `generic/no-uncleared-timers` — `setInterval` allocated without being cleared.
  - `generic/no-uncleared-animation-frames` — `requestAnimationFrame` allocated without being canceled.
  - `generic/no-unregistered-listeners` — `addEventListener` allocated without `removeEventListener`.
  - `generic/no-unconnected-observers` — `IntersectionObserver`, `PerformanceObserver`, etc. without `.disconnect()`.
  - `generic/no-unclosed-websockets` — `WebSocket` or `EventSource` without `.close()`.
  - `generic/no-missing-abort-controller` — `AbortController` allocated without `.abort()`.
  - `generic/no-unsubscribed-events` — RxJS / EventEmitter subscriptions without `.unsubscribe()`.
- **Framework Rules**:
  - `react/react-useeffect-cleanup` — useEffect with subscriptions/listeners but no cleanup return.
  - `vue/missing-onunmounted` — subscriptions in `<script setup>` without `onUnmounted`.
  - `svelte/missing-ondestroy` — subscriptions in `<script>` without `onDestroy`.
  - `solid/missing-oncleanup` — unmanaged allocations without `onCleanup`.
- **Reporters**: Terminal (grouped stylish), HTML dashboard with VS Code deep links, Markdown, JSON, and GitHub SARIF.
- **Suppression System**: Glob-based ignores, function allowlisting, inline comment directives, and deterministic baselines.
- **SFC Support**: State-machine scanner for Vue and Svelte single-file components.
- **Custom Rules**: Extensible rule API via `create(context)` returning an ESTree visitor.
- **Test Suite**: 58 tests covering all rules, comment directives, baselines, and full engine integration.
