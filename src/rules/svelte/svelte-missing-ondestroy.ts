import { walk } from 'estree-walker';
import type { RuleContext, RuleDefinition } from '../../types/rule.js';
import { getExpressionName, getAllocationTarget } from '../utils/tracker.js';
import { ScopeTracker } from '../utils/scope.js';

const TEARDOWN_CALLS = new Set([
  'clearInterval',
  'clearTimeout',
  'cancelAnimationFrame',
  'removeEventListener',
  'unsubscribe',
  'off',
  'close',
  'abort',
  'disconnect',
]);

const LEAKY_CALLS = new Set(['setInterval', 'addEventListener']);

export const svelteMissingOnDestroyRule: RuleDefinition = {
  id: 'svelte/missing-ondestroy',
  description: 'Checks if subscriptions are created in Svelte components without onDestroy.',
  category: 'svelte',
  defaultSeverity: 'error',

  create(context: RuleContext) {
    const tracker = new ScopeTracker();
    const allocations: { name: string | null; node: any; scopeId: number }[] = [];

    return {
      Program() {
        tracker.enterRootScope();
      },

      CallExpression(node: any, parent: any, ancestors?: any[]) {
        const callee = node.callee;
        let name = '';

        if (callee.type === 'Identifier') {
          name = callee.name;
        } else if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
          name = callee.property.name;
        }

        if (!name) return;

        // Handle onDestroy: enter callback scope, find clearances, exit
        if (name === 'onDestroy') {
          const callback = node.arguments[0];
          if (
            callback &&
            (callback.type === 'ArrowFunctionExpression' || callback.type === 'FunctionExpression')
          ) {
            tracker.enterScope();

            walk(callback.body, {
              enter(child: any) {
                if (child.type === 'CallExpression') {
                  const c = child.callee;
                  let clearanceName = '';

                  if (c.type === 'Identifier') {
                    clearanceName = c.name;
                  } else if (c.type === 'MemberExpression' && c.property.type === 'Identifier') {
                    clearanceName = c.property.name;
                  }

                  if (TEARDOWN_CALLS.has(clearanceName)) {
                    const argName = getExpressionName(child.arguments[0]);
                    if (argName) tracker.addClearance(argName);
                  }
                }
              },
            });

            tracker.leaveScope();
          }
          return;
        }

        // Track leaky allocations
        if (LEAKY_CALLS.has(name)) {
          const isAllowlisted =
            callee.type === 'Identifier'
              ? context.isAllowlisted(name, 'function')
              : context.isAllowlisted(name, 'method');

          if (!isAllowlisted) {
            const target = getAllocationTarget(parent, ancestors);
            allocations.push({ name: target.name, node, scopeId: tracker.currentScopeId() });
            if (target.name) tracker.addAllocation(target.name);
          }
        }
      },

      FunctionDeclaration: () => tracker.enterScope(),
      'FunctionDeclaration:exit': () => tracker.leaveScope(),
      FunctionExpression: () => tracker.enterScope(),
      'FunctionExpression:exit': () => tracker.leaveScope(),
      ArrowFunctionExpression: () => tracker.enterScope(),
      'ArrowFunctionExpression:exit': () => tracker.leaveScope(),

      'Program:exit'() {
        for (const alloc of allocations) {
          if (!alloc.name) continue;

          if (!tracker.isCleared(alloc.name, alloc.scopeId)) {
            context.report({
              ruleId: 'svelte/missing-ondestroy',
              message: `Resource '${alloc.name}' is allocated but never cleaned up in onDestroy.`,
              suggestion: `Call clearInterval(${alloc.name}) (or the appropriate cleanup) inside onDestroy().`,
              line: alloc.node.loc?.start?.line ?? 1,
              column: alloc.node.loc?.start?.column ?? 0,
            });
          }
        }
      },
    };
  },
};
