import type { RuleContext, RuleDefinition } from '../../types/rule.js';
import { getExpressionName, getAllocationTarget } from '../utils/tracker.js';

export const noUnclosedWebsocketsRule: RuleDefinition = {
  id: 'generic/no-unclosed-websockets',
  description: 'Detects WebSocket or EventSource instantiations without a corresponding .close() call.',
  category: 'generic',
  defaultSeverity: 'warn',

  create(context: RuleContext) {
    const allocations: {
      name: string | null;
      type: string;
      isHandledExternally: boolean;
      isCollection: boolean;
      node: any;
    }[] = [];
    const closedNames = new Set<string>();

    return {
      NewExpression(node: any, parent: any) {
        if (node.callee.type === 'Identifier' && ['WebSocket', 'EventSource'].includes(node.callee.name)) {
          const type = node.callee.name;
          const target = getAllocationTarget(parent);

          allocations.push({
            name: target.name,
            type,
            isHandledExternally: target.isHandledExternally,
            isCollection: target.isCollection,
            node,
          });
        }
      },

      CallExpression(node: any) {
        if (node.callee.type === 'MemberExpression' && node.callee.property.type === 'Identifier') {
          if (node.callee.property.name === 'close') {
            const closedName = getExpressionName(node.callee.object);
            if (closedName) closedNames.add(closedName);
          }
        }
      },

      'Program:exit'() {
        for (const alloc of allocations) {
          if (alloc.isHandledExternally || alloc.isCollection) continue;

          if (!alloc.name) {
            context.report({
              ruleId: 'generic/no-unclosed-websockets',
              message: `A ${alloc.type} is created without being assigned to a variable.`,
              suggestion: `Assign the ${alloc.type} to a variable and call .close() when the connection is no longer needed to prevent memory leaks.`,
              line: alloc.node.loc?.start?.line ?? 1,
              column: alloc.node.loc?.start?.column ?? 0,
            });
            continue;
          }

          if (!closedNames.has(alloc.name)) {
            context.report({
              ruleId: 'generic/no-unclosed-websockets',
              message: `Connection '${alloc.name}' (${alloc.type}) is created but .close() is never called.`,
              suggestion: `Call ${alloc.name}.close() on component teardown.`,
              line: alloc.node.loc?.start?.line ?? 1,
              column: alloc.node.loc?.start?.column ?? 0,
            });
          }
        }
      },
    };
  },
};
