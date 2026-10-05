import type { Node } from 'estree';
import type { Diagnostic } from './diagnostic.js';
import type { Severity } from './config.js';

export interface ExtractionResult {
  code: string;
  lineOffset: number;
  columnOffset: number;
  /**
   * The script language the extracted code is written in, used to pick an
   * appropriate parser dialect (TS vs JS, JSX vs not) for SFC files whose
   * filename does not carry a code extension (e.g. `.vue`, `.svelte`).
   */
  inferredExtension?: 'js' | 'ts' | 'jsx' | 'tsx';
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
  /**
   * Substrings that must all be absent from a source file for this rule to be
   * certain it cannot report anything. List the identifiers a report *cannot*
   * exist without — not every identifier the rule reads.
   *
   * A file is prefiltered against the union of the enabled rules' triggers
   * before it is parsed, so a module that allocates nothing never reaches the
   * parser. Every identifier a rule inspects — the allocating call/constructor
   * *and* the lifecycle or teardown names it treats as a cleanup — must be
   * listed. A missing trigger silently disables a rule for the files that do
   * contain its pattern, so keep these in sync with the rule body.
   *
   * Rule categories still apply on top: this is only a cheap string check, not
   * a replacement for category filtering.
   */
  triggers: string[];
  create(context: RuleContext): RuleVisitor;
}
