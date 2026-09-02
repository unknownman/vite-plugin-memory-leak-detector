import pc from 'picocolors';
import type { Diagnostic } from '../types/diagnostic.js';

const SEVERITY_COLORS: Record<Diagnostic['severity'], (s: string) => string> = {
  error: pc.red,
  warn: pc.yellow,
  off: pc.dim,
};

function formatCodeframe(code: string, diag: Diagnostic): string {
  const codeLines = code.split('\n');
  const frame = diag.codeFrame ? diag.codeFrame.lines : undefined;

  if (frame) {
    return frame
      .map((line, i) => {
        const lineNo = diag.codeFrame!.startLine + i;
        const gutter = pc.dim(`${String(lineNo).padStart(4)} | `);
        return gutter + line;
      })
      .join('\n');
  }

  // Fallback: show the offending line plus a pointer.
  const lineNo = diag.line;
  const sourceLine = codeLines[lineNo - 1];
  if (!sourceLine) return '';

  const gutter = pc.dim(`${String(lineNo).padStart(4)} | `);
  const gutterPlain = `${String(lineNo).padStart(4)} | `;
  const pointer = pc.red(' '.repeat(gutterPlain.length + diag.column) + '^');

  return `${gutter}${sourceLine}\n${pointer}`;
}

export interface ConsoleReporterOptions {
  verbose?: boolean;
}

/**
 * Colorized terminal reporter using picocolors.
 */
export function consoleReporter(diagnostics: Diagnostic[], sourceCode?: string, options: ConsoleReporterOptions = {}) {
  if (diagnostics.length === 0) return;

  for (const diag of diagnostics) {
    const color = SEVERITY_COLORS[diag.severity];
    const severityLabel = color(diag.severity.toUpperCase().padEnd(5));
    const ruleLabel = pc.cyan(diag.ruleId);
    const location = pc.dim(`${diag.file}:${diag.line}:${diag.column}`);

    console.log(`\n  ${severityLabel} ${ruleLabel}  ${location}`);
    console.log(`  ${diag.message}`);

    if (diag.suggestion) {
      console.log(`  ${pc.green('Suggestion:')} ${diag.suggestion}`);
    }

    if (sourceCode !== undefined && options.verbose !== false) {
      const frame = formatCodeframe(sourceCode, diag);
      if (frame) console.log(`\n${frame}`);
    }
  }

  const errorCount = diagnostics.filter((d) => d.severity === 'error').length;
  const warnCount = diagnostics.filter((d) => d.severity === 'warn').length;

  const parts: string[] = [];
  if (errorCount > 0) parts.push(pc.red(`${errorCount} errors`));
  if (warnCount > 0) parts.push(pc.yellow(`${warnCount} warnings`));
  if (parts.length > 0) {
    console.log(`\n  ${pc.bold(`✖ ${parts.join(', ')}`)}`);
  }
}

export function jsonReporter(diagnostics: Diagnostic[]) {
  console.log(JSON.stringify(diagnostics, null, 2));
}

export function sourceForFile(_file: string, code: string): string | undefined {
  // Diagnostics carry full-file line/column coordinates (after applying
  // SFC line offsets), so the codeframe should be built from the original
  // file content rather than an extracted script snippet.
  return code;
}
