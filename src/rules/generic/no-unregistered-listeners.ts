import type { RuleContext, RuleDefinition, RuleVisitor } from '../../types/rule.js';
import { getExpressionName, isManagedByAbortSignal } from '../utils/tracker.js';
import { ScopeTracker, attachScopeListeners } from '../utils/scope.js';

interface ListenerAdd {
  target: string;
  event: string;
  handler: string | null;
  node: any;
  scopeId: number;
}

interface ListenerRemove {
  target: string;
  event: string;
  handler: string | null;
  scopeId: number;
}

export const noUnregisteredListenersRule: RuleDefinition = {
  id: 'generic/no-unregistered-listeners',
  description: 'Detects addEventListener calls without matching removeEventListener for the same handler.',
  category: 'generic',
  defaultSeverity: 'warn',

  create(context: RuleContext) {
    const tracker = new ScopeTracker();
    const adds: ListenerAdd[] = [];
    const removes: ListenerRemove[] = [];

    const visitor: RuleVisitor = {
      'Program:exit'() {
        for (const add of adds) {
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

          if (add.handler) {
            const hasMatchingRemove = removes.some(
              (r) =>
                tracker.isDescendantOrSame(r.scopeId, add.scopeId) &&
                (r.target === add.target || r.target === 'global') &&
                (r.event === add.event || r.event === '*') &&
                r.handler === add.handler,
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
              // Listeners registered with an AbortSignal are torn down automatically
              // when the signal aborts, so they never need a removeEventListener.
              if (isManagedByAbortSignal(node.arguments[2])) return;
              adds.push({ target, event, handler, node, scopeId: tracker.currentScopeId() });
            } else {
              removes.push({ target, event, handler, scopeId: tracker.currentScopeId() });
            }
          }
        }
      },
    };
    attachScopeListeners(tracker, visitor);
    return visitor;
  },
};
