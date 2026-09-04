import { walk } from 'estree-walker';
import type { RuleContext, RuleDefinition } from '../../types/rule.js';
import { getExpressionName, getAllocationTarget } from '../utils/tracker.js';

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

interface EffectAllocation {
  name: string | null;
  type: string;
  node: any;
  isHandledExternally: boolean;
  isCollection: boolean;
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

/**
 * Walks the effect body collecting:
 *  - allocations: leaky subscription/listener/timer resources and whether they
 *    are assigned to a trackable variable name.
 *  - clearanceNames: every variable the effect releases (via clearInterval,
 *    removeEventListener, .close(), etc.).
 *  - hasValidCleanup: whether any ReturnStatement returns a function.
 */
function checkEffectBody(effectBodyNode: any) {
  const allocations: EffectAllocation[] = [];
  const clearanceNames = new Set<string>();
  let hasValidCleanup = false;

  walk(effectBodyNode, {
    enter(child: any, parent: any) {
      // Track leaky allocations. A cleanup is only valid if it clears the
      // *same variable* the allocation was assigned to.
      if (child.type === 'CallExpression') {
        const callee = child.callee;
        let name = '';
        if (callee.type === 'Identifier') name = callee.name;
        else if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
          name = callee.property.name;
        }

        // Allocations
        if (LEAKY_CALLS.includes(name)) {
          let allocName: string | null = null;
          let isHandledExternally = false;
          let isCollection = false;

          if (name === 'addEventListener') {
            // The resource is the handler function; anonymous handlers cannot
            // be tracked or removed by name.
            allocName = getExpressionName(child.arguments[1]);
          } else {
            const target = getAllocationTarget(parent);
            allocName = target.name;
            isHandledExternally = target.isHandledExternally;
            isCollection = target.isCollection;
          }

          allocations.push({
            name: allocName,
            type: name,
            node: child,
            isHandledExternally,
            isCollection,
          });
        }

        // Clearance references anywhere in the effect, so a returned cleanup
        // targeting the resource is recognized regardless of how it's written.
        const clearedName = getClearedName(child);
        if (clearedName) clearanceNames.add(clearedName);
      }

      if (child.type === 'NewExpression') {
        if (child.callee.type === 'Identifier' && LEAKY_CTORS.includes(child.callee.name)) {
          const target = getAllocationTarget(parent);
          allocations.push({
            name: target.name,
            type: child.callee.name,
            node: child,
            isHandledExternally: target.isHandledExternally,
            isCollection: target.isCollection,
          });
        }
      }

      // A valid cleanup is a ReturnStatement that actually returns a function
      // (arrow, function expression, or an identifier referring to one).
      if (child.type === 'ReturnStatement') {
        const arg = child.argument;
        if (
          arg &&
          (arg.type === 'ArrowFunctionExpression' ||
            arg.type === 'FunctionExpression' ||
            arg.type === 'Identifier')
        ) {
          hasValidCleanup = true;
        }
      }
    },
  });

  return { allocations, clearanceNames, hasValidCleanup };
}

export const reactUseEffectCleanupRule: RuleDefinition = {
  id: 'react/react-useeffect-cleanup',
  description: 'Checks if useEffect creates subscriptions, workers, or controllers but lacks a cleanup function.',
  category: 'react',
  defaultSeverity: 'error',

  create(context: RuleContext) {
    return {
      CallExpression(node: any) {
        if (
          node.callee.type === 'Identifier' &&
          ['useEffect', 'useLayoutEffect'].includes(node.callee.name)
        ) {
          const effectFn = node.arguments[0];
          if (!effectFn) return;

          if (
            effectFn.type === 'ArrowFunctionExpression' ||
            effectFn.type === 'FunctionExpression'
          ) {
            if (effectFn.body.type !== 'BlockStatement') return;

            const { allocations, clearanceNames, hasValidCleanup } = checkEffectBody(effectFn.body);

            for (const alloc of allocations) {
              if (alloc.isHandledExternally || alloc.isCollection) continue;

              if (!hasValidCleanup) {
                context.report({
                  ruleId: 'react/react-useeffect-cleanup',
                  message: `Effect hook creates subscriptions, listeners, observers, or timers but does not return a cleanup function.`,
                  suggestion: `Return a cleanup function from your effect: \`return () => { ...teardown logic... }\`.`,
                  line: alloc.node.loc?.start?.line ?? 1,
                  column: alloc.node.loc?.start?.column ?? 0,
                });
                continue;
              }

              if (!alloc.name) {
                context.report({
                  ruleId: 'react/react-useeffect-cleanup',
                  message: `Unassigned '${alloc.type}' is created inside the effect and cannot be cleaned up by a returned cleanup function.`,
                  suggestion: `Assign the ${alloc.type} result to a variable and clear it via the cleanup function.`,
                  line: alloc.node.loc?.start?.line ?? node.loc?.start?.line ?? 1,
                  column: alloc.node.loc?.start?.column ?? node.loc?.start?.column ?? 0,
                });
                continue;
              }

              if (!clearanceNames.has(alloc.name)) {
                context.report({
                  ruleId: 'react/react-useeffect-cleanup',
                  message: `Resource '${alloc.name}' is allocated in the effect but the returned cleanup function does not clear it.`,
                  suggestion: `Clear '${alloc.name}' inside the returned cleanup function (e.g., clearInterval(${alloc.name})).`,
                  line: alloc.node.loc?.start?.line ?? 1,
                  column: alloc.node.loc?.start?.column ?? 0,
                });
              }
            }
          }
        }
      },
    };
  },
};