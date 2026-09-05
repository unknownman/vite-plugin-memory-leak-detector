import type { RuleContext, RuleDefinition, RuleVisitor } from '../../types/rule.js';
import { getExpressionName, getAllocationTarget } from '../utils/tracker.js';
import { ScopeTracker, attachScopeListeners } from '../utils/scope.js';

export const noUnclearedTimersRule: RuleDefinition = {
  id: 'generic/no-uncleared-timers',
  description: 'Detects setInterval calls whose tracking variable is never cleared.',
  category: 'generic',
  defaultSeverity: 'warn',

  create(context: RuleContext) {
    const tracker = new ScopeTracker();

    const allocations: {
      type: string;
      name: string | null;
      node: any;
      isHandledExternally: boolean;
      isCollection: boolean;
      scopeId: number;
    }[] = [];

    const visitor: RuleVisitor = {
      'Program:exit'() {
        for (const alloc of allocations) {
          if (alloc.type === 'setTimeout') continue;
          if (alloc.isHandledExternally || alloc.isCollection) continue;

          if (!alloc.name) {
            context.report({
              ruleId: 'generic/no-uncleared-timers',
              message: `A '${alloc.type}' is created but never assigned to a variable, making it impossible to clear.`,
              suggestion: `Assign the timer to a variable (e.g., 'const id = ${alloc.type}(...)') and clear it on teardown.`,
              line: alloc.node.loc?.start?.line ?? 1,
              column: alloc.node.loc?.start?.column ?? 0,
            });
            continue;
          }

          if (!tracker.isCleared(alloc.name, alloc.scopeId)) {
            if (tracker.isOnlyConditionallyCleared(alloc.name, alloc.scopeId)) {
              context.report({
                ruleId: 'generic/no-uncleared-timers',
                message: `Timer '${alloc.name}' (${alloc.type}) is only cleared conditionally (e.g. inside an \`if\`, \`switch\`, or \`&&\`), which may lead to leaks.`,
                suggestion: `Call clearInterval(${alloc.name}) unconditionally when the component or process finishes.`,
                line: alloc.node.loc?.start?.line ?? 1,
                column: alloc.node.loc?.start?.column ?? 0,
              });
              continue;
            }
            context.report({
              ruleId: 'generic/no-uncleared-timers',
              message: `Timer '${alloc.name}' (${alloc.type}) is allocated but never cleared.`,
              suggestion: `Call clearInterval(${alloc.name}) when the component or process finishes.`,
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

        if (['setInterval', 'setTimeout'].includes(name)) {
          const target = getAllocationTarget(parent, ancestors, context.isAllowlisted);
          const alloc = {
            type: name,
            name: target.name,
            isHandledExternally: target.isHandledExternally,
            isCollection: target.isCollection,
            node,
            scopeId: tracker.currentScopeId(),
          };
          allocations.push(alloc);
          if (target.name) tracker.addAllocation(target.name);
        } else if (['clearInterval', 'clearTimeout'].includes(name)) {
          const arg = node.arguments[0];
          const clearedName = getExpressionName(arg);
          if (clearedName) tracker.addClearance(clearedName);
        }
      },
    };
    attachScopeListeners(tracker, visitor);
    return visitor;
  },
};
