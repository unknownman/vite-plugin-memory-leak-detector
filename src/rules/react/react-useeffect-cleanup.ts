import type { NodePath } from '@babel/traverse';
import type {
  CallExpression,
  ArrowFunctionExpression,
  FunctionExpression,
  BlockStatement,
  ReturnStatement,
} from '@babel/types';
import { isIdentifier, isMemberExpression, isBlockStatement, isCallExpression } from '@babel/types';
import type { RuleContext, RuleDefinition } from '../../types/rule.js';

const EFFECT_NAMES = new Set(['useEffect', 'useLayoutEffect']);
const LEAKY_CALLS = new Set(['setInterval', 'setTimeout', 'addEventListener', 'subscribe']);

/**
 * Detects React `useEffect` / `useLayoutEffect` bodies that create
 * subscriptions, listeners, or timers, but do not return a cleanup function.
 */
export const reactUseEffectCleanupRule: RuleDefinition = {
  id: 'react/react-useeffect-cleanup',
  description:
    'Detects useEffect/useLayoutEffect callbacks that create subscriptions without returning a cleanup function.',
  category: 'react',
  defaultSeverity: 'error',

  create(context: RuleContext) {
    function isEffectCall(node: CallExpression): boolean {
      return (
        isIdentifier(node.callee) &&
        EFFECT_NAMES.has(node.callee.name)
      );
    }

    function hasCleanupReturn(
      fn: ArrowFunctionExpression | FunctionExpression
    ): boolean {
      // `useEffect(() => {...})` — arrow with a block body.
      if (isBlockStatement(fn.body)) {
        const returns = fn.body.body.filter(
          (s) => s.type === 'ReturnStatement'
        ) as ReturnStatement[];
        // A cleanup function is present if any return statement has an argument
        // (i.e. returns a function).
        return returns.some((r) => r.argument !== null && r.argument !== undefined);
      }

      // `useEffect(() => fn)` — implicit return.
      // An implicit-return arrow could itself return a function, so treat it
      // only when the body is a function expression/arrow (cleanup present)
      // or a call returning a handle (unclear). We treat non-block body that
      // returns a function as having cleanup.
      return fn.body.type === 'ArrowFunctionExpression' || fn.body.type === 'FunctionExpression';
    }

    function containsLeakyCall(body: BlockStatement): boolean {
      let found = false;

      function walk(node: unknown): void {
        if (found) return;
        if (!node || typeof node !== 'object') return;

        if (
          isCallExpression(node as CallExpression)
        ) {
          const call = node as CallExpression;
          const callee = call.callee;

          let name: string | null = null;
          if (isIdentifier(callee)) {
            name = callee.name;
          } else if (isMemberExpression(callee) && isIdentifier(callee.property)) {
            name = callee.property.name;
          }

          if (name && LEAKY_CALLS.has(name)) {
            found = true;
            return;
          }
        }

        (Object.values(node as Record<string, unknown>)).forEach((value) => {
          if (Array.isArray(value)) {
            value.forEach(walk);
          } else if (value && typeof value === 'object' && value !== null) {
            walk(value);
          }
        });
      }

      walk(body);
      return found;
    }

    return {
      CallExpression(path: NodePath<CallExpression>) {
        const node = path.node;
        if (!isEffectCall(node)) return;

        const firstArg = node.arguments[0];
        if (
          !firstArg ||
          (firstArg.type !== 'ArrowFunctionExpression' &&
            firstArg.type !== 'FunctionExpression')
        ) {
          return;
        }

        const fn = firstArg as ArrowFunctionExpression | FunctionExpression;
        const block = fn.body;
        if (!isBlockStatement(block)) return;

        if (containsLeakyCall(block) && !hasCleanupReturn(fn)) {
          const line = node.loc?.start.line ?? 1;
          const column = node.loc?.start.column ?? 0;

          context.report({
            ruleId: 'react/react-useeffect-cleanup',
            message:
              'useEffect/useLayoutEffect sets up a timer, event listener, or subscription, but does not return a cleanup function to tear it down.',
            suggestion:
              'Return a cleanup function from the effect that clears the timer, removes event listeners, or unsubscribes.',
            severity: 'error',
            line,
            column,
          });
        }
      },
    };
  },
};
