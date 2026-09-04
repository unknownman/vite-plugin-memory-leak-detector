import type { RuleContext, RuleDefinition } from '../../types/rule.js';
import { getExpressionName, getAllocationTarget } from '../utils/tracker.js';

export const noUnclearedTimersRule: RuleDefinition = {
  id: 'generic/no-uncleared-timers',
  description: 'Detects setInterval/requestAnimationFrame calls whose tracking variable is never cleared.',
  category: 'generic',
  defaultSeverity: 'warn',

  create(context: RuleContext) {
    const allocations: {
      type: string;
      name: string | null;
      node: any;
      isHandledExternally: boolean;
      isCollection: boolean;
    }[] = [];
    const clearedNames = new Set<string>();

    return {
      CallExpression(node: any, parent: any) {
        const callee = node.callee;
        let name = '';

        if (callee.type === 'Identifier') name = callee.name;
        else if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
          name = callee.property.name;
        }

        if (!name || context.isAllowlisted(name, callee.type === 'Identifier' ? 'function' : 'method')) return;

        // 1. Track Allocations
        if (['setInterval', 'setTimeout', 'requestAnimationFrame'].includes(name)) {
          const target = getAllocationTarget(parent);
          allocations.push({
            type: name,
            name: target.name,
            isHandledExternally: target.isHandledExternally,
            isCollection: target.isCollection,
            node,
          });
        }

        // 2. Track Deallocations (clearTimeout, clearInterval, cancelAnimationFrame)
        else if (['clearInterval', 'clearTimeout', 'cancelAnimationFrame'].includes(name)) {
          const arg = node.arguments[0];
          const clearedName = getExpressionName(arg);
          if (clearedName) clearedNames.add(clearedName);
        }
      },

      'Program:exit'() {
        for (const alloc of allocations) {
          // Fire-and-forget setTimeouts are usually okay. Focus on persistent intervals and animation loops.
          if (alloc.type === 'setTimeout') continue;

          // If passed to another function or stored in a global array/map, we assume it's safely handled.
          if (alloc.isHandledExternally || alloc.isCollection) continue;

          // If the timer is never assigned to a variable, it is definitely leaked.
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

          // If we tracked a variable, but never saw a corresponding clear function use that variable name.
          if (!clearedNames.has(alloc.name)) {
            const clearMethod = alloc.type === 'setInterval' ? 'clearInterval' : 'cancelAnimationFrame';
            context.report({
              ruleId: 'generic/no-uncleared-timers',
              message: `Timer '${alloc.name}' (${alloc.type}) is allocated but never cleared.`,
              suggestion: `Call ${clearMethod}(${alloc.name}) when the component or process finishes.`,
              line: alloc.node.loc?.start?.line ?? 1,
              column: alloc.node.loc?.start?.column ?? 0,
            });
          }
        }
      },
    };
  },
};
