import type { Node } from '@babel/types';
import type { Visitor } from '@babel/traverse';
import type { Severity } from './config.js';
import type { Diagnostic } from './diagnostic.js';

export interface ExtractionResult {
  code: string;
  lineOffset: number;
  columnOffset: number;
}

export interface RuleContext {
  file: string;
  code: string;
  ast: Node;
  report(diag: Omit<Diagnostic, 'file'>): void;
}

export interface RuleDefinition {
  id: string;
  description: string;
  category: 'generic' | 'react' | 'vue' | 'svelte' | 'solid';
  defaultSeverity: Severity;
  create(context: RuleContext): Visitor;
}
