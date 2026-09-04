import type { RuleContext, RuleDefinition } from '../../types/rule.js';
import { getExpressionName } from '../utils/tracker.js';

export const noUnregisteredListenersRule: RuleDefinition = {
  id: 'generic/no-unregistered-listeners',
  description: 'Detects addEventListener calls without matching removeEventListener for the same handler.',
  category: 'generic',
  defaultSeverity: 'warn',

  create(context: RuleContext) {
    const adds: { target: string; event: string; handler: string | null; node: any }[] = [];
    const removes: { target: string; event: string; handler: string | null }[] = [];

    return {
      CallExpression(node: any) {
        const callee = node.callee;
        if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
          const method = callee.property.name;
          if (context.isAllowlisted(method, 'method')) return;

          if (method === 'addEventListener' || method === 'removeEventListener') {
            const target = getExpressionName(callee.object) || 'global';

            const eventArg = node.arguments[0];
            const event = eventArg && eventArg.type === 'Literal' ? String(eventArg.value) : '*';

            const handler = getExpressionName(node.arguments[1]);

            if (method === 'addEventListener') {
              adds.push({ target, event, handler, node });
            } else {
              removes.push({ target, event, handler });
            }
          }
        }
      },

      'Program:exit'() {
        for (const add of adds) {
          // If they used an anonymous inline function on a persistent global target, it's an un-removable leak.
          if (!add.handler && ['window', 'document', 'document.body'].includes(add.target)) {
            context.report({
              ruleId: 'generic/no-unregistered-listeners',
              message: `Anonymous event listener added to '${add.target}' for event '${add.event}'. Anonymous listeners cannot be removed.`,
              suggestion: 'Extract the handler to a named function or variable so it can be passed to removeEventListener.',
              line: add.node.loc?.start?.line ?? 1,
              column: add.node.loc?.start?.column ?? 0,
            });
            continue;
          }

          // If the handler is tracked, look for an exact matching removal
          if (add.handler) {
            const hasMatchingRemove = removes.some(
              (r) =>
                (r.target === add.target || r.target === 'global') &&
                (r.event === add.event || r.event === '*') &&
                r.handler === add.handler
            );

            if (!hasMatchingRemove) {
              context.report({
                ruleId: 'generic/no-unregistered-listeners',
                message: `Event listener '${add.handler}' for '${add.event}' on '${add.target}' is never removed.`,
                suggestion: `Call ${add.target}.removeEventListener('${add.event}', ${add.handler}) on teardown.`,
                line: add.node.loc?.start?.line ?? 1,
                column: add.node.loc?.start?.column ?? 0,
              });
            }
          }
        }
      },
    };
  },
};
