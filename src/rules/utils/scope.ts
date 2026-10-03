import type { RuleVisitor } from '../../types/rule.js';
import { extractIdentifiersFromPattern, getDeclarationKind } from './tracker.js';

export interface ScopedAllocation {
  name: string;
  scopeId: number;
}

interface RecordedClearance {
  name: string;
  scopeId: number;
  /** True when the clearance is guarded by a conditional (`if`, `switch`, `? :`, `&&`, `||`). */
  conditional: boolean;
}

export type ScopeKind = 'function' | 'block' | 'class';

/**
 * Function/method scope tags that are accepted as "teardown" contexts. A
 * member-expression resource (e.g. `this.timer`) may only be considered
 * cleared when the clearance occurs in the same scope subtree as the
 * allocation, or inside one of these lifecycle/teardown hooks.
 */
export const TEARDOWN_SCOPE_TAGS = new Set([
  'unmount',
  'onUnmount',
  'onUnmounted',
  'onBeforeUnmount',
  'componentWillUnmount',
  'onDestroy',
  'onCleanup',
  'close',
  'disconnect',
  'stop',
  'cleanup',
  'teardown',
]);

/**
 * Node types that open a lexical scope boundary. `block` is used for block
 * statements (and loop/switch bodies), `function` for function, method and
 * arrow bodies, and `class` for class bodies.
 */
