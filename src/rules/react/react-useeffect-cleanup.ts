import type { RuleContext, RuleDefinition, RuleVisitor } from '../../types/rule.js';
import { getExpressionName, getAllocationTarget, isManagedByAbortSignal } from '../utils/tracker.js';
import { ScopeTracker, attachScopeListeners } from '../utils/scope.js';

const LEAKY_CALLS = [
  'setInterval',
  'addEventListener',
  'subscribe',
  'on',
  'requestAnimationFrame',
];

const LEAKY_CTORS = [
  'WebSocket',
  'EventSource',
  'AbortController',
  'IntersectionObserver',
  'MutationObserver',
  'ResizeObserver',
  'PerformanceObserver',
];

const CLEARANCE_FUNCTIONS = new Set(['clearInterval', 'clearTimeout', 'cancelAnimationFrame']);

const CLEARANCE_METHODS = new Set(['close', 'abort', 'disconnect', 'unsubscribe', 'off']);

/**
 * Call names that are understood by this rule — either leaky resource
 * allocations or known clearance calls/methods. Anything else inside a cleanup
 * function is treated as an opaque, externally-managed teardown.
 */
const KNOWN_CALL_NAMES = new Set([
  ...LEAKY_CALLS,
  ...CLEARANCE_FUNCTIONS,
  ...CLEARANCE_METHODS,
  'removeEventListener',
]);

function getCalleeName(callee: any): string {
  if (!callee) return '';
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && callee.property && callee.property.type === 'Identifier') {
    return callee.property.name;
  }
  return '';
}

/**
 * Extracts the variable/function name a clearance call releases, or null if
 * it is not a clearance call.
 */
function getClearedName(node: any): string | null {
  const callee = node.callee;
  if (!callee) return null;

  if (callee.type === 'Identifier') {
    if (CLEARANCE_FUNCTIONS.has(callee.name)) return getExpressionName(node.arguments[0]);
    return null;
  }

  if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
    const prop = callee.property.name;
    if (prop === 'removeEventListener') return getExpressionName(node.arguments[1]);
    if (CLEARANCE_METHODS.has(prop)) return getExpressionName(callee.object);
    if (prop === 'addEventListener') return null;
  }
  return null;
}

interface EffectAllocation {
  name: string | null;
  type: string;
  node: any;
  isHandledExternally: boolean;
  isCollection: boolean;
  scopeId: number;
}

interface EffectContext {
  nodeRef: any;
  effectScopeId: number;
  /** Function scopes of returned cleanup functions (arrow/function expressions only). */
  cleanupScopeIds: Set<number>;
  allocations: EffectAllocation[];
  hasValidCleanup: boolean;
  hasOpaqueCleanupCall: boolean;
}

