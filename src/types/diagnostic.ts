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
}
