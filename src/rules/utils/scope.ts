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
   * Check if any clearance for `name` is reachable from the allocation's
   * scope — i.e. the clearance scope is the same as or a descendant of
   * the allocation scope.
   *
   * Clearances at the root scope (scopeId 0) are treated as universal
   * module-level teardown and always count, since they execute after all
   * function scopes have been defined and can reference any variable
   * hoisted or declared at the top level.
   */
  isCleared(name: string, allocScopeId: number): boolean {
    return this.clearances.some(
      (c) => c.name === name && (c.scopeId === 0 || this.isDescendantOrSame(c.scopeId, allocScopeId)),
    );
  }

  /**
   * Returns true if `candidate` is the same scope as `ancestor` or a
   * descendant of `ancestor`.
   */
  isDescendantOrSame(candidate: number, ancestor: number): boolean {
    let current = candidate;
    while (current !== undefined) {
      if (current === ancestor) return true;
      current = this.parentMap.get(current)!;
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
