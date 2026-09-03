import type { Diagnostic } from '../types/diagnostic.js';

interface RollupContextLike {
  warn(message: string, position?: { line: number; column: number }): void;
  error(message: string, position?: { line: number; column: number }): void;
}

/**
 * Forwards diagnostics to Rollup's/Vite's warning/error system.
 * This maps warnings/errors onto the standard Vite terminal output
 * including file locations.
 */
export function rollupReporter(
  context: RollupContextLike,
  diagnostics: Diagnostic[],
  failOnError: boolean
): void {
  const errors = diagnostics.filter((d) => d.severity === 'error');
  // Rollup/Vite only exposes warn and error levels, so gate 'warn' and 'info'
  // diagnostics through the warning channel.
  const warnings = diagnostics.filter((d) => d.severity === 'warn' || d.severity === 'info');

  for (const warning of warnings) {
    const message = buildMessage(warning);
    context.warn(message, {
      line: warning.line,
      column: warning.column,
    });
  }

  for (const error of errors) {
    const message = buildMessage(error);
    if (failOnError) {
      context.error(message, {
        line: error.line,
        column: error.column,
      });
    } else {
      context.warn(message, {
        line: error.line,
        column: error.column,
      });
    }
  }
}

function buildMessage(diag: Diagnostic): string {
  const base = `[${diag.ruleId}] ${diag.message}`;
  return diag.suggestion ? `${base}\n  Suggestion: ${diag.suggestion}` : base;
}
