import type { RuleContext, RuleDefinition } from '../../types/rule.js';

export const vueMissingOnUnmountedRule: RuleDefinition = {
  id: 'vue/missing-onunmounted',
  description: 'Checks if subscriptions are created in Vue components without onUnmounted.',
  category: 'vue',
  defaultSeverity: 'error',

  create(context: RuleContext) {
    let hasLeakyCall = false;
    let hasTeardown = false;
    let leakyNode: any = null;

    return {
      CallExpression(node: any) {
        if (node.callee.type === 'Identifier') {
          const name = node.callee.name;
          if (['onUnmounted', 'onBeforeUnmount'].includes(name)) {
            hasTeardown = true;
          }
          if (
            ['setInterval', 'addEventListener'].includes(name) &&
            !context.isAllowlisted(name, 'function')
          ) {
            hasLeakyCall = true;
            leakyNode = leakyNode || node;
          }
        } else if (
          node.callee.type === 'MemberExpression' &&
          node.callee.property.type === 'Identifier'
        ) {
          const name = node.callee.property.name;
          if (
            ['addEventListener', 'setInterval', 'subscribe'].includes(name) &&
            !context.isAllowlisted(name, 'method')
          ) {
            hasLeakyCall = true;
            leakyNode = leakyNode || node;
          }
        }
      },
      'Program:exit'() {
        if (hasLeakyCall && !hasTeardown) {
          context.report({
            ruleId: 'vue/missing-onunmounted',
            message: `Component allocates external resources (timers, listeners) but never calls 'onUnmounted' or 'onBeforeUnmount'.`,
            suggestion: `Import 'onUnmounted' from 'vue' and clean up your resources inside it to prevent memory leaks when the component is destroyed.`,
            line: leakyNode?.loc?.start?.line ?? 1,
            column: leakyNode?.loc?.start?.column ?? 0,
          });
        }
      },
    };
  },
};
