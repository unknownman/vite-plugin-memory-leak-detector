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

/**
 * Returns the declaration kind (`var`, `let`, or `const`) for a
 * `VariableDeclarator` by reading its parent `VariableDeclaration` node.
 * Defaults to `let` for non-`VariableDeclaration` parents.
 */
export function getDeclarationKind(parent: any): 'var' | 'let' | 'const' {
  return parent && parent.type === 'VariableDeclaration' ? parent.kind : 'let';
}

export interface AllocationTarget {
  /** The name of the variable/property the allocation is assigned to */
  name: string | null;
  /** True if returned or passed as an argument to another function */
  isHandledExternally: boolean;
  /** True if pushed to an Array, Set, or Map (e.g., subscriptions.push(...)) */
  isCollection: boolean;
}

const PASS_THROUGH_TYPES = new Set([
  'ConditionalExpression',
  'LogicalExpression',
  'TSAsExpression',
  'TSTypeAssertion',
  'TSNonNullExpression',
  'ParenthesizedExpression',
  'SequenceExpression',
]);

/**
 * Looks at the parent node (or ancestor chain) of an allocation (like a setInterval call)
 * to determine where the result is being stored, traversing through conditionals,
 * logical operators, and type assertions.
 *
 * `isAllowlisted` lets wrapper functions (e.g. `register(setInterval(...))`)
 * count as "externally handled" only when the wrapper is explicitly allowlisted
 * by the user. Everything else is treated as unhandled.
 */
export function getAllocationTarget(
  parent: any,
  ancestors?: any[],
  isAllowlisted?: (name: string, type: 'function' | 'method') => boolean
): AllocationTarget {
  if (!parent && (!ancestors || ancestors.length === 0)) {
    return { name: null, isHandledExternally: false, isCollection: false };
  }

  // Build the list of nodes starting from the immediate parent walking upwards exclusively via ancestors
  const chain: any[] = [];
  if (ancestors && Array.isArray(ancestors) && ancestors.length > 0) {
    for (let i = ancestors.length - 1; i >= 0; i--) {
      chain.push(ancestors[i]);
    }
    if (parent && chain[0] !== parent) {
      chain.unshift(parent);
    }
  } else if (parent) {
    chain.push(parent);
  }

  for (const curr of chain) {
    if (!curr || typeof curr !== 'object') continue;

    // const id = setInterval(...)
    if (curr.type === 'VariableDeclarator') {
      return { name: getExpressionName(curr.id), isHandledExternally: false, isCollection: false };
    }

    // this.id = setInterval(...)
    if (curr.type === 'AssignmentExpression') {
      return { name: getExpressionName(curr.left), isHandledExternally: false, isCollection: false };
    }

    // return setInterval(...)
    if (curr.type === 'ReturnStatement' || curr.type === 'ArrowFunctionExpression') {
      return { name: null, isHandledExternally: true, isCollection: false };
    }

    // A wrapper call receiving the allocation. Only safe collection methods
    // (push/add/set/insert) and explicitly allowlisted wrapper functions are
    // treated as handled; anything else is conservatively flagged.
    if (curr.type === 'CallExpression') {
      if (curr.callee.type === 'MemberExpression') {
        const prop = curr.callee.property.name || curr.callee.property.value;
        if (['push', 'add', 'set', 'insert'].includes(prop)) {
          return { name: getExpressionName(curr.callee.object), isHandledExternally: false, isCollection: true };
        }
        return { name: null, isHandledExternally: false, isCollection: false };
      }
      if (curr.callee.type === 'Identifier' && isAllowlisted?.(curr.callee.name, 'function')) {
        return { name: null, isHandledExternally: true, isCollection: false };
      }
      return { name: null, isHandledExternally: false, isCollection: false };
    }

    // Pass through conditionals, logical expressions, and type wrappers
    if (PASS_THROUGH_TYPES.has(curr.type)) {
      continue;
    }

    // If we hit any statement or declaration boundary, or an unhandled expression, stop.
    if (curr.type.endsWith('Statement') || curr.type.endsWith('Declaration') || curr.type === 'Program') {
      break;
    }

    // Any other node type that is not a pass-through stops the chain
    break;
  }

  return { name: null, isHandledExternally: false, isCollection: false };
}
