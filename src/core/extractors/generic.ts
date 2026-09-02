import type { ExtractionResult } from '../../types/rule.js';

/**
 * Passthrough extractor for plain JS/TS/JSX/TSX files.
 * No line offset adjustments are needed since the code is used as-is.
 */
export function extractGeneric(code: string): ExtractionResult {
  return {
    code,
    lineOffset: 0,
    columnOffset: 0,
  };
}
