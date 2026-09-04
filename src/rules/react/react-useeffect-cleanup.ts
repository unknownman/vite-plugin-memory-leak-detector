import { walk } from 'estree-walker';
import type { RuleContext, RuleDefinition } from '../../types/rule.js';

function checkEffectBody(effectBodyNode: any) {
  let hasCleanup = false;
  let hasLeakyCall = false;

  walk(effectBodyNode, {
    enter(child: any) {
      if (child.type === 'ReturnStatement' && child.argument) {
        hasCleanup = true;
      }

      // Check standard functional allocations (Timers, Listeners, Subscriptions, Fetch)
      if (child.type === 'CallExpression') {
        const callee = child.callee;
        let name = '';
        if (callee.type === 'Identifier') name = callee.name;
        if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
          name = callee.property.name;
        }

        if (
          ['setInterval', 'addEventListener', 'subscribe', 'on', 'fetch', 'requestAnimationFrame'].includes(name)
        ) {
          hasLeakyCall = true;
        }
      }

      // Check Object-based allocations (WebSockets, Observers, AbortControllers)
      if (child.type === 'NewExpression') {
        if (child.callee.type === 'Identifier') {
          const name = child.callee.name;
          if (
            [
              'WebSocket',
              'EventSource',
              'AbortController',
              'IntersectionObserver',
              'MutationObserver',
              'ResizeObserver',
              'PerformanceObserver',
            ].includes(name)
          ) {
            hasLeakyCall = true;
          }
        }
      }
    },
  });
  return { hasCleanup, hasLeakyCall };
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

            const { hasCleanup, hasLeakyCall } = checkEffectBody(effectFn.body);

            if (hasLeakyCall && !hasCleanup) {
              context.report({
                ruleId: 'react/react-useeffect-cleanup',
                message: `Effect hook creates subscriptions, listeners, observers, or timers but does not return a cleanup function.`,
                suggestion: `Return a cleanup function from your effect: \`return () => { ...teardown logic... }\`.`,
                line: node.loc?.start?.line ?? 1,
                column: node.loc?.start?.column ?? 0,
              });
            }
          }
        }
      },
    };
  },
};