export const reactUseEffectCleanupRule: RuleDefinition = {
  id: 'react/react-useeffect-cleanup',
  description: 'Checks if useEffect creates subscriptions, workers, or controllers but lacks a cleanup function.',
  category: 'react',
  defaultSeverity: 'error',

  create(context: RuleContext) {
    const tracker = new ScopeTracker();

    let pendingEffectFn: any = null;
    const effectNodeStack: any[] = [];
    const effectContexts: EffectContext[] = [];

    function currentEffectContext(): EffectContext | null {
      return effectContexts.length ? effectContexts[effectContexts.length - 1] : null;
    }

    function isInsideCleanupScope(effect: EffectContext): boolean {
      const scopeId = tracker.currentScopeId();
      for (const cleanupScopeId of effect.cleanupScopeIds) {
        if (tracker.isDescendantOrSame(scopeId, cleanupScopeId)) return true;
      }
      return false;
    }

    function finalizeEffect(effect: EffectContext) {
      for (const alloc of effect.allocations) {
        if (alloc.isHandledExternally || alloc.isCollection) continue;

        if (!effect.hasValidCleanup) {
          context.report({
            ruleId: 'react/react-useeffect-cleanup',
            message: `Effect hook creates subscriptions, listeners, observers, or timers but does not return a cleanup function.`,
            suggestion: `Return a cleanup function from your effect: \`return () => { ...teardown logic... }\`.`,
            line: alloc.node.loc?.start?.line ?? effect.nodeRef.loc?.start?.line ?? 1,
            column: alloc.node.loc?.start?.column ?? effect.nodeRef.loc?.start?.column ?? 0,
          });
          continue;
        }

        if (!alloc.name) {
          context.report({
            ruleId: 'react/react-useeffect-cleanup',
            message: `Unassigned '${alloc.type}' is created inside the effect and cannot be cleaned up by a returned cleanup function.`,
            suggestion: `Assign the ${alloc.type} result to a variable and clear it via the cleanup function.`,
            line: alloc.node.loc?.start?.line ?? effect.nodeRef.loc?.start?.line ?? 1,
            column: alloc.node.loc?.start?.column ?? effect.nodeRef.loc?.start?.column ?? 0,
          });
          continue;
        }

        if (
          !tracker.isClearedWithin(alloc.name, alloc.scopeId, effect.effectScopeId) &&
          !effect.hasOpaqueCleanupCall
        ) {
          context.report({
            ruleId: 'react/react-useeffect-cleanup',
            message: `Resource '${alloc.name}' is allocated in the effect but the returned cleanup function does not clear it.`,
            suggestion: `Clear '${alloc.name}' inside the returned cleanup function (e.g., clearInterval(${alloc.name})).`,
            line: alloc.node.loc?.start?.line ?? effect.nodeRef.loc?.start?.line ?? 1,
            column: alloc.node.loc?.start?.column ?? effect.nodeRef.loc?.start?.column ?? 0,
          });
        }
      }
    }

    const visitor: RuleVisitor = {};

    attachScopeListeners(tracker, visitor, {
      onFunctionScopeEnter(node: any, parent: any, _tag: string | null, scopeId: number) {
        // The effect function itself: begin a new effect context.
        if (pendingEffectFn && node === pendingEffectFn) {
          pendingEffectFn = null;
          effectContexts.push({
            nodeRef: node,
            effectScopeId: scopeId,
            cleanupScopeIds: new Set(),
            allocations: [],
            hasValidCleanup: false,
            hasOpaqueCleanupCall: false,
          });
          effectNodeStack.push(node);
          return;
        }

        // A function returned from a ReturnStatement inside an effect is
        // treated as the cleanup function.
        const effect = currentEffectContext();
        if (effect && parent && parent.type === 'ReturnStatement' && parent.argument === node) {
          effect.hasValidCleanup = true;
          if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') {
            effect.cleanupScopeIds.add(scopeId);
          }
        }
      },

      onFunctionScopeExit(node: any) {
        if (effectNodeStack.length && node === effectNodeStack[effectNodeStack.length - 1]) {
          effectNodeStack.pop();
          const effect = effectContexts.pop();
          if (effect) finalizeEffect(effect);
        }
      },
    });

    visitor.CallExpression = (node: any, parent: any) => {
      const callee = node.callee;
      const name = getCalleeName(callee);

      // Register the effect callback so its function scope opens an effect context.
      if (
        callee.type === 'Identifier' &&
        (callee.name === 'useEffect' || callee.name === 'useLayoutEffect')
      ) {
        const effectFn = node.arguments[0];
        if (effectFn && (effectFn.type === 'ArrowFunctionExpression' || effectFn.type === 'FunctionExpression')) {
          const body = effectFn.body;
          if (body && (body.type === 'BlockStatement' || body.type === 'FunctionBody')) {
            pendingEffectFn = effectFn;
          }
        }
        return;
      }

      const effect = currentEffectContext();
      if (!effect) return;

      // Opaque external teardown inside a returned cleanup function suppresses
      // "resource not cleared" warnings.
      if (name && !KNOWN_CALL_NAMES.has(name) && isInsideCleanupScope(effect)) {
        effect.hasOpaqueCleanupCall = true;
      }

      // Allocations.
      if (LEAKY_CALLS.includes(name)) {
        let allocName: string | null = null;
        let isHandledExternally = false;
        let isCollection = false;

        if (name === 'addEventListener') {
          if (isManagedByAbortSignal(node.arguments[2])) return;
          allocName = getExpressionName(node.arguments[1]);
        } else {
          const target = getAllocationTarget(parent, undefined, context.isAllowlisted);
          allocName = target.name;
          isHandledExternally = target.isHandledExternally;
          isCollection = target.isCollection;
        }

        effect.allocations.push({
          name: allocName,
          type: name,
          node,
          isHandledExternally,
          isCollection,
          scopeId: tracker.currentScopeId(),
        });
      }

      // Clearance references anywhere in the effect (including inside the
      // returned cleanup function), so resources are recognized as cleared
      // regardless of how the cleanup is written.
      const clearedName = getClearedName(node);
      if (clearedName) tracker.addClearance(clearedName);
    };

    visitor.NewExpression = (node: any, parent: any) => {
      const effect = currentEffectContext();
      if (!effect) return;

      if (node.callee.type === 'Identifier' && LEAKY_CTORS.includes(node.callee.name)) {
        const target = getAllocationTarget(parent, undefined, context.isAllowlisted);
        effect.allocations.push({
          name: target.name,
          type: node.callee.name,
          node,
          isHandledExternally: target.isHandledExternally,
          isCollection: target.isCollection,
          scopeId: tracker.currentScopeId(),
        });
      }
    };

    visitor.ReturnStatement = (node: any) => {
      const effect = currentEffectContext();
      if (!effect) return;

      // `return cleanup` (identifier) is a valid cleanup as long as the
      // referenced function clears the allocated resources.
      const arg = node.argument;
      if (
        arg &&
        (arg.type === 'ArrowFunctionExpression' ||
          arg.type === 'FunctionExpression' ||
          arg.type === 'Identifier')
      ) {
        effect.hasValidCleanup = true;
      }
    };

    return visitor;
  },
};