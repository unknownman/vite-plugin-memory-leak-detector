import type { Diagnostic } from '../types/diagnostic.js';

interface RollupContextLike {
  warn(message: string, position?: { line: number; column: number }): void;
}

/**
 * Forwards diagnostics to Rollup's/Vite's warning system.
 * Errors are only leveled up to `context.error()` in buildEnd via threshold
 * checks — never during transform, where it would fatally abort the module.
 */
export function rollupReporter(
  context: RollupContextLike,
  diagnostics: Diagnostic[]
): void {
  for (const diag of diagnostics) {
    context.warn(buildMessage(diag), {
      line: diag.line,
      column: diag.column,
    });
  }
}

function buildMessage(diag: Diagnostic): string {
  const base = `[${diag.ruleId}] ${diag.message}`;
  return diag.suggestion ? `${base}\n  Suggestion: ${diag.suggestion}` : base;
}
