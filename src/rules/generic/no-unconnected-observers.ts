import type { RuleContext, RuleDefinition } from '../../types/rule.js';
import { getExpressionName, getAllocationTarget } from '../utils/tracker.js';
import { ScopeTracker } from '../utils/scope.js';

export const noUnconnectedObserversRule: RuleDefinition = {
  id: 'generic/no-unconnected-observers',
  description: 'Detects Observers that are instantiated but whose specific instance is never disconnected.',
  category: 'generic',
  defaultSeverity: 'warn',

  create(context: RuleContext) {
    const tracker = new ScopeTracker();

    const allocations: {
      name: string | null;
      type: string;
      isHandledExternally: boolean;
      isCollection: boolean;
      node: any;
      scopeId: number;
    }[] = [];

    return {
      Program() {
        tracker.enterRootScope();
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

          if (!tracker.isCleared(alloc.name, alloc.scopeId)) {
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

      NewExpression(node: any, parent: any, ancestors?: any[]) {
        if (node.callee.type === 'Identifier') {
          const type = node.callee.name;
          if (
            ['IntersectionObserver', 'MutationObserver', 'ResizeObserver', 'PerformanceObserver'].includes(type)
          ) {
            const target = getAllocationTarget(parent, ancestors);
            const alloc = {
              name: target.name,
              type,
              isHandledExternally: target.isHandledExternally,
              isCollection: target.isCollection,
              node,
              scopeId: tracker.currentScopeId(),
            };
            allocations.push(alloc);
            if (target.name) tracker.addAllocation(target.name);
          }
        }
      },

      CallExpression(node: any) {
        if (node.callee.type === 'MemberExpression' && node.callee.property.type === 'Identifier') {
          if (node.callee.property.name === 'disconnect') {
            const disconnectedName = getExpressionName(node.callee.object);
            if (disconnectedName) tracker.addClearance(disconnectedName);
          }
        }
      },

      FunctionDeclaration: () => tracker.enterScope(),
      'FunctionDeclaration:exit': () => tracker.leaveScope(),
      FunctionExpression: () => tracker.enterScope(),
      'FunctionExpression:exit': () => tracker.leaveScope(),
      ArrowFunctionExpression: () => tracker.enterScope(),
      'ArrowFunctionExpression:exit': () => tracker.leaveScope(),
    };
  },
};
