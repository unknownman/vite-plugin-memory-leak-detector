import type { Node } from 'estree';
import type { Diagnostic } from './diagnostic.js';
import type { Severity } from './config.js';

export interface ExtractionResult {
  code: string;
  lineOffset: number;
  columnOffset: number;
}

export interface RuleContext {
  file: string;
  code: string;
  ast: Node;
  report(diag: Omit<Diagnostic, 'file' | 'severity' | 'fingerprint'> & { severity?: Severity }): void;
  /**
   * Checks if a specific function or method name is globally allowlisted by the user.
   */
  isAllowlisted(name: string, type: 'function' | 'method'): boolean;
}

export type RuleVisitor = {
  /**
   * Matches an ESTree AST node type.
   * Append `:exit` to the node type name to visit during the leave phase.
   */
  [nodeType: string]: (node: any, parent: any, ancestors?: any[]) => void;
};

export interface RuleDefinition {
  id: string;
  description: string;
  category: 'generic' | 'react' | 'vue' | 'svelte' | 'solid';
  defaultSeverity: Severity;
  create(context: RuleContext): RuleVisitor;
}
