import { walk } from 'estree-walker';
import type { RuleContext, RuleDefinition } from '../../types/rule.js';
import {
  getExpressionName,
  getAllocationTarget,
  getDeclarationKind,
} from '../utils/tracker.js';
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
  description: 'Checks if subscriptions are created in Svelte component scope without being cleared in onDestroy.',
  category: 'svelte',
  defaultSeverity: 'error',

  create(context: RuleContext) {
    const tracker = new ScopeTracker();
    const allocations: { name: string | null; node: any }[] = [];
    const clearedInHooks = new Set<string>();

    return {
      Program() {
        tracker.enterRootScope();
      },

      BlockStatement: () => tracker.enterScope('block'),
      'BlockStatement:exit': () => tracker.leaveScope(),
      FunctionDeclaration: () => tracker.enterScope('function'),
      'FunctionDeclaration:exit': () => tracker.leaveScope(),
      FunctionExpression: () => tracker.enterScope('function'),
      'FunctionExpression:exit': () => tracker.leaveScope(),
      ArrowFunctionExpression: () => tracker.enterScope('function'),
      'ArrowFunctionExpression:exit': () => tracker.leaveScope(),

      VariableDeclarator(node: any, parent: any) {
        if (node.id.type === 'Identifier') {
          tracker.declareVariable(node.id.name, getDeclarationKind(parent));
        }
      },

      CallExpression(node: any, parent: any) {
        const callee = node.callee;
        let name = '';

        if (callee.type === 'Identifier') {
          name = callee.name;
        } else if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
          name = callee.property.name;
        }

        if (!name) return;

        // Lifecycle teardown hook: collect the variable names it explicitly clears.
        if (name === 'onDestroy') {
          const callback = node.arguments[0];
          if (
            callback &&
            (callback.type === 'ArrowFunctionExpression' || callback.type === 'FunctionExpression')
          ) {
            walk(callback.body, {
              enter(child: any) {
                if (child.type !== 'CallExpression') return;
                const c = child.callee;
                let cname = '';

                if (c.type === 'Identifier') {
                  cname = c.name;
                } else if (c.type === 'MemberExpression' && c.property.type === 'Identifier') {
                  cname = c.property.name;
                }

                if (TEARDOWN_CALLS.has(cname)) {
                  const cleared =
                    c.type === 'Identifier'
                      ? getExpressionName(child.arguments[0])
                      : getExpressionName(c.object);
                  if (cleared) clearedInHooks.add(cleared);
                }
              },
            });
          }
          return;
        }

        // Only track allocations made directly in the component scope. Allocations
        // inside helper functions or callbacks are not this rule's responsibility.
        if (LEAKY_CALLS.has(name) && !tracker.isNestedInFunction()) {
          const isAllowlisted =
            callee.type === 'Identifier'
              ? context.isAllowlisted(name, 'function')
              : context.isAllowlisted(name, 'method');

          if (!isAllowlisted) {
            const target = getAllocationTarget(parent, undefined, context.isAllowlisted);
            if (target.name && !target.isHandledExternally && !target.isCollection) {
              allocations.push({ name: target.name, node });
            }
          }
        }
      },

      'Program:exit'() {
        for (const alloc of allocations) {
          if (alloc.name && !clearedInHooks.has(alloc.name)) {
            context.report({
              ruleId: 'svelte/missing-ondestroy',
              message: `Resource '${alloc.name}' is allocated in the component scope but never cleared in onDestroy.`,
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