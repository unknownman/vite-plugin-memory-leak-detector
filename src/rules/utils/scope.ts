export interface ScopedAllocation {
  name: string;
  scopeId: number;
}

interface RecordedClearance {
  name: string;
  scopeId: number;
}

/**
 * Lightweight scope-aware tracker for allocation/clearance pairs.
 *
 * Each function boundary (FunctionDeclaration, FunctionExpression,
 * ArrowFunctionExpression) and the Program root gets a unique scope ID
 * with a parent link. Allocations and clearances are recorded against
 * their enclosing scope.
 *
 * A clearance is valid only when it occurs in the same scope or a
 * descendant scope of the allocation. This prevents false negatives
 * where two sibling functions both use the same variable name but only
 * one clears it.
 */
export class ScopeTracker {
  private nextScopeId = 0;
  private scopeStack: number[] = [];
  private parentMap = new Map<number, number>();
  private allocations: ScopedAllocation[] = [];
  private clearances: RecordedClearance[] = [];

  /** Call at Program entry to create the root scope. */
  enterRootScope() {
    const id = this.nextScopeId++;
    this.scopeStack.push(id);
    return id;
  }

  enterScope() {
    const id = this.nextScopeId++;
    this.parentMap.set(id, this.currentScopeId());
    this.scopeStack.push(id);
    return id;
  }

  leaveScope() {
    this.scopeStack.pop();
  }

  currentScopeId(): number {
    return this.scopeStack[this.scopeStack.length - 1] ?? 0;
  }

  addAllocation(name: string) {
    this.allocations.push({ name, scopeId: this.currentScopeId() });
  }

  addClearance(name: string) {
    this.clearances.push({ name, scopeId: this.currentScopeId() });
  }

  /**
   * Finds the lowest common ancestor scope ID for two scopes.
   * Returns null if they do not share any ancestor.
   */
  getCommonAncestor(scopeA: number, scopeB: number): number | null {
    const ancestorsA = new Set<number>();
    let currentA: number | undefined = scopeA;
    while (currentA !== undefined) {
      ancestorsA.add(currentA);
      currentA = this.parentMap.get(currentA);
    }

    let currentB: number | undefined = scopeB;
    while (currentB !== undefined) {
      if (ancestorsA.has(currentB)) {
        return currentB;
      }
      currentB = this.parentMap.get(currentB);
    }

    return null;
  }

  /**
   * Check if any clearance for `name` shares a common ancestor scope with the
   * allocation — meaning both have access to the same enclosing scope / closed-over
   * variable binding (e.g. module root or component setup scope).
   */
  isCleared(name: string, allocScopeId: number): boolean {
    return this.clearances.some(
      (c) => c.name === name && this.getCommonAncestor(allocScopeId, c.scopeId) !== null,
    );
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

export const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);
