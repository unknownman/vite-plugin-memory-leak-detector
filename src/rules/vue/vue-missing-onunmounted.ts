import { walk } from 'estree-walker';
import type { RuleContext, RuleDefinition, RuleVisitor } from '../../types/rule.js';
import {
  getExpressionName,
  getAllocationTarget,
  findFunctionBodyInAncestors,
} from '../utils/tracker.js';
import { ScopeTracker, attachScopeListeners } from '../utils/scope.js';

const TEARDOWN_HOOKS = new Set(['onUnmounted', 'onBeforeUnmount']);

const TEARDOWN_CALLS = new Set([
  'clearInterval',
  'clearTimeout',
  'cancelAnimationFrame',
  'removeEventListener',
  'unsubscribe',
  'off',
  'close',
  'abort',
  'disconnect',
]);

const LEAKY_CALLS = new Set(['setInterval', 'addEventListener', 'subscribe']);

/**
 * Reactive wrappers whose inline callbacks run as part of the component's
 * reactive lifecycle. Allocations made inside these (e.g.
 * `watch(() => { const id = setInterval(...) })`) are still the component's
 * responsibility and must be cleared in `onUnmounted` — or, for `watch` /
 * `watchEffect`, via the `onCleanup` registrar passed to the callback — so they
 * are scanned. Plain DOM/event callbacks (e.g.
 * `el.addEventListener('click', () => ...)`) remain out of scope for this rule.
 */
const REACTIVE_LEAK_CONTAINERS = ['watch', 'watchEffect', 'onMounted'];

/**
 * Vue `watch`/`watchEffect` callbacks support an `onCleanup` function argument
 * (3rd param for `watch`, 1st for `watchEffect`) the developer uses to register
 * teardown for the watcher's own run: `onCleanup(() => clearInterval(id))`.
 * Allocations cleared this way are legitimate, so they are validated against
 * their owning watcher instead of only against global `onUnmounted`.
 */
const WATCH_CONTAINERS = new Set(['watch', 'watchEffect']);

/** Index of the `onCleanup` registrar parameter in the watcher callback. */
const ON_CLEANUP_PARAM_INDEX: Record<string, number> = {
  watchEffect: 0,
  watch: 2,
};

/**
 * Walks a teardown callback body, collecting the names of every resource it
 * explicitly clears into `clearedInHooks`.
 */
function collectClearances(body: any, clearedInHooks: Set<string>): void {
  walk(body, {
    enter(child: any) {
      if (child.type !== 'CallExpression') return;
      const callee = child.callee;
      let cname = '';

      if (callee.type === 'Identifier') {
        cname = callee.name;
      } else if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
        cname = callee.property.name;
      }

      if (TEARDOWN_CALLS.has(cname)) {
        const cleared =
          callee.type === 'Identifier'
            ? getExpressionName(child.arguments[0])
            : getExpressionName(callee.object);
        if (cleared) clearedInHooks.add(cleared);
      }
    },
  });
}

function getWatchCallback(node: any, name: string): any {
  const args = node.arguments ?? [];
  if (name === 'watchEffect') return args[0];
  // `watch(source, callback, options?)` — the callback is the 2nd argument.
  return args[1] ?? args[0];
}

/**
 * Reads the name of the `onCleanup` registrar parameter of a watcher callback
 * (e.g. `watch(source, (v, o, onCleanup) => ...)`), or null when the callback
 * does not accept one.
 */
function getOnCleanupParamName(name: string, callback: any): string | null {
  if (!callback) return null;
  const params =
    callback.params && callback.params.type === 'FormalParameters'
      ? callback.params.items ?? []
      : callback.params ?? [];
  const param = params[ON_CLEANUP_PARAM_INDEX[name]];
  if (!param || param.type !== 'Identifier') return null;
  return param.name;
}

/**
 * Walks a watcher callback body looking for invocations of the `onCleanup`
 * registrar (e.g. `onCleanup(() => clearInterval(id))`) and collects the
 * clearances from inside the registered teardown into `clearedInHooks`.
 */
function collectOnCleanupClearances(callback: any, onCleanupParam: string, clearedInHooks: Set<string>): void {
  if (!callback || !callback.body) return;
  walk(callback.body, {
    enter(child: any) {
      if (child.type !== 'CallExpression') return;
      const callee = child.callee;
      if (!callee || callee.type !== 'Identifier' || callee.name !== onCleanupParam) return;

      const cleanupFn = child.arguments[0];
      if (
        cleanupFn &&
        (cleanupFn.type === 'ArrowFunctionExpression' || cleanupFn.type === 'FunctionExpression')
      ) {
        collectClearances(cleanupFn.body, clearedInHooks);
      }
    },
  });
}

