import type { RuleContext, RuleDefinition } from '../../types/rule.js';

export const noUnconnectedObserversRule: RuleDefinition = {
  id: 'generic/no-unconnected-observers',
  description: 'Detects Observers that are instantiated but never disconnected.',
  category: 'generic',
  defaultSeverity: 'warn',

  create(context: RuleContext) {
    const observers: { name: string; node: any }[] = [];
    let hasDisconnect = false;

    return {
      NewExpression(node: any) {
        if (
          node.callee.type === 'Identifier' &&
          ['IntersectionObserver', 'MutationObserver', 'ResizeObserver'].includes(node.callee.name)
        ) {
          observers.push({ name: node.callee.name, node });
        }
      },
      CallExpression(node: any) {
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.property.type === 'Identifier'
        ) {
          if (node.callee.property.name === 'disconnect') {
            hasDisconnect = true;
          }
        }
      },
      'Program:exit'() {
        if (!hasDisconnect && observers.length > 0) {
          for (const obs of observers) {
            context.report({
              ruleId: 'generic/no-unconnected-observers',
              message: `${obs.name} is instantiated but .disconnect() is never called.`,
              suggestion: `Call .disconnect() on the observer instance to prevent memory leaks when the component unmounts.`,
              line: obs.node.loc?.start?.line ?? 1,
              column: obs.node.loc?.start?.column ?? 0,
            });
          }
        }
      },
    };
  },
};
