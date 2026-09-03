import { walk } from 'estree-walker';
import type { RuleContext, RuleDefinition } from '../../types/rule.js';

function checkEffectBody(effectBodyNode: any) {
  let hasCleanup = false;
  let hasLeakyCall = false;

  // Deep scan the AST inside the useEffect callback
  walk(effectBodyNode, {
    enter(child: any) {
      if (child.type === 'ReturnStatement' && child.argument) {
        hasCleanup = true;
      }
      if (child.type === 'CallExpression') {
        const callee = child.callee;
        let name = '';
        if (callee.type === 'Identifier') name = callee.name;
        if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
          name = callee.property.name;
        }

        if (['setInterval', 'addEventListener', 'subscribe', 'on'].includes(name)) {
          hasLeakyCall = true;
        }
      }
    },
  });
  return { hasCleanup, hasLeakyCall };
}

export const reactUseEffectCleanupRule: RuleDefinition = {
  id: 'react/react-useeffect-cleanup',
  description: 'Checks if useEffect creates subscriptions but lacks a cleanup function.',
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
            if (effectFn.body.type !== 'BlockStatement') return; // Implicit returns might already be cleanups

            const { hasCleanup, hasLeakyCall } = checkEffectBody(effectFn.body);

            if (hasLeakyCall && !hasCleanup) {
              context.report({
                ruleId: 'react/react-useeffect-cleanup',
                message: `Effect hook creates subscriptions, listeners, or timers but does not return a cleanup function.`,
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
