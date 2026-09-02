import type { Diagnostic } from '../types/diagnostic.js';
import type { ReporterType } from '../types/config.js';
import { consoleReporter, jsonReporter, sourceForFile } from './console.js';

interface ReporterContext {
  file: string;
  sourceCode: string;
  verbose?: boolean;
}

/**
 * Reporter dispatcher. Chooses the correct output strategy
 * based on the configured reporter type.
 */
export function dispatchReporter(type: ReporterType, diagnostics: Diagnostic[], context: ReporterContext): void {
  if (diagnostics.length === 0) return;

  switch (type) {
    case 'json':
      jsonReporter(diagnostics);
      break;
    case 'stylish':
    case 'default':
    default: {
      const source = sourceForFile(context.file, context.sourceCode);
      consoleReporter(diagnostics, source, { verbose: context.verbose });
      break;
    }
  }
}
