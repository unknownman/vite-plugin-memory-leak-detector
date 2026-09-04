import type { RuleContext, RuleDefinition } from '../../types/rule.js';
import { getExpressionName, getAllocationTarget } from '../utils/tracker.js';
import { ScopeTracker } from '../utils/scope.js';

export const noUnclosedWebsocketsRule: RuleDefinition = {
  id: 'generic/no-unclosed-websockets',
  description: 'Detects WebSocket or EventSource instantiations without a corresponding .close() call.',
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
              ruleId: 'generic/no-unclosed-websockets',
              message: `A ${alloc.type} is created without being assigned to a variable.`,
              suggestion: `Assign the ${alloc.type} to a variable and call .close() when the connection is no longer needed to prevent memory leaks.`,
              line: alloc.node.loc?.start?.line ?? 1,
              column: alloc.node.loc?.start?.column ?? 0,
            });
            continue;
          }

          if (!tracker.isCleared(alloc.name, alloc.scopeId)) {
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

      NewExpression(node: any, parent: any, ancestors?: any[]) {
        if (node.callee.type === 'Identifier' && ['WebSocket', 'EventSource'].includes(node.callee.name)) {
          const type = node.callee.name;
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
      },

      CallExpression(node: any) {
        if (node.callee.type === 'MemberExpression' && node.callee.property.type === 'Identifier') {
          if (node.callee.property.name === 'close') {
            const closedName = getExpressionName(node.callee.object);
            if (closedName) tracker.addClearance(closedName);
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
