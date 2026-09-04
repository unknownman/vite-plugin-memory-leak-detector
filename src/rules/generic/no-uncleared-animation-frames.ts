import type { RuleContext, RuleDefinition } from '../../types/rule.js';
import { getExpressionName, getAllocationTarget } from '../utils/tracker.js';

export const noUnclearedAnimationFramesRule: RuleDefinition = {
  id: 'generic/no-uncleared-animation-frames',
  description: 'Detects requestAnimationFrame calls whose tracking variable is never canceled.',
  category: 'generic',
  defaultSeverity: 'warn',

  create(context: RuleContext) {
    const allocations: {
      name: string | null;
      node: any;
      isHandledExternally: boolean;
      isCollection: boolean;
    }[] = [];
    const canceledNames = new Set<string>();

    return {
      CallExpression(node: any, parent: any) {
        const callee = node.callee;
        let name = '';

        if (callee.type === 'Identifier') name = callee.name;
        else if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
          name = callee.property.name;
        }

        if (!name || context.isAllowlisted(name, callee.type === 'Identifier' ? 'function' : 'method')) return;

        if (name === 'requestAnimationFrame') {
          const target = getAllocationTarget(parent);
          allocations.push({
            name: target.name,
            isHandledExternally: target.isHandledExternally,
            isCollection: target.isCollection,
            node,
          });
        } else if (name === 'cancelAnimationFrame') {
          const arg = node.arguments[0];
          const canceledName = getExpressionName(arg);
          if (canceledName) canceledNames.add(canceledName);
        }
      },

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

          if (!canceledNames.has(alloc.name)) {
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
    };
  },
};