export const vueMissingOnUnmountedRule: RuleDefinition = {
  id: 'vue/missing-onunmounted',
  description: 'Checks if subscriptions are created in Vue setup scope without being cleared in onUnmounted.',
  category: 'vue',
  defaultSeverity: 'error',

  create(context: RuleContext) {
    const tracker = new ScopeTracker();
    const allocations: { name: string | null; node: any; scopeId: number }[] = [];
    const clearedInHooks = new Set<string>();

    // Watcher containers: per-`watch`/`watchEffect` clearances registered via
    // the callback's `onCleanup` parameter, scoped to that watcher's own
    // allocations.
    let pendingWatchContainerFn: any = null;
    const watchContainerNodeStack: any[] = [];
    const watchContainers: { scopeId: number; clearances: Set<string> }[] = [];

    function findEnclosingWatchContainer(scopeId: number) {
      let best: { scopeId: number; clearances: Set<string> } | null = null;
      for (const container of watchContainers) {
        if (tracker.isDescendantOrSame(scopeId, container.scopeId)) {
          if (!best || container.scopeId > best.scopeId) best = container;
        }
      }
      return best;
    }

    const visitor: RuleVisitor = {};

    attachScopeListeners(tracker, visitor, {
      onFunctionScopeEnter(node: any, parent: any, _tag: string | null, scopeId: number) {
        // The watcher callback itself: open a container so allocations made
        // inside it are validated against the onCleanup registrations for that
        // specific watcher.
        if (pendingWatchContainerFn && node === pendingWatchContainerFn) {
          pendingWatchContainerFn = null;
          const target = watchContainers[watchContainers.length - 1];
          target.scopeId = scopeId;
          watchContainerNodeStack.push(node);
        }
      },

      onFunctionScopeExit(node: any) {
        if (watchContainerNodeStack.length && node === watchContainerNodeStack[watchContainerNodeStack.length - 1]) {
          watchContainerNodeStack.pop();
        }
      },
    });

    visitor.CallExpression = (node: any, parent: any, ancestors?: any[]) => {
      const callee = node.callee;
      let name = '';

      if (callee.type === 'Identifier') {
        name = callee.name;
      } else if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
        name = callee.property.name;
      }

      if (!name) return;

      // Lifecycle teardown hook: collect the variable names it explicitly clears.
      if (TEARDOWN_HOOKS.has(name)) {
        const callback = node.arguments[0];

        if (!callback) return;
        if (callback.type === 'ArrowFunctionExpression' || callback.type === 'FunctionExpression') {
          collectClearances(callback.body, clearedInHooks);
          return;
        }

        // `onUnmounted(cleanup)` — resolve the referenced local function. If it
        // can't be found (e.g. imported from another file), assume the external
        // teardown handles it and suppress all warnings for this file.
        if (callback.type === 'Identifier') {
          const body = findFunctionBodyInAncestors(callback.name, ancestors);
          if (body) collectClearances(body, clearedInHooks);
          else clearedInHooks.add('*');
        }
        return;
      }

      // `watch(source, (v, o, onCleanup) => { const id = setInterval(...);
      // onCleanup(() => clearInterval(id)); })` — allocate a container that
      // collects this watcher's onCleanup registrations.
      if (WATCH_CONTAINERS.has(name)) {
        const callback = getWatchCallback(node, name);
        if (
          callback &&
          (callback.type === 'ArrowFunctionExpression' || callback.type === 'FunctionExpression') &&
          callback.body &&
          (callback.body.type === 'BlockStatement' || callback.body.type === 'FunctionBody')
        ) {
          const onCleanupParam = getOnCleanupParamName(name, callback);
          const clearances = new Set<string>();
          if (onCleanupParam) collectOnCleanupClearances(callback, onCleanupParam, clearances);

          watchContainers.push({ scopeId: -1, clearances });
          pendingWatchContainerFn = callback;
        }
        return;
      }

      // Track allocations made directly in the component setup scope, as well
      // as allocations inside reactive wrappers (watch/watchEffect/onMounted).
      // Allocations inside helper functions, event callbacks, or lifecycle
      // hooks that are not reactive are not this rule's responsibility.
      if (
        LEAKY_CALLS.has(name) &&
        (!tracker.isNestedInFunction() || tracker.isNestedInReactiveEffect(REACTIVE_LEAK_CONTAINERS))
      ) {
        const isAllowlisted =
          callee.type === 'Identifier'
            ? context.isAllowlisted(name, 'function')
            : context.isAllowlisted(name, 'method');

        if (!isAllowlisted) {
          const target = getAllocationTarget(parent, undefined, context.isAllowlisted);
          if (target.name && !target.isHandledExternally && !target.isCollection) {
            allocations.push({ name: target.name, node, scopeId: tracker.currentScopeId() });
          }
        }
      }
    };

    visitor['Program:exit'] = () => {
      if (clearedInHooks.has('*')) return;
      for (const alloc of allocations) {
        if (!alloc.name) continue;

        // An allocation inside a watcher is also considered cleared when that
        // watcher's own `onCleanup` registrar releases it.
        const container = findEnclosingWatchContainer(alloc.scopeId);
        const clearedInWatcher = container ? container.clearances.has(alloc.name) : false;

        if (!clearedInHooks.has(alloc.name) && !clearedInWatcher) {
          context.report({
            ruleId: 'vue/missing-onunmounted',
            message: `Resource '${alloc.name}' is allocated in the setup scope but never cleared in onUnmounted.`,
            suggestion: `Call clearInterval(${alloc.name}) (or the appropriate cleanup) inside onUnmounted() or onBeforeUnmount().`,
            line: alloc.node.loc?.start?.line ?? 1,
            column: alloc.node.loc?.start?.column ?? 0,
          });
        }
      }
    };

    return visitor;
  },
};