const BLOCK_SCOPE_NODE_TYPES = ['BlockStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'SwitchStatement'];

const FUNCTION_SCOPE_NODE_TYPES = ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'];

const CLASS_SCOPE_NODE_TYPES = ['ClassDeclaration', 'ClassExpression'];

/**
 * Conditional constructs that should mark any clearance inside them as
 * "conditional" (a guard that may not execute).
 */
const CONDITIONAL_NODE_TYPES = ['IfStatement', 'SwitchCase', 'ConditionalExpression'];

/**
 * Conditional constructs whose guard expression lives on `.test`. `SwitchCase`
 * is deliberately absent: it has no guard expression of its own.
 */
const GUARDED_CONDITION_TYPES = new Set([
  'IfStatement',
  'ConditionalExpression',
  'WhileStatement',
  'DoWhileStatement',
]);

/**
 * Member-expression names rooted at `this` denote state that belongs to a
 * single class instance, so they are only resolvable inside the class scope
 * that owns them.
 */
function isClassInstanceMemberName(name: string): boolean {
  return name.startsWith('this.') || name.startsWith('this[');
}

/**
 * Lexical-environment-aware tracker for allocation/clearance pairs.
 *
 * Every scope boundary (Program root, function entry/body, block statement,
 * class body) receives a unique scope ID with a parent link. Declarations
 * (`let`, `const`, `var`) are recorded against the scope that lexically
 * contains them, so the same name declared in different scopes resolves to
 * distinct bindings.
 *
 * A clearance is valid only when the cleared name lexically resolves to the
 * exact same declaration scope as the allocation. This prevents false
 * negatives where two sibling functions each declare a local variable with
 * the same name but only one clears it.
 *
 * Class instance state (`this.*`) additionally respects class boundaries: an
 * allocation may only be cleared from within the same enclosing class.
 */
export class ScopeTracker {
  private nextScopeId = 0;
  private scopeStack: number[] = [];
  private parentMap = new Map<number, number>();
  private allocations: ScopedAllocation[] = [];
  private clearances: RecordedClearance[] = [];
  private declaredVariables = new Map<number, Set<string>>();
  private scopeKinds = new Map<number, ScopeKind>();
  private scopeTags = new Map<number, string | null>();
  private conditionalStack: any[] = [];

  /** Call at Program entry to create the root (module) scope. */
  enterRootScope() {
    const id = this.nextScopeId++;
    this.scopeKinds.set(id, 'function');
    this.scopeTags.set(id, null);
    this.scopeStack.push(id);
    return id;
  }

  /**
   * Enter a new scope boundary. Use `'function'` for function/arrow bodies,
   * `'class'` for class bodies, and `'block'` (default) for block statements
   * so `let`/`const` shadowing is modeled correctly.
   *
   * `tag` optionally records the CallExpression callee, method name, class
   * name, or function name that introduced this scope (e.g. `watch`,
   * `onMounted`, `stop`, `unmount`, `MyClass`), so rules can tell apart
   * reactive-effect wrappers from plain DOM/event callbacks and recognize
   * teardown contexts.
   */
  enterScope(kind: ScopeKind = 'block', tag: string | null = null) {
    const id = this.nextScopeId++;
    this.parentMap.set(id, this.currentScopeId());
    this.scopeKinds.set(id, kind);
    this.scopeTags.set(id, tag);
    this.scopeStack.push(id);
    return id;
  }

  leaveScope() {
    this.scopeStack.pop();
  }

  currentScopeId(): number {
    return this.scopeStack[this.scopeStack.length - 1] ?? 0;
  }

  enterConditional(node?: any) {
    this.conditionalStack.push(node ?? null);
  }

  exitConditional() {
    this.conditionalStack.pop();
  }

  isInConditionalBranch(): boolean {
    return this.conditionalStack.length > 0;
  }

  /**
   * Returns true when `node`, a conditional construct, directly guards the
   * given name. Recognizes a direct identifier test (`if (id)`), a comparison
   * against `null`/`undefined` (`if (id !== null)`, `if (id != undefined)`),
   * a logical short-circuit (`if (id && ready)` / `if (id || ready)`), and the
   * same patterns behind an optional chain (`if (id?.ready)`).
   */
  isSelfGuarded(node: any, name: string): boolean {
    if (!node || typeof node !== 'object' || !name) return false;

    // Unwrap the conditional wrapper to reach the guard expression itself.
    let guard = node;
    if (GUARDED_CONDITION_TYPES.has(guard.type)) {
      guard = guard.test;
    }
    if (!guard || typeof guard !== 'object') return false;

    // Optional chains wrap the real test in a ChainExpression.
    if (guard.type === 'ChainExpression') guard = guard.expression;
    if (!guard || typeof guard !== 'object') return false;

    if (guard.type === 'Identifier') return guard.name === name;

    if (guard.type === 'MemberExpression') {
      // `if (id?.ready)` — an optional chain only evaluates when the base
      // object is non-null, so reaching the body proves the resource exists.
      const object = guard.object;
      if (object?.type === 'Identifier') return object.name === name;
      if (object?.type === 'ChainExpression') return this.isSelfGuarded(object, name);
      return false;
    }

    const NULLISH = new Set(['null', 'undefined']);
    const isNullish = (operand: any): boolean =>
      (operand?.type === 'Literal' && operand.value === null) ||
      (operand?.type === 'Identifier' && NULLISH.has(operand.name));

    if (guard.type === 'BinaryExpression') {
      if (guard.operator !== '==' && guard.operator !== '===' && guard.operator !== '!=' && guard.operator !== '!==') {
        return false;
      }
      const left = guard.left?.type === 'Identifier' ? guard.left.name : null;
      const right = guard.right?.type === 'Identifier' ? guard.right.name : null;
      return (left === name && isNullish(guard.right)) || (right === name && isNullish(guard.left));
    }

    if (guard.type === 'LogicalExpression') {
      const left = guard.left?.type === 'Identifier' ? guard.left.name : null;
      const right = guard.right?.type === 'Identifier' ? guard.right.name : null;
      return left === name || right === name;
    }

    return false;
  }

  /**
   * Returns true if the current scope is nested inside a function boundary
   * (function declaration, function expression, arrow function, or class
   * method). The root module scope is not considered a function.
   */
  isNestedInFunction(): boolean {
    for (let i = 1; i < this.scopeStack.length; i++) {
      if (this.scopeKinds.get(this.scopeStack[i]) === 'function') return true;
    }
    return false;
  }

  /**
   * Returns true when the current position is nested inside a function scope
   * that was introduced as an argument to a CallExpression whose callee name
   * appears in `allowlist` (e.g. `watch`, `onMounted`, `createEffect`). This
   * lets framework rules scan reactive wrappers for leaks while still ignoring
   * plain DOM/event callbacks.
   */
  isNestedInReactiveEffect(allowlist: string[]): boolean {
    for (let i = 1; i < this.scopeStack.length; i++) {
      const tag = this.scopeTags.get(this.scopeStack[i]);
      if (tag && allowlist.includes(tag)) return true;
    }
    return false;
  }

  /**
   * Record a variable declaration in the current lexical environment.
   * `var` declarations are hoisted to the nearest enclosing function scope.
   */
  declareVariable(name: string, kind: 'var' | 'let' | 'const' | 'using' | 'await-using' = 'let') {
    const scopeId = kind === 'var' ? this.nearestFunctionScopeId() : this.currentScopeId();
    let names = this.declaredVariables.get(scopeId);
    if (!names) {
      names = new Set();
      this.declaredVariables.set(scopeId, names);
    }
    names.add(name);

    // Resources declared with `using` or `await using` are implicitly
    // handled by the runtime at block exit, so mark them as cleared.
    if (kind === 'using' || kind === 'await-using') {
      this.addClearance(name);
    }
  }

  addAllocation(name: string) {
    this.allocations.push({ name, scopeId: this.currentScopeId() });
  }

  addClearance(name: string) {
    const inConditional = this.isInConditionalBranch();
    // A clearance is unconditional when any enclosing guard tests for the
    // resource itself — `if (id) clearInterval(id)`. Nesting a further
    // conditional inside that guard must not downgrade it.
    const selfGuarded = inConditional && this.conditionalStack.some((node) => this.isSelfGuarded(node, name));
    this.clearances.push({
      name,
      scopeId: this.currentScopeId(),
      conditional: inConditional && !selfGuarded,
    });
  }

  /**
   * Resolves `name` starting at `fromScopeId` and walking up the scope chain,
   * returning the ID of the nearest (innermost) scope that declares it, or
   * `null` if no tracked declaration exists.
   */
  private resolveDeclarationScope(name: string, fromScopeId: number): number | null {
    let current: number | undefined = fromScopeId;
    while (current !== undefined) {
      const names = this.declaredVariables.get(current);
      if (names && names.has(name)) return current;
      current = this.parentMap.get(current);
    }
    return null;
  }

  private nearestFunctionScopeId(): number {
    for (let i = this.scopeStack.length - 1; i >= 0; i--) {
      const id = this.scopeStack[i];
      if (this.scopeKinds.get(id) === 'function') return id;
    }
    return this.scopeStack[this.scopeStack.length - 1] ?? 0;
  }

  private isTeardownScope(scopeId: number): boolean {
    let current: number | undefined = scopeId;
    while (current !== undefined) {
      const tag = this.scopeTags.get(current);
      if (tag && TEARDOWN_SCOPE_TAGS.has(tag)) return true;
      current = this.parentMap.get(current);
    }
    return false;
  }

  /**
   * Returns the ID of the nearest enclosing class scope for `scopeId`, or
   * `null` when the scope is not inside a class.
   *
   * The walk passes through block and function scopes so that allocations and
   * clearances written inside class methods (or blocks nested in them) resolve
   * to the owning class. The first class scope found is the answer, which means
   * the search stops at class boundaries: sibling classes resolve to different
   * IDs, and a nested class resolves to the inner one.
   */
  private findContainingClassScope(scopeId: number): number | null {
    let current: number | undefined = scopeId;
    while (current !== undefined) {
      if (this.scopeKinds.get(current) === 'class') return current;
      current = this.parentMap.get(current);
    }
    return null;
  }

  /**
   * Returns the ID of the class scope that owns the current position, or
   * `null` when not inside a class. Rules resolving `this.*` resources can use
   * this to pin an allocation to its class instance.
   */
  getEnclosingClassScopeId(): number | null {
    return this.findContainingClassScope(this.currentScopeId());
  }

  /**
   * Returns every clearance that is scope-applicable to the given allocation.
   *
   * For lexical names, the clearance must resolve to the exact same
   * declaration scope as the allocation (with a same-subtree fallback when the
   * name has no tracked declaration).
   *
   * For member expressions (`ref.current`) the resource lives on a shared
   * object/context, so a clearance applies only within the allocation's own
   * scope subtree or inside a recognized teardown scope (e.g. `unmount`,
   * `onUnmounted`, `close`, `stop`).
   *
   * For class instance state (`this.timer`, `this[key]`) the walk up the parent
   * chain halts as soon as it crosses a class boundary: a clearance only
   * applies when it resolves to the same enclosing class as the allocation.
   */
  private matchingClearances(name: string, allocScopeId: number): RecordedClearance[] {
    const isMemberExpression = name.includes('.') || name.includes('[');

    if (isMemberExpression) {
      const matches: RecordedClearance[] = [];

      if (isClassInstanceMemberName(name)) {
        const allocClassScope = this.findContainingClassScope(allocScopeId);

        for (const c of this.clearances) {
          if (c.name !== name) continue;
          // Halt on class boundary: the clearance must belong to the very same
          // class instance that owns the allocation. When neither side is in a
          // class (`null === null`) the legacy subtree rules still apply.
          if (this.findContainingClassScope(c.scopeId) !== allocClassScope) continue;
          if (this.isDescendantOrSame(c.scopeId, allocScopeId) || this.isTeardownScope(c.scopeId)) {
            matches.push(c);
          }
        }

        return matches;
      }

      // Shared-context members (`ref.current`, `store.subs`) are not owned by a
      // class, so they keep the original subtree/teardown behavior.
      return this.clearances.filter(
        (c) =>
          c.name === name &&
          (this.isDescendantOrSame(c.scopeId, allocScopeId) || this.isTeardownScope(c.scopeId))
      );
    }

    const allocDeclScope = this.resolveDeclarationScope(name, allocScopeId);
    const matches: RecordedClearance[] = [];

    for (const c of this.clearances) {
      if (c.name !== name) continue;

      const clearanceDeclScope = this.resolveDeclarationScope(name, c.scopeId);

      if (allocDeclScope !== null && clearanceDeclScope !== null) {
        if (allocDeclScope === clearanceDeclScope) matches.push(c);
        continue;
      }

      if (allocDeclScope === null && clearanceDeclScope === null) {
        if (this.isDescendantOrSame(c.scopeId, allocScopeId) || this.isDescendantOrSame(allocScopeId, c.scopeId)) {
          matches.push(c);
        }
      }
    }

    return matches;
  }

  /**
   * Returns true when `name` (allocated at `allocScopeId`) is cleared by at
   * least one scope-applicable, unconditional clearance.
   */
  isCleared(name: string, allocScopeId: number): boolean {
    return this.matchingClearances(name, allocScopeId).some((c) => !c.conditional);
  }

  /**
   * Returns true when `name` is only ever cleared by conditional clearances
   * (inside `if`, `switch`, `? :` or `&&`/`||`). The resource will still leak
   * any time the guard does not take the clearance branch.
   */
  isOnlyConditionallyCleared(name: string, allocScopeId: number): boolean {
    const matches = this.matchingClearances(name, allocScopeId);
    return matches.length > 0 && matches.every((c) => c.conditional);
  }

  /**
   * Returns true when `name` is cleared by an unconditional clearance that
   * occurs inside the scope subtree rooted at `containerScopeId` (e.g. a
   * `useEffect` body). Class instance members (`this.timer`) must additionally
   * resolve to the same enclosing class as the allocation.
   */
  isClearedWithin(name: string, allocScopeId: number, containerScopeId: number): boolean {
    return this.matchingClearances(name, allocScopeId).some(
      (c) => !c.conditional && this.isDescendantOrSame(c.scopeId, containerScopeId)
    );
  }

  getScopeTag(scopeId: number): string | null {
    return this.scopeTags.get(scopeId) ?? null;
  }

  /**
   * Returns true if `candidate` is the same scope as `ancestor` or a
   * descendant of `ancestor`.
   */
  isDescendantOrSame(candidate: number, ancestor: number): boolean {
    let current: number | undefined = candidate;
    while (current !== undefined) {
      if (current === ancestor) return true;
      current = this.parentMap.get(current);
    }
    return false;
  }

  getAllocations(): readonly ScopedAllocation[] {
    return this.allocations;
  }
}

/**
 * Derives a semantic tag for a class scope from the class node itself. Named
 * classes (`class Timer { ... }`) and named class expressions
 * (`const Timer = class Inner { ... }`) produce their identifier; anonymous
 * class expressions produce null.
 */
function getClassScopeTag(node: any): string | null {
  if (node && node.id && node.id.type === 'Identifier' && node.id.name) return node.id.name;
  return null;
}

/**
 * Derives a semantic tag for a function scope from its surrounding context:
 *  - the name of the CallExpression it was passed to (`watch`, `onMounted`,
 *    `addEventListener`, ...),
 *  - the declared name of a function declaration (`stop`, `unmount`, ...),
 *  - the method/property key for class or object methods,
 *  - the binder name when assigned to a variable.
 * Returns null when the function has no meaningful introducer.
 */
function getFunctionScopeTag(node: any, parent: any): string | null {
  if (parent && parent.type === 'CallExpression') {
    const callee = parent.callee;
    if (!callee) return null;
    if (callee.type === 'Identifier') return callee.name;
    if (callee.type === 'MemberExpression' && callee.property && callee.property.type === 'Identifier') {
      return callee.property.name;
    }
    return null;
  }

  if (node.type === 'FunctionDeclaration' && node.id && node.id.name) {
    return node.id.name;
  }

  if (parent && parent.type === 'MethodDefinition' && parent.key) {
    return parent.key.name || (parent.key.type === 'Literal' ? String(parent.key.value) : null);
  }

  if (parent && (parent.type === 'Property' || parent.type === 'ObjectProperty')) {
    if (parent.key && parent.key.type === 'Identifier') return parent.key.name;
    if (parent.key && parent.key.type === 'Literal') return String(parent.key.value);
  }

  if (parent && parent.type === 'VariableDeclarator' && parent.id && parent.id.type === 'Identifier') {
    return parent.id.name;
  }

  return null;
}

export interface ScopeListenersHooks {
  /** Invoked just after a function scope has been entered and tagged. */
  onFunctionScopeEnter?(node: any, parent: any, tag: string | null, scopeId: number): void;
  /** Invoked just before a function scope is left. */
  onFunctionScopeExit?(node: any, parent: any): void;
}

/**
 * Injects the standard scope-listener visitors into a rule's visitor object so
 * rules stay free of scope boilerplate. Handles:
 *
 *  - Program root scope.
 *  - Block boundaries: BlockStatement, for/for-in/for-of loops, SwitchStatement.
 *  - Function boundaries (with parameter declarations), tagged with their
 *    introducing call/method/function name via `hooks` when provided.
 *  - Class boundaries: ClassDeclaration, ClassExpression and ClassBody, each
 *    opening a single `'class'` scope tagged with the class name. Method bodies
 *    then nest underneath it, so `this.*` state stays pinned to one instance.
 *  - CatchClause (with its bound parameter).
 *  - VariableDeclarator declarations, including destructured patterns.
 *  - Conditional constructs (`if`, `switch` case, `? :`, `&&`, `||`) which
 *    mark guard-gated clearances as conditional.
 *
 * Note: it sets `visitor[type]` unconditionally for these node types, so rules
 * must not define their own handlers for them.
 */
export function attachScopeListeners(tracker: ScopeTracker, visitor: RuleVisitor, hooks?: ScopeListenersHooks): void {
  visitor.Program = () => tracker.enterRootScope();

  for (const type of BLOCK_SCOPE_NODE_TYPES) {
    visitor[type] = () => tracker.enterScope('block');
    visitor[`${type}:exit`] = () => tracker.leaveScope();
  }

  for (const type of CONDITIONAL_NODE_TYPES) {
    visitor[type] = (node: any) => tracker.enterConditional(node);
    visitor[`${type}:exit`] = () => tracker.exitConditional();
  }

  visitor.LogicalExpression = (node: any) => {
    if (node.operator === '&&' || node.operator === '||') tracker.enterConditional(node);
  };
  visitor['LogicalExpression:exit'] = (node: any) => {
    if (node.operator === '&&' || node.operator === '||') tracker.exitConditional();
  };

  visitor.CatchClause = (node: any) => {
    tracker.enterScope('block');
    for (const name of extractIdentifiersFromPattern(node.param)) {
      tracker.declareVariable(name, 'let');
    }
  };
  visitor['CatchClause:exit'] = () => tracker.leaveScope();

  for (const type of FUNCTION_SCOPE_NODE_TYPES) {
    visitor[type] = (node: any, parent: any) => {
      const tag = getFunctionScopeTag(node, parent);
      const scopeId = tracker.enterScope('function', tag);
      const params: any[] =
        node.params && node.params.type === 'FormalParameters' ? node.params.items ?? [] : node.params ?? [];
      for (const param of params) {
        for (const name of extractIdentifiersFromPattern(param)) {
          tracker.declareVariable(name, 'let');
        }
      }
      hooks?.onFunctionScopeEnter?.(node, parent, tag, scopeId);
    };
    visitor[`${type}:exit`] = (node: any, parent: any) => {
      hooks?.onFunctionScopeExit?.(node, parent);
      tracker.leaveScope();
    };
  }

  // Class scope bookkeeping. `ClassDeclaration`/`ClassExpression` open the
  // class scope; `ClassBody` is intercepted as well so a dialect that only
  // exposes the body still gets a scope, but it must never nest a second scope
  // inside the one its parent class already opened.
  const openClassScopes: any[] = [];
  const classBodyOwnedScopes = new WeakSet<object>();

  const classScopeOwner = (node: any, parent: any): any => parent ?? node;

  for (const type of CLASS_SCOPE_NODE_TYPES) {
    visitor[type] = (node: any) => {
      tracker.enterScope('class', getClassScopeTag(node));
      openClassScopes.push(node);
    };
    visitor[`${type}:exit`] = () => {
      openClassScopes.pop();
      tracker.leaveScope();
    };
  }

  visitor.ClassBody = (node: any, parent: any) => {
    const owner = classScopeOwner(node, parent);
    if (openClassScopes[openClassScopes.length - 1] === owner) return;
    tracker.enterScope('class', getClassScopeTag(owner));
    openClassScopes.push(owner);
    classBodyOwnedScopes.add(node);
  };
  visitor['ClassBody:exit'] = (node: any) => {
    if (!classBodyOwnedScopes.has(node)) return;
    classBodyOwnedScopes.delete(node);
    openClassScopes.pop();
    tracker.leaveScope();
  };

  visitor.VariableDeclarator = (node: any, parent: any) => {
    const kind = getDeclarationKind(parent);
    for (const name of extractIdentifiersFromPattern(node.id)) {
      tracker.declareVariable(name, kind);
    }
  };

  // Class fields (e.g. `timer = setInterval(...)` in a class body) live on the
  // instance as `this.timer`, so they are declared as member-expression names
  // against the enclosing class scope.
  visitor.PropertyDefinition = (node: any) => {
    if (node.key && node.key.type === 'Identifier') {
      tracker.declareVariable(`this.${node.key.name}`, 'let');
    }
  };
}