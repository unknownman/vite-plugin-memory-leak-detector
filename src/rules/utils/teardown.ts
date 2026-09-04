import { walk } from 'estree-walker';

export const TEARDOWN_CALLS = new Set([
  'clearInterval',
  'clearTimeout',
  'cancelAnimationFrame',
  'removeEventListener',
  'unsubscribe',
  'off',
  'close',
  'abort',
  'disconnect',
  'unobserve',
  'destroy',
  'cleanup',
  'cancel',
  'dispose',
  'clear',
  'stop',
  'remove',
]);

/**
 * Checks if an AST node (typically a teardown callback or its body)
 * contains a known clearance call (e.g. clearInterval, removeEventListener).
 */
export function hasTeardownCall(callbackNode: any): boolean {
  if (!callbackNode) return false;

  if (callbackNode.type === 'Identifier' && TEARDOWN_CALLS.has(callbackNode.name)) {
    return true;
  }

  const bodyNode =
    callbackNode.type === 'ArrowFunctionExpression' || callbackNode.type === 'FunctionExpression'
      ? callbackNode.body
      : callbackNode;

  if (!bodyNode) return false;

  let found = false;
  walk(bodyNode, {
    enter(child: any) {
      if (found) return;

      if (child.type === 'CallExpression') {
        const callee = child.callee;
        let name = '';
        if (callee.type === 'Identifier') {
          name = callee.name;
        } else if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
          name = callee.property.name;
        }

        if (name && TEARDOWN_CALLS.has(name)) {
          found = true;
        }
      }
    },
  });

  return found;
}
