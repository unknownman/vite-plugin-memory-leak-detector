# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
  - `svelte/mmissing-ondestroy` — subscriptions in `<script>` without `onDestroy`.
  - `solid/missing-oncleanup` — unmanaged allocations without `onCleanup`.
- **Reporters**: Terminal (grouped stylish), HTML dashboard with VS Code deep links, Markdown, JSON, and GitHub SARIF.
- **Suppression System**: Glob-based ignores, function allowlisting, inline comment directives, and deterministic baselines.
- **SFC Support**: State-machine scanner for Vue and Svelte single-file components.
- **Custom Rules**: Extensible rule API via `create(context)` returning an ESTree visitor.
- **Test Suite**: 58 tests covering all rules, comment directives, baselines, and full engine integration.
