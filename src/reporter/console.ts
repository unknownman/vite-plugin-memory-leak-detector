import path from 'node:path';
import pc from 'picocolors';
import type { Diagnostic } from '../types/diagnostic.js';

const SEVERITY_COLORS: Record<Diagnostic['severity'], (s: string) => string> = {
  error: pc.red,
  warn: pc.yellow,
  info: pc.cyan,
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

  const lineNo = diag.line;
  const sourceLine = codeLines[lineNo - 1];
  if (!sourceLine) return '';

  const gutterPlain = `${String(lineNo).padStart(4)} | `;
  const gutter = pc.dim(gutterPlain);
  const pointer = pc.red(' '.repeat(gutterPlain.length + diag.column) + '^');

  return `${gutter}${sourceLine}\n${pointer}`;
}

export interface ConsoleReporterOptions {
  verbose?: boolean;
}

/**
 * Grouped, stylish terminal reporter using picocolors.
 */
export function consoleReporter(diagnostics: Diagnostic[], sourceCode?: string, options: ConsoleReporterOptions = {}) {
  if (diagnostics.length === 0) return;

  const grouped = diagnostics.reduce(
    (acc, diag) => {
      (acc[diag.file] = acc[diag.file] || []).push(diag);
      return acc;
    },
    {} as Record<string, Diagnostic[]>,
  );

  const cwd = process.cwd();

  for (const [file, diags] of Object.entries(grouped)) {
    const relFile = path.relative(cwd, file);
    console.log(`\n${pc.underline(pc.cyan(relFile))}`);

    for (const diag of diags) {
      const color = SEVERITY_COLORS[diag.severity];
      const severityLabel = color(diag.severity.padEnd(5));
      const pos = pc.dim(`${diag.line}:${diag.column}`.padEnd(8));

      console.log(`  ${pos} ${severityLabel} ${diag.message} ${pc.dim(diag.ruleId)}`);

      if (diag.suggestion) {
        console.log(`            ${pc.green('💡')} ${pc.italic(diag.suggestion)}`);
      }

      if (sourceCode !== undefined && options.verbose !== false) {
        const frame = formatCodeframe(sourceCode, diag);
        if (frame) console.log(`\n${frame}\n`);
      }
    }
  }

  const errorCount = diagnostics.filter((d) => d.severity === 'error').length;
  const warnCount = diagnostics.filter((d) => d.severity === 'warn').length;

  const parts: string[] = [];
  if (errorCount > 0) parts.push(pc.red(`${errorCount} errors`));
  if (warnCount > 0) parts.push(pc.yellow(`${warnCount} warnings`));

  if (parts.length > 0) {
    console.log(`\n${pc.bold(`✖ ${parts.join(', ')}`)}`);
  }
}

export function jsonReporter(diagnostics: Diagnostic[]) {
  console.log(JSON.stringify(diagnostics, null, 2));
}

export function sourceForFile(_file: string, code: string): string | undefined {
  return code;
}
