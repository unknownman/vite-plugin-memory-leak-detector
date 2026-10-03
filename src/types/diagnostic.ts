import type { Severity } from './config.js';

export interface SourceLocation {
  file: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
}

export interface CodeFrame {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  lines: string[];
}

export interface Diagnostic {
  ruleId: string;
  message: string;
  suggestion?: string;
  severity: Severity;
  file: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  codeFrame?: CodeFrame;
  /**
   * Whitespace-normalized source line the diagnostic points at. Part of the
   * baseline fingerprint, which lets two leaks of the same variable in one
   * file stay distinct while remaining insensitive to line numbers.
   */
  snippet?: string;
  /** Unique deterministic fingerprint for baseline tracking */
  fingerprint?: string;
}
