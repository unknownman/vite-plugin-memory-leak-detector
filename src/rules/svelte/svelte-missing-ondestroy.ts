import type { RuleContext, RuleDefinition } from '../../types/rule.js';
import { hasTeardownCall } from '../utils/teardown.js';

export const svelteMissingOnDestroyRule: RuleDefinition = {
  id: 'svelte/missing-ondestroy',
  description: 'Checks if subscriptions are created in Svelte components without onDestroy.',
  category: 'svelte',
  defaultSeverity: 'error',

  create(context: RuleContext) {
    let hasLeakyCall = false;
    let hasTeardown = false;
    let leakyNode: any = null;

    return {
      CallExpression(node: any) {
        if (node.callee.type === 'Identifier') {
          const name = node.callee.name;
          if (name === 'onDestroy') {
            if (hasTeardownCall(node.arguments[0])) {
              hasTeardown = true;
            }
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
            ['addEventListener', 'setInterval'].includes(name) &&
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
            ruleId: 'svelte/missing-ondestroy',
            message: `Svelte component allocates external resources (timers, listeners) but does not call 'onDestroy'.`,
            suggestion: `Import 'onDestroy' from 'svelte' and clear intervals/listeners within it.`,
            line: leakyNode?.loc?.start?.line ?? 1,
            column: leakyNode?.loc?.start?.column ?? 0,
          });
        }
      },
    };
  },
};
