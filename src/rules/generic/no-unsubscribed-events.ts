import type { RuleContext, RuleDefinition } from '../../types/rule.js';
import { getExpressionName, getAllocationTarget } from '../utils/tracker.js';

export const noUnsubscribedEventsRule: RuleDefinition = {
  id: 'generic/no-unsubscribed-events',
  description: 'Detects reactive subscriptions (.subscribe / .on) without unsubscribe.',
  category: 'generic',
  defaultSeverity: 'warn',

  create(context: RuleContext) {
    const allocations: {
      name: string | null;
      method: string;
      isHandledExternally: boolean;
      isCollection: boolean;
      node: any;
    }[] = [];
    const unsubscribedNames = new Set<string>();

    return {
      CallExpression(node: any, parent: any) {
        if (node.callee.type === 'MemberExpression' && node.callee.property.type === 'Identifier') {
          const method = node.callee.property.name;

          if (method === 'subscribe' || method === 'on') {
            const target = getAllocationTarget(parent);
            allocations.push({
              name: target.name,
              method,
              isHandledExternally: target.isHandledExternally,
              isCollection: target.isCollection,
              node,
            });
          } else if (method === 'unsubscribe' || method === 'off') {
            const unsubscribedName = getExpressionName(node.callee.object);
            if (unsubscribedName) unsubscribedNames.add(unsubscribedName);
          }
        }
      },

      'Program:exit'() {
        for (const alloc of allocations) {
          if (alloc.isHandledExternally || alloc.isCollection) continue;

          if (!alloc.name) {
            context.report({
              ruleId: 'generic/no-unsubscribed-events',
              message: `A subscription using '.${alloc.method}()' is created but never assigned to a variable.`,
              suggestion: `Store the subscription in a variable and call '.unsubscribe()' on it when tearing down.`,
              line: alloc.node.loc?.start?.line ?? 1,
              column: alloc.node.loc?.start?.column ?? 0,
            });
            continue;
          }

          if (!unsubscribedNames.has(alloc.name)) {
            context.report({
              ruleId: 'generic/no-unsubscribed-events',
              message: `Subscription '${alloc.name}' is created but never unsubscribed.`,
              suggestion: `Call ${alloc.name}.unsubscribe() (or .off()) to clean it up.`,
              line: alloc.node.loc?.start?.line ?? 1,
              column: alloc.node.loc?.start?.column ?? 0,
            });
          }
        }
      },
    };
  },
};
