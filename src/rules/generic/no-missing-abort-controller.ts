import type { RuleContext, RuleDefinition } from '../../types/rule.js';
import { getExpressionName, getAllocationTarget } from '../utils/tracker.js';
import { ScopeTracker } from '../utils/scope.js';

export const noMissingAbortControllerRule: RuleDefinition = {
  id: 'generic/no-missing-abort-controller',
  description: 'Detects AbortController instantiations where .abort() is never called.',
  category: 'generic',
  defaultSeverity: 'warn',

  create(context: RuleContext) {
    const tracker = new ScopeTracker();

    const allocations: {
      name: string | null;
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
              ruleId: 'generic/no-missing-abort-controller',
              message: `An AbortController is created without being assigned to a variable.`,
              suggestion: `Assign the AbortController to a variable so you can pass its .signal to fetch() or addEventListener(), and call .abort() on teardown.`,
              line: alloc.node.loc?.start?.line ?? 1,
              column: alloc.node.loc?.start?.column ?? 0,
            });
            continue;
          }

          if (!tracker.isCleared(alloc.name, alloc.scopeId)) {
            context.report({
              ruleId: 'generic/no-missing-abort-controller',
              message: `AbortController '${alloc.name}' is instantiated but .abort() is never called.`,
              suggestion: `Call ${alloc.name}.abort() to cancel pending fetch requests or remove event listeners when tearing down.`,
              line: alloc.node.loc?.start?.line ?? 1,
              column: alloc.node.loc?.start?.column ?? 0,
            });
          }
        }
      },

      NewExpression(node: any, parent: any, ancestors?: any[]) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'AbortController') {
          const target = getAllocationTarget(parent, ancestors);
          const alloc = {
            name: target.name,
            isHandledExternally: target.isHandledExternally,
            isCollection: target.isCollection,
            node,
            scopeId: tracker.currentScopeId(),
          };
          allocations.push(alloc);
          if (target.name) tracker.addAllocation(target.name);
        }
      },

      CallExpression(node: any) {
        if (node.callee.type === 'MemberExpression' && node.callee.property.type === 'Identifier') {
          if (node.callee.property.name === 'abort') {
            const abortedName = getExpressionName(node.callee.object);
            if (abortedName) tracker.addClearance(abortedName);
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
