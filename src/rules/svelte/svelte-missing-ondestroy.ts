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
  description: 'Checks if subscriptions are created in Svelte components without onDestroy.',
  category: 'svelte',
  defaultSeverity: 'error',

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

      CallExpression(node: any, parent: any, ancestors?: any[]) {
        const callee = node.callee;
        let name = '';

        if (callee.type === 'Identifier') {
          name = callee.name;
        } else if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
          name = callee.property.name;
        }

        if (!name) return;

        // Record clearance calls so cleared resources are not reported.
        if (TEARDOWN_CALLS.has(name)) {
          const clearedName =
            callee.type === 'Identifier'
              ? getExpressionName(node.arguments[0])
              : getExpressionName(callee.object);
          if (clearedName) tracker.addClearance(clearedName);
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
            allocations.push({
              name: target.name,
              node,
              isHandledExternally: target.isHandledExternally,
              isCollection: target.isCollection,
              scopeId: tracker.currentScopeId(),
            });
            if (target.name) tracker.addAllocation(target.name);
          }
        }
      },

      'Program:exit'() {
        for (const alloc of allocations) {
          if (alloc.isHandledExternally || alloc.isCollection) continue;
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