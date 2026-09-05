import { walk } from 'estree-walker';
import type { RuleContext, RuleDefinition, RuleVisitor } from '../../types/rule.js';
import {
  getExpressionName,
  getAllocationTarget,
  findFunctionBodyInAncestors,
} from '../utils/tracker.js';
import { ScopeTracker, attachScopeListeners } from '../utils/scope.js';

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

const LEAKY_CALLS = new Set(['setInterval', 'addEventListener']);

/**
 * Reactive wrappers whose inline callbacks run as part of the component
 * lifecycle. Allocations made inside these (e.g. `$effect(() => { setInterval(...) })`
 * or `onMount(() => { setInterval(...) })`) must be cleared in `onDestroy` —
 * or, for Svelte 5 runes, in a cleanup function returned from the
 * `$effect`/`onMount` callback itself — so they are scanned. Plain DOM/event
 * callbacks remain out of scope.
 */
const REACTIVE_LEAK_CONTAINERS = ['$effect', 'onMount'];

/** Callbacks whose returned function acts as the effect's teardown. */
const CLEANUP_RETURN_CONTAINERS = new Set(['$effect', 'onMount']);

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

export const svelteMissingOnDestroyRule: RuleDefinition = {
  id: 'svelte/missing-ondestroy',
  description: 'Checks if subscriptions are created in Svelte component scope without being cleared in onDestroy.',
  category: 'svelte',
  defaultSeverity: 'error',

  create(context: RuleContext) {
    const tracker = new ScopeTracker();
    const allocations: { name: string | null; node: any; scopeId: number }[] = [];
    const clearedInHooks = new Set<string>();

    // Svelte 5 runes: `$effect(() => { ... return () => cleanup() })` (and the
    // Svelte 4 `onMount` equivalent) teardown a resource by returning a cleanup
    // function from the callback itself.
    let pendingCleanupReturnFn: any = null;
    const cleanupReturnNodeStack: any[] = [];
    const cleanupReturnScopes: { node: any; scopeId: number }[] = [];

    function findEnclosingCleanupReturnScope(scopeId: number) {
      let best: { node: any; scopeId: number } | null = null;
      for (const entry of cleanupReturnScopes) {
        if (tracker.isDescendantOrSame(scopeId, entry.scopeId)) {
          if (!best || entry.scopeId > best.scopeId) best = entry;
        }
      }
      return best;
    }

    const visitor: RuleVisitor = {};

    attachScopeListeners(tracker, visitor, {
      onFunctionScopeEnter(node: any, parent: any, _tag: string | null, scopeId: number) {
        // The effect/onMount callback itself: open a container whose returned
        // cleanup function is valid teardown for allocations inside it.
        if (pendingCleanupReturnFn && node === pendingCleanupReturnFn) {
          pendingCleanupReturnFn = null;
          cleanupReturnScopes.push({ node, scopeId });
          cleanupReturnNodeStack.push(node);
        }
      },

      onFunctionScopeExit(node: any) {
        if (cleanupReturnNodeStack.length && node === cleanupReturnNodeStack[cleanupReturnNodeStack.length - 1]) {
          cleanupReturnNodeStack.pop();
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
      if (name === 'onDestroy') {
        const callback = node.arguments[0];

        if (!callback) return;
        if (callback.type === 'ArrowFunctionExpression' || callback.type === 'FunctionExpression') {
          collectClearances(callback.body, clearedInHooks);
          return;
        }

        // `onDestroy(cleanup)` — resolve the referenced local function. If it
        // can't be found (e.g. imported from another file), assume the external
        // teardown handles it and suppress all warnings for this file.
        if (callback.type === 'Identifier') {
          const body = findFunctionBodyInAncestors(callback.name, ancestors);
          if (body) collectClearances(body, clearedInHooks);
          else clearedInHooks.add('*');
        }
        return;
      }

      // Svelte 5 runes: `$effect(() => { ... return () => ... })`. Immediately
      // record clearances anywhere in the effect subtree (including inside the
      // returned cleanup function) so effect-scoped allocations are recognized
      // as teardown-cleared.
      if (CLEANUP_RETURN_CONTAINERS.has(name)) {
        const callback = node.arguments[0];
        if (
          callback &&
          (callback.type === 'ArrowFunctionExpression' || callback.type === 'FunctionExpression') &&
          callback.body &&
          (callback.body.type === 'BlockStatement' || callback.body.type === 'FunctionBody')
        ) {
          pendingCleanupReturnFn = callback;
        }
        return;
      }

      // Record anywhere-else clearances into the tracker so effect-scoped
      // allocations can be validated against the effect's own teardown.
      if (TEARDOWN_CALLS.has(name)) {
        const cleared =
          callee.type === 'Identifier'
            ? getExpressionName(node.arguments[0])
            : getExpressionName(callee.object);
        if (cleared) tracker.addClearance(cleared);
        return;
      }

      // Track allocations made directly in the component scope, as well as
      // allocations inside reactive wrappers ($effect/onMount). Allocations
      // inside helper functions or DOM/event callbacks are not this rule's
      // responsibility.
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

        // An allocation inside `$effect`/`onMount` is also considered cleared
        // when the callback's own returned cleanup function releases it.
        const container = findEnclosingCleanupReturnScope(alloc.scopeId);
        const clearedInContainer = container
          ? tracker.isClearedWithin(alloc.name, alloc.scopeId, container.scopeId)
          : false;

        if (!clearedInHooks.has(alloc.name) && !clearedInContainer) {
          context.report({
            ruleId: 'svelte/missing-ondestroy',
            message: `Resource '${alloc.name}' is allocated in the component scope but never cleared in onDestroy.`,
            suggestion: `Call clearInterval(${alloc.name}) (or the appropriate cleanup) inside onDestroy().`,
            line: alloc.node.loc?.start?.line ?? 1,
            column: alloc.node.loc?.start?.column ?? 0,
          });
        }
      }
    };

    return visitor;
  },
};