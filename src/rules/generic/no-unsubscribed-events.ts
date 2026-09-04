import type { RuleContext, RuleDefinition } from '../../types/rule.js';
import { getExpressionName, getAllocationTarget, getDeclarationKind } from '../utils/tracker.js';
import { ScopeTracker } from '../utils/scope.js';

export const noUnsubscribedEventsRule: RuleDefinition = {
  id: 'generic/no-unsubscribed-events',
  description: 'Detects reactive subscriptions (.subscribe / .on) without unsubscribe.',
  category: 'generic',
  defaultSeverity: 'warn',

  create(context: RuleContext) {
    const tracker = new ScopeTracker();

    const allocations: {
      name: string | null;
      method: string;
      isHandledExternally: boolean;
      isCollection: boolean;
      node: any;
      scopeId: number;
    }[] = [];

    return {
      Program() {
        tracker.enterRootScope();
      },

      VariableDeclarator(node: any, parent: any) {
        if (node.id.type === 'Identifier') {
          tracker.declareVariable(node.id.name, getDeclarationKind(parent));
        }
      },

      BlockStatement: () => tracker.enterScope('block'),
      'BlockStatement:exit': () => tracker.leaveScope(),
      FunctionDeclaration: () => tracker.enterScope('function'),
      'FunctionDeclaration:exit': () => tracker.leaveScope(),
      FunctionExpression: () => tracker.enterScope('function'),
      'FunctionExpression:exit': () => tracker.leaveScope(),
      ArrowFunctionExpression: () => tracker.enterScope('function'),
      'ArrowFunctionExpression:exit': () => tracker.leaveScope(),

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

          if (!tracker.isCleared(alloc.name, alloc.scopeId)) {
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

      CallExpression(node: any, parent: any, ancestors?: any[]) {
        if (node.callee.type === 'MemberExpression' && node.callee.property.type === 'Identifier') {
          const method = node.callee.property.name;

          if (method === 'subscribe' || method === 'on') {
            const target = getAllocationTarget(parent, ancestors);
            const alloc = {
              name: target.name,
              method,
              isHandledExternally: target.isHandledExternally,
              isCollection: target.isCollection,
              node,
              scopeId: tracker.currentScopeId(),
            };
            allocations.push(alloc);
            if (target.name) tracker.addAllocation(target.name);
          } else if (method === 'unsubscribe' || method === 'off') {
            const unsubscribedName = getExpressionName(node.callee.object);
            if (unsubscribedName) tracker.addClearance(unsubscribedName);
          }
        }
      },
    };
  },
};
