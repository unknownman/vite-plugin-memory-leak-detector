/**
 * Extracts a string representation of an AST Node for tracking.
 * E.g., `Identifier` -> "timerId"
 * E.g., `MemberExpression` -> "this.timer" or "timers.myTimer"
 */
export function getExpressionName(node: any): string | null {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'ThisExpression') return 'this';

  // `obj?.timer` is wrapped in a ChainExpression by ESTree.
  if (node.type === 'ChainExpression') return getExpressionName(node.expression);

  if (node.type === 'MemberExpression') {
    const obj = getExpressionName(node.object);
    const prop = node.computed ? formatLiteralValue(node.property) : node.property.name || formatLiteralValue(node.property);

    if (obj && prop) return `${obj}.${prop}`;
  }
  return null;
}

/**
 * Reads a literal's value whether the node uses the ESTree `Literal` name or an
 * oxc-specific name (`StringLiteral`, `NumericLiteral`, `BooleanLiteral`, ...).
 * Returns `undefined` (via `''`) for non-literals so callers can fall back.
 */
function formatLiteralValue(node: any): string | null {
  if (!node) return null;
  const type = node.type;
  if (type === 'Literal' || (typeof type === 'string' && type.endsWith('Literal'))) {
    return node.value === null ? 'null' : `[${node.value}]`;
  }
  if (type === 'Identifier') return node.name;
  return null;
}

/**
 * Recursively extracts every bound identifier from a binding pattern.
 * Supports `Identifier`, `ObjectPattern`, `ArrayPattern`, `AssignmentPattern`
 * (destructuring defaults) and `RestElement` (rest/spread) nodes, including
 * arbitrarily nested combinations.
 */
export function extractIdentifiersFromPattern(pattern: any): string[] {
  if (!pattern) return [];
  switch (pattern.type) {
    case 'Identifier':
      return [pattern.name];
    case 'ObjectPattern':
      return (pattern.properties ?? []).flatMap((prop: any) =>
        prop ? extractIdentifiersFromPattern(prop.type === 'RestElement' ? prop.argument : prop.value) : []
      );
    case 'ArrayPattern':
      return (pattern.elements ?? []).flatMap((element: any) =>
        element ? extractIdentifiersFromPattern(element.type === 'RestElement' ? element.argument : element) : []
      );
    case 'AssignmentPattern':
      return extractIdentifiersFromPattern(pattern.left);
    case 'RestElement':
      return extractIdentifiersFromPattern(pattern.argument);
    default:
      return [];
  }
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
      // React state setters (setFoo(...)) take ownership of the value, so the
      // resource is managed externally by the component state.
      if (curr.callee.type === 'Identifier' && /^set[A-Z]/.test(curr.callee.name)) {
        return { name: null, isHandledExternally: true, isCollection: false };
      }
      return { name: null, isHandledExternally: false, isCollection: false };
    }

    // { timer: setInterval(...) } — the allocation is bound to the property
    // key, so a destructured variable of the same name can be cleared.
    if (curr.type === 'Property' || curr.type === 'ObjectProperty') {
      return {
        name: curr.key && curr.key.type === 'Identifier' ? curr.key.name : null,
        isHandledExternally: false,
        isCollection: false,
      };
    }

    // [setInterval(...)] — the allocation is captured by an array literal,
    // which the consumer owns; treat it like a collection.
    if (curr.type === 'ArrayExpression') {
      return { name: null, isHandledExternally: false, isCollection: true };
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

/**
 * Returns true when an `addEventListener` call passes an `AbortSignal` via its
 * options argument (e.g. `{ signal: controller.signal }`), indicating the
 * listener is managed by an AbortController rather than removeEventListener.
 */
export function isManagedByAbortSignal(optionsArg: any): boolean {
  if (!optionsArg || optionsArg.type !== 'ObjectExpression') return false;
  return (optionsArg.properties ?? []).some(
    (prop: any) =>
      prop &&
      (prop.type === 'Property' || prop.type === 'ObjectProperty') &&
      prop.key &&
      prop.key.type === 'Identifier' &&
      prop.key.name === 'signal'
  );
}

/**
 * Searches the innermost containing Program/BlockStatement(s) for a local
 * function that an `Identifier` argument references: either a
 * `FunctionDeclaration` or a `VariableDeclarator` initialized with a function.
 * Returns the found function body node, or null when the identifier resolves to
 * nothing local (e.g. an import).
 */
export function findFunctionBodyInAncestors(identifierName: string, ancestors?: any[]): any {
  if (!ancestors || ancestors.length === 0) return null;

  for (let i = ancestors.length - 1; i >= 0; i--) {
    const container = ancestors[i];
    if (
      !container ||
      (container.type !== 'Program' && container.type !== 'BlockStatement')
    ) {
      continue;
    }
    const body = container.body;
    if (!Array.isArray(body)) continue;

    for (const stmt of body) {
      if (!stmt) continue;

      if (stmt.type === 'FunctionDeclaration' && stmt.id && stmt.id.name === identifierName) {
        return stmt.body;
      }

      if (stmt.type === 'VariableDeclaration') {
        const declarator = (stmt.declarations ?? []).find(
          (d: any) => d && d.id && d.id.type === 'Identifier' && d.id.name === identifierName
        );
        if (!declarator) continue;
        const init = declarator.init;
        if (
          init &&
          (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression')
        ) {
          return init.body;
        }
      }
    }
  }
  return null;
}
