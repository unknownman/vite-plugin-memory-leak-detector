import type { RuleContext, RuleDefinition } from '../../types/rule.js';

export const noUnregisteredListenersRule: RuleDefinition = {
  id: 'generic/no-unregistered-listeners',
  description: 'Detects addEventListener calls without matching removeEventListener.',
  category: 'generic',
  defaultSeverity: 'warn',

  create(context: RuleContext) {
    const adds: { event: string; target: string; node: any }[] = [];
    const removes: { event: string; target: string }[] = [];

    return {
      CallExpression(node: any) {
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.property.type === 'Identifier'
        ) {
          const method = node.callee.property.name;
          const target = node.callee.object.type === 'Identifier' ? node.callee.object.name : 'Element';
          const arg = node.arguments[0];
          const event = arg && arg.type === 'Literal' ? String(arg.value) : '*';

          if (method === 'addEventListener') {
            adds.push({ event, target, node });
          } else if (method === 'removeEventListener') {
            removes.push({ event, target });
          }
        }
      },
      'Program:exit'() {
        for (const add of adds) {
          const hasRemove = removes.some((r) => r.event === add.event || r.event === '*');
          if (!hasRemove) {
            context.report({
              ruleId: 'generic/no-unregistered-listeners',
              message: `Event listener for '${add.event}' is attached but never removed in this file.`,
              suggestion: 'Store the handler reference and call removeEventListener on teardown.',
              line: add.node.loc?.start?.line ?? 1,
              column: add.node.loc?.start?.column ?? 0,
            });
          }
        }
      },
    };
  },
};
