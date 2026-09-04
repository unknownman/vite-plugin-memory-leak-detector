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