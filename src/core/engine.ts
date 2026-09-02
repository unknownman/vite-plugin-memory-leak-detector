import traverseModule, { type TraverseOptions } from '@babel/traverse';
import type { Node } from '@babel/types';
import type { Diagnostic } from '../types/diagnostic.js';
import type { RuleContext, RuleDefinition, ExtractionResult } from '../types/rule.js';
import type { Severity, RuleSeverityConfig } from '../types/config.js';
import { parseCode } from './parser.js';

// @babel/traverse ships a CommonJS module. Depending on the module system
// in use, the default import may be the module namespace object rather than
// the traversal function itself. Normalize to the callable.
const traverse = (traverseModule as unknown as { default?: typeof traverseModule }).default ?? (traverseModule as unknown as typeof traverseModule);

interface EngineOptions {
  customRules?: RuleDefinition[];
  ruleConfig?: RuleSeverityConfig;
  verbose?: boolean;
}

/**
 * Main leak detection orchestration engine.
 * Parses source, runs all enabled rule visitors over the AST,
 * and aggregates diagnostics with severity overrides applied.
 */
export class LeakDetectorEngine {
  private defaults: Record<string, Severity>;
  private ruleConfig: RuleSeverityConfig;
  private rules: RuleDefinition[];
  private verboseLogging: boolean;

  constructor(options: EngineOptions = {}) {
    this.defaults = {};
    this.ruleConfig = options.ruleConfig ?? {};
    this.verboseLogging = options.verbose ?? false;
    this.rules = [...(options.customRules ?? [])];
  }

  /**
   * Registers or replaces the active rule set.
   */
  public setRules(rules: RuleDefinition[]): void {
    this.rules = rules;
  }

  public get activeRules(): RuleDefinition[] {
    return this.rules;
  }

  public setDefaultSeverity(ruleId: string, severity: Severity): void {
    this.defaults[ruleId] = severity;
  }

  /**
   * Analyzes a file and returns all diagnostics produced by enabled rules.
   */
  public analyze(file: string, code: string, extraction?: ExtractionResult): Diagnostic[] {
    const scriptCode = extraction ? extraction.code : code;
    const diagnostics: Diagnostic[] = [];

    // If no script was extracted (e.g., SFC without a script block), skip.
    if (scriptCode.trim() === '') return diagnostics;

    const { ast, errors } = parseCode(scriptCode);
    if (!ast || errors.length > 0) {
      if (this.verboseLogging) {
        console.error(`[MemoryLeakDetector] Failed to parse ${file}:`, errors[0]?.message);
      }
      return diagnostics;
    }

    const offset = extraction
      ? { lineOffset: extraction.lineOffset, columnOffset: extraction.columnOffset }
      : { lineOffset: 0, columnOffset: 0 };

    // Build the RuleContext for each rule.
    const context: RuleContext = {
      file,
      code: scriptCode,
      ast,
      report: (diag) => {
        const severity = this.resolve(diag.ruleId);
        if (severity === 'off') return;

        diagnostics.push({
          ...diag,
          severity,
          file,
          line: diag.line + offset.lineOffset,
          column: diag.column + (diag.line === 1 ? offset.columnOffset : 0),
          endLine: diag.endLine !== undefined ? diag.endLine + offset.lineOffset : undefined,
          endColumn: diag.endColumn,
        });
      },
    };

    for (const rule of this.rules) {
      if (this.resolve(rule.id) === 'off') continue;

      try {
        const visitor = rule.create(context);
        traverse(ast as never, visitor as TraverseOptions);
      } catch (error) {
        if (this.verboseLogging) {
          console.error(`[MemoryLeakDetector] Error running rule '${rule.id}':`, error);
        }
      }
    }

    return diagnostics;
  }

  /**
   * Resolves the effective severity for a rule, honoring user overrides.
   */
  public resolve(ruleId: string): Severity {
    const override = this.ruleConfig[ruleId];
    if (override !== undefined) {
      if (typeof override === 'string') return override;
      return override.severity;
    }

    const defaultSeverity = this.defaults[ruleId];
    if (defaultSeverity !== undefined) return defaultSeverity;

    return 'warn';
  }
}
