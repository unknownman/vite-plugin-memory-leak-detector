import type { RuleVisitor } from '../../types/rule.js';
import { extractIdentifiersFromPattern, getDeclarationKind } from './tracker.js';

export interface ScopedAllocation {
  name: string;
  scopeId: number;
}

interface RecordedClearance {
  name: string;
  scopeId: number;
}

export type ScopeKind = 'function' | 'block';

/**
 * Lexical-environment-aware tracker for allocation/clearance pairs.
 *
 * Every scope boundary (Program root, function entry/body, block statement)
 * receives a unique scope ID with a parent link. Declarations (`let`, `const`,
 * `var`) are recorded against the scope that lexically contains them, so the
 * same name declared in different scopes resolves to distinct bindings.
 *
 * A clearance is valid only when the cleared name lexically resolves to the
 * exact same declaration scope as the allocation. This prevents false
 * negatives where two sibling functions each declare a local variable with
 * the same name but only one clears it.
 */
export class ScopeTracker {
  private nextScopeId = 0;
  private scopeStack: number[] = [];
  private parentMap = new Map<number, number>();
  private allocations: ScopedAllocation[] = [];
  private clearances: RecordedClearance[] = [];
  private declaredVariables = new Map<number, Set<string>>();
  private scopeKinds = new Map<number, ScopeKind>();

  /** Call at Program entry to create the root (module) scope. */
  enterRootScope() {
    const id = this.nextScopeId++;
    this.scopeKinds.set(id, 'function');
    this.scopeStack.push(id);
    return id;
  }

  /**
   * Enter a new scope boundary. Use `'function'` for function/arrow bodies and
   * `'block'` (default) for block statements so `let`/`const` shadowing is
   * modeled correctly.
   */
  enterScope(kind: ScopeKind = 'block') {
    const id = this.nextScopeId++;
    this.parentMap.set(id, this.currentScopeId());
    this.scopeKinds.set(id, kind);
    this.scopeStack.push(id);
    return id;
  }

  leaveScope() {
    this.scopeStack.pop();
  }

  currentScopeId(): number {
    return this.scopeStack[this.scopeStack.length - 1] ?? 0;
  }

  /**
   * Returns true if the current scope is nested inside a function boundary
   * (function declaration, function expression, or arrow function). The root
   * module scope is not considered a function.
   */
  isNestedInFunction(): boolean {
    for (let i = 1; i < this.scopeStack.length; i++) {
      if (this.scopeKinds.get(this.scopeStack[i]) === 'function') return true;
    }
    return false;
  }

  /**
   * Record a variable declaration in the current lexical environment.
   * `var` declarations are hoisted to the nearest enclosing function scope.
   */
  declareVariable(name: string, kind: 'var' | 'let' | 'const' = 'let') {
    const scopeId = kind === 'var' ? this.nearestFunctionScopeId() : this.currentScopeId();
    let names = this.declaredVariables.get(scopeId);
    if (!names) {
      names = new Set();
      this.declaredVariables.set(scopeId, names);
    }
    names.add(name);
  }

  addAllocation(name: string) {
    this.allocations.push({ name, scopeId: this.currentScopeId() });
  }

  addClearance(name: string) {
    this.clearances.push({ name, scopeId: this.currentScopeId() });
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

  /**
   * Returns true when any clearance for `name` resolves to the exact same
   * declaration scope as the allocation. For names that cannot be resolved to
   * a lexical declaration (e.g. member-property targets like `this.timer`),
   * falls back to requiring the clearance to occur within the same scope
   * subtree as the allocation.
   */
  isCleared(name: string, allocScopeId: number): boolean {
    const allocDeclScope = this.resolveDeclarationScope(name, allocScopeId);

    for (const c of this.clearances) {
      if (c.name !== name) continue;

      const clearanceDeclScope = this.resolveDeclarationScope(name, c.scopeId);

      if (allocDeclScope !== null && clearanceDeclScope !== null) {
        if (allocDeclScope === clearanceDeclScope) return true;
        continue;
      }

      if (allocDeclScope === null && clearanceDeclScope === null) {
        if (
          this.isDescendantOrSame(c.scopeId, allocScopeId) ||
          this.isDescendantOrSame(allocScopeId, c.scopeId)
        ) {
          return true;
        }
      }
    }
    return false;
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

const BLOCK_SCOPE_NODE_TYPES = ['BlockStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'SwitchStatement'];

const FUNCTION_SCOPE_NODE_TYPES = ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'];

/**
 * Injects the standard scope-listener visitors into a rule's visitor object so
 * rules stay free of scope boilerplate. Handles:
 *
 *  - Program root scope.
 *  - Block boundaries: BlockStatement, for/for-in/for-of loops, SwitchStatement.
 *  - Function boundaries (with parameter declarations).
 *  - CatchClause (with its bound parameter).
 *  - VariableDeclarator declarations, including destructured patterns.
 *
 * Note: it sets `visitor[type]` unconditionally for these node types, so rules
 * must not define their own handlers for them.
 */
export function attachScopeListeners(tracker: ScopeTracker, visitor: RuleVisitor): void {
  visitor.Program = () => tracker.enterRootScope();

  for (const type of BLOCK_SCOPE_NODE_TYPES) {
    visitor[type] = () => tracker.enterScope('block');
    visitor[`${type}:exit`] = () => tracker.leaveScope();
  }

  visitor.CatchClause = (node: any) => {
    tracker.enterScope('block');
    for (const name of extractIdentifiersFromPattern(node.param)) {
      tracker.declareVariable(name, 'let');
    }
  };
  visitor['CatchClause:exit'] = () => tracker.leaveScope();

  for (const type of FUNCTION_SCOPE_NODE_TYPES) {
    visitor[type] = (node: any) => {
      tracker.enterScope('function');
      const params: any[] =
        node.params && node.params.type === 'FormalParameters' ? node.params.items ?? [] : node.params ?? [];
      for (const param of params) {
        for (const name of extractIdentifiersFromPattern(param)) {
          tracker.declareVariable(name, 'let');
        }
      }
    };
    visitor[`${type}:exit`] = () => tracker.leaveScope();
  }

  visitor.VariableDeclarator = (node: any, parent: any) => {
    const kind = getDeclarationKind(parent);
    for (const name of extractIdentifiersFromPattern(node.id)) {
      tracker.declareVariable(name, kind);
    }
  };
}