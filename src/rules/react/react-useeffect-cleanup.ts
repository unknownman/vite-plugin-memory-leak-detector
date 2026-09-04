import { walk } from 'estree-walker';
import type { RuleContext, RuleDefinition } from '../../types/rule.js';

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

function checkEffectBody(effectBodyNode: any) {
  let hasCleanup = false;
  let hasLeakyCall = false;

  walk(effectBodyNode, {
    enter(child: any) {
      if (child.type === 'ReturnStatement' && child.argument) {
        const argType = child.argument.type;
        if (
          argType === 'ArrowFunctionExpression' ||
          argType === 'FunctionExpression' ||
          argType === 'Identifier'
        ) {
          hasCleanup = true;
        }
      }

      if (child.type === 'CallExpression') {
        const callee = child.callee;
        let name = '';
        if (callee.type === 'Identifier') name = callee.name;
        if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
          name = callee.property.name;
        }
        if (LEAKY_CALLS.includes(name)) {
          hasLeakyCall = true;
        }
      }

      if (child.type === 'NewExpression') {
        if (child.callee.type === 'Identifier' && LEAKY_CTORS.includes(child.callee.name)) {
          hasLeakyCall = true;
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
            // Arrow expression body (e.g., () => fetch(url)) has no block scope
            // to return a cleanup function — skip to avoid false positives.
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
