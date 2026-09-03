import { walk } from 'estree-walker';
import type { Diagnostic } from '../types/diagnostic.js';
import type { RuleContext, RuleDefinition, ExtractionResult, RuleVisitor } from '../types/rule.js';
import type { Severity, ResolvedPluginConfig } from '../types/config.js';
import { parseCode } from './parser.js';
import { CommentDirectivesHandler } from './comments.js';
import { BaselineManager, generateFingerprint } from './baseline.js';

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

    const { ast, errors } = parseCode(scriptCode, file);
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
        const severity = diag.severity || this.resolveSeverity(diag.ruleId);
        if (severity === 'off') return;

        const actualLine = (diag.line ?? 1) + offset.lineOffset;
        const actualCol = (diag.column ?? 0) + ((diag.line ?? 1) === 1 ? offset.columnOffset : 0);

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

        if (this.baselineManager && !this.config.baseline.update) {
          if (this.baselineManager.isBaseline(diagnostic)) return;
        }

        diagnostics.push(diagnostic);
      },
    };

    // Instantiate rule visitors
    const activeVisitors: { id: string; visitor: RuleVisitor }[] = [];
    for (const rule of this.rules) {
      if (
        this.config.frameworks !== 'auto' &&
        rule.category !== 'generic' &&
        !this.config.frameworks.includes(rule.category)
      ) {
        continue;
      }
      if (this.resolveSeverity(rule.id) === 'off') continue;

      try {
        activeVisitors.push({ id: rule.id, visitor: rule.create(context) });
      } catch (error) {
        if (this.config.verbose) {
          console.error(`[MemoryLeakDetector] Error initializing rule '${rule.id}':`, error);
        }
      }
    }

    if (activeVisitors.length === 0) return diagnostics;

    // Single-pass AST Traversal
    walk(ast, {
      enter(node: any, parent: any) {
        for (const { visitor } of activeVisitors) {
          const handler = visitor[node.type];
          if (handler) handler(node, parent);
        }
      },
      leave(node: any, parent: any) {
        const exitKey = `${node.type}:exit`;
        for (const { visitor } of activeVisitors) {
          const handler = visitor[exitKey];
          if (handler) handler(node, parent);
        }
      },
    });

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
