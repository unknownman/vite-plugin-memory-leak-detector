import traverseModule, { type TraverseOptions } from '@babel/traverse';
import type { Node } from '@babel/types';
import type { Diagnostic } from '../types/diagnostic.js';
import type { RuleContext, RuleDefinition, ExtractionResult } from '../types/rule.js';
import type { Severity, ResolvedPluginConfig } from '../types/config.js';
import { parseCode } from './parser.js';
import { CommentDirectivesHandler } from './comments.js';
import { BaselineManager, generateFingerprint } from './baseline.js';

// @babel/traverse ships a CommonJS module. Depending on the module system
// in use, the default import may be the module namespace object rather than
// the traversal function itself. Normalize to the callable.
const traverse =
  (traverseModule as unknown as { default?: typeof traverseModule }).default ??
  (traverseModule as unknown as typeof traverseModule);

export class LeakDetectorEngine {
  private config: ResolvedPluginConfig;
  private commentHandler: CommentDirectivesHandler;
  private baselineManager?: BaselineManager;
  private rules: RuleDefinition[];

  constructor(config: ResolvedPluginConfig) {
    this.config = config;
    this.commentHandler = new CommentDirectivesHandler(
      config.comments.prefix,
      config.comments.enabled
    );
    if (config.baseline.enabled) {
      this.baselineManager = new BaselineManager(config.baseline.path);
    }
    this.rules = config.customRules;
  }

  public analyze(file: string, code: string, extraction?: ExtractionResult): Diagnostic[] {
    const scriptCode = extraction ? extraction.code : code;
    const diagnostics: Diagnostic[] = [];

    if (scriptCode.trim() === '') return diagnostics;

    const { ast, errors } = parseCode(scriptCode);
    if (!ast || errors.length > 0) {
      if (this.config.verbose) {
        console.error(`[MemoryLeakDetector] Failed to parse ${file}:`, errors[0]?.message);
      }
      return diagnostics;
    }

    const directives = this.commentHandler.parseDirectives(code);
    const offset = extraction
      ? { lineOffset: extraction.lineOffset, columnOffset: extraction.columnOffset }
      : { lineOffset: 0, columnOffset: 0 };

    const context: RuleContext = {
      file,
      code: scriptCode,
      ast,
      report: (diag) => {
        const severity = this.resolveSeverity(diag.ruleId);
        if (severity === 'off') return;

        const actualLine = diag.line + offset.lineOffset;
        const actualCol = diag.column + (diag.line === 1 ? offset.columnOffset : 0);

        // Check if suppressed via inline comment
        if (this.commentHandler.isSuppressed(diag.ruleId, actualLine, directives)) {
          return;
        }

        const diagnostic: Diagnostic = {
          ...diag,
          severity,
          file,
          line: actualLine,
          column: actualCol,
          endLine: diag.endLine !== undefined ? diag.endLine + offset.lineOffset : undefined,
          endColumn: diag.endColumn,
        };

        diagnostic.fingerprint = generateFingerprint(diagnostic);

        // Check if filtered by baseline
        if (this.baselineManager && !this.config.baseline.update) {
          if (this.baselineManager.isBaseline(diagnostic)) {
            return;
          }
        }

        diagnostics.push(diagnostic);
      },
    };

    for (const rule of this.rules) {
      // Check framework filtering
      if (
        this.config.frameworks !== 'auto' &&
        rule.category !== 'generic' &&
        !this.config.frameworks.includes(rule.category)
      ) {
        continue;
      }

      if (this.resolveSeverity(rule.id) === 'off') continue;

      try {
        const visitor = rule.create(context);
        traverse(ast as never, visitor as TraverseOptions);
      } catch (error) {
        if (this.config.verbose) {
          console.error(`[MemoryLeakDetector] Error running rule '${rule.id}':`, error);
        }
      }
    }

    return diagnostics;
  }

  public resolveSeverity(ruleId: string): Severity {
    const override = this.config.rules[ruleId];
    if (override !== undefined) {
      return typeof override === 'string' ? override : override.severity;
    }
    const matchingRule = this.rules.find((r) => r.id === ruleId);
    return matchingRule?.defaultSeverity ?? 'warn';
  }
}
