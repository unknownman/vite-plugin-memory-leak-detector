import type { RuleContext, RuleDefinition } from '../../types/rule.js';
import { getExpressionName, getAllocationTarget, getDeclarationKind } from '../utils/tracker.js';
import { ScopeTracker } from '../utils/scope.js';

export const noUnclearedAnimationFramesRule: RuleDefinition = {
  id: 'generic/no-uncleared-animation-frames',
  description: 'Detects requestAnimationFrame calls whose tracking variable is never canceled.',
  category: 'generic',
  defaultSeverity: 'warn',

  create(context: RuleContext) {
    const tracker = new ScopeTracker();

    const allocations: {
      name: string | null;
      node: any;
      isHandledExternally: boolean;
      isCollection: boolean;
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
              ruleId: 'generic/no-uncleared-animation-frames',
              message: `A 'requestAnimationFrame' is started but never assigned to a variable, making it impossible to cancel.`,
              suggestion: `Assign the ID to a variable (e.g., 'const id = requestAnimationFrame(...)') and call cancelAnimationFrame(id) on teardown.`,
              line: alloc.node.loc?.start?.line ?? 1,
              column: alloc.node.loc?.start?.column ?? 0,
            });
            continue;
          }

          if (!tracker.isCleared(alloc.name, alloc.scopeId)) {
            context.report({
              ruleId: 'generic/no-uncleared-animation-frames',
              message: `Animation frame ID '${alloc.name}' is allocated but never canceled.`,
              suggestion: `Call cancelAnimationFrame(${alloc.name}) when the component unmounts to stop the animation loop.`,
              line: alloc.node.loc?.start?.line ?? 1,
              column: alloc.node.loc?.start?.column ?? 0,
            });
          }
        }
      },

      CallExpression(node: any, parent: any, ancestors?: any[]) {
        const callee = node.callee;
        let name = '';

        if (callee.type === 'Identifier') name = callee.name;
        else if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
          name = callee.property.name;
        }

        if (!name || context.isAllowlisted(name, callee.type === 'Identifier' ? 'function' : 'method')) return;

        if (name === 'requestAnimationFrame') {
          const target = getAllocationTarget(parent, ancestors, context.isAllowlisted);
          const alloc = {
            name: target.name,
            isHandledExternally: target.isHandledExternally,
            isCollection: target.isCollection,
            node,
            scopeId: tracker.currentScopeId(),
          };
          allocations.push(alloc);
          if (target.name) tracker.addAllocation(target.name);
        } else if (name === 'cancelAnimationFrame') {
          const arg = node.arguments[0];
          const canceledName = getExpressionName(arg);
          if (canceledName) tracker.addClearance(canceledName);
        }
      },
    };
  },
};
