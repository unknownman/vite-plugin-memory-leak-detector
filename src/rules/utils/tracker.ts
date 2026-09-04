/**
 * Extracts a string representation of an AST Node for tracking.
 * E.g., `Identifier` -> "timerId"
 * E.g., `MemberExpression` -> "this.timer" or "timers.myTimer"
 */
export function getExpressionName(node: any): string | null {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'ThisExpression') return 'this';

  if (node.type === 'MemberExpression') {
    const obj = getExpressionName(node.object);
    const prop = node.computed
      ? node.property.type === 'Literal'
        ? `[${node.property.value}]`
        : null
      : node.property.name || (node.property.type === 'Literal' ? node.property.value : null);

    if (obj && prop) return `${obj}.${prop}`;
  }
  return null;
}

export interface AllocationTarget {
  /** The name of the variable/property the allocation is assigned to */
  name: string | null;
  /** True if returned or passed as an argument to another function */
  isHandledExternally: boolean;
  /** True if pushed to an Array, Set, or Map (e.g., subscriptions.push(...)) */
  isCollection: boolean;
}

/**
 * Looks at the parent node of an allocation (like a setInterval call)
 * to determine where the result is being stored.
 */
export function getAllocationTarget(parent: any): AllocationTarget {
  if (!parent) return { name: null, isHandledExternally: false, isCollection: false };

  // const id = setInterval(...)
  if (parent.type === 'VariableDeclarator') {
    return { name: getExpressionName(parent.id), isHandledExternally: false, isCollection: false };
  }

  // this.id = setInterval(...)
  if (parent.type === 'AssignmentExpression') {
    return { name: getExpressionName(parent.left), isHandledExternally: false, isCollection: false };
  }

  // return setInterval(...)
  if (parent.type === 'ReturnStatement' || parent.type === 'ArrowFunctionExpression') {
    return { name: null, isHandledExternally: true, isCollection: false };
  }

  // myTimers.push(setInterval(...)) or register(setInterval(...))
  if (parent.type === 'CallExpression') {
    if (parent.callee.type === 'MemberExpression') {
      const prop = parent.callee.property.name || parent.callee.property.value;
      if (['push', 'add', 'set', 'insert'].includes(prop)) {
        return { name: getExpressionName(parent.callee.object), isHandledExternally: false, isCollection: true };
      }
    }
    // If it's passed as an argument to a function, we assume the function handles it.
    return { name: null, isHandledExternally: true, isCollection: false };
  }

  // { timer: setInterval(...) }
  if (parent.type === 'Property') {
    return { name: getExpressionName(parent.key), isHandledExternally: false, isCollection: true };
  }

  return { name: null, isHandledExternally: false, isCollection: false };
}
