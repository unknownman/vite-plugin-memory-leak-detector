import type { RuleContext, RuleDefinition } from '../../types/rule.js';
import { getExpressionName, getAllocationTarget } from '../utils/tracker.js';

export const noUnconnectedObserversRule: RuleDefinition = {
  id: 'generic/no-unconnected-observers',
  description: 'Detects Observers that are instantiated but whose specific instance is never disconnected.',
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
    const disconnectedNames = new Set<string>();

    return {
      NewExpression(node: any, parent: any) {
        if (node.callee.type === 'Identifier') {
          const type = node.callee.name;
          if (
            ['IntersectionObserver', 'MutationObserver', 'ResizeObserver', 'PerformanceObserver'].includes(type)
          ) {
            const target = getAllocationTarget(parent);
            allocations.push({
              name: target.name,
              type,
              isHandledExternally: target.isHandledExternally,
              isCollection: target.isCollection,
              node,
            });
          }
        }
      },

      CallExpression(node: any) {
        if (node.callee.type === 'MemberExpression' && node.callee.property.type === 'Identifier') {
          if (node.callee.property.name === 'disconnect') {
            const disconnectedName = getExpressionName(node.callee.object);
            if (disconnectedName) disconnectedNames.add(disconnectedName);
          }
        }
      },

      'Program:exit'() {
        for (const alloc of allocations) {
          if (alloc.isHandledExternally || alloc.isCollection) continue;

          if (!alloc.name) {
            context.report({
              ruleId: 'generic/no-unconnected-observers',
              message: `A ${alloc.type} is created without being assigned to a variable.`,
              suggestion: `Assign the observer to a variable and call .disconnect() when it's no longer needed.`,
              line: alloc.node.loc?.start?.line ?? 1,
              column: alloc.node.loc?.start?.column ?? 0,
            });
            continue;
          }

          if (!disconnectedNames.has(alloc.name)) {
            context.report({
              ruleId: 'generic/no-unconnected-observers',
              message: `Observer '${alloc.name}' (${alloc.type}) is created but .disconnect() is never called.`,
              suggestion: `Call ${alloc.name}.disconnect() to prevent memory leaks.`,
              line: alloc.node.loc?.start?.line ?? 1,
              column: alloc.node.loc?.start?.column ?? 0,
            });
          }
        }
      },
    };
  },
};
