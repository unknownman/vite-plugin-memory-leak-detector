import type { RuleContext, RuleDefinition } from '../../types/rule.js';

export const solidMissingOnCleanupRule: RuleDefinition = {
  id: 'solid/missing-oncleanup',
  description: 'Checks if subscriptions are created in Solid components without onCleanup.',
  category: 'solid',
  defaultSeverity: 'error',

  create(context: RuleContext) {
    let hasLeakyCall = false;
    let hasTeardown = false;
    let leakyNode: any = null;

    return {
      CallExpression(node: any) {
        if (node.callee.type === 'Identifier') {
          const name = node.callee.name;
          if (name === 'onCleanup') hasTeardown = true;
          if (
            ['setInterval', 'addEventListener'].includes(name) &&
            !context.isAllowlisted(name, 'function')
          ) {
            hasLeakyCall = true;
            leakyNode = leakyNode || node;
          }
        }
      },
      'Program:exit'() {
        if (hasLeakyCall && !hasTeardown) {
          context.report({
            ruleId: 'solid/missing-oncleanup',
            message: `Solid component or effect allocates resources without registering 'onCleanup'.`,
            suggestion: `Import 'onCleanup' from 'solid-js' and tear down the resources to prevent memory leaks when signals update or components unmount.`,
            line: leakyNode?.loc?.start?.line ?? 1,
            column: leakyNode?.loc?.start?.column ?? 0,
          });
        }
      },
    };
  },
};
