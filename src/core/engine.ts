import { walk } from 'estree-walker';
import type { Diagnostic } from '../types/diagnostic.js';
import type { RuleContext, RuleDefinition, ExtractionResult, RuleVisitor } from '../types/rule.js';
import type { Severity, ResolvedPluginConfig } from '../types/config.js';
import { parseCode } from './parser.js';
import { CommentDirectivesHandler } from './comments.js';
import { BaselineManager, generateFingerprint, normalizeSnippet } from './baseline.js';
import { IgnoreManager } from './ignore.js';

export class LeakDetectorEngine {
  private config: ResolvedPluginConfig;
  private commentHandler: CommentDirectivesHandler;
  private ignoreManager: IgnoreManager;
  private baselineManager?: BaselineManager;
  private baselineManagerRoot?: string;
  private rules: RuleDefinition[];
  /**
   * Base directory for repo-relative paths in fingerprints and the baseline
   * file. Set from the resolved Vite config so results do not depend on the
   * directory the CLI happened to run in.
   */
  private root: string = process.cwd();

  constructor(config: ResolvedPluginConfig) {
    this.config = config;
    this.commentHandler = new CommentDirectivesHandler(
      config.comments.prefix,
      config.comments.enabled
    );
    this.ignoreManager = new IgnoreManager(config.ignores);

    this.rules = config.customRules;
  }

  /**
   * Points the engine at the Vite project root, so fingerprints and the
   * baseline file resolve against the project rather than the CLI's cwd.
   * Called from `configResolved`, which runs after the constructor.
   */
  public setRoot(root: string): void {
    if (root) this.root = root;
  }

  public getRoot(): string {
    return this.root;
  }

  /**
   * Lazily builds the baseline manager for the current root. Created on first
   * use rather than in the constructor so that a `setRoot()` call from
   * `configResolved` still results in exactly one baseline file read (and at
   * most one legacy-format warning).
   */
  public getBaselineManager(): BaselineManager | undefined {
    if (!this.config.baseline.enabled) return undefined;
    if (!this.baselineManager || this.baselineManagerRoot !== this.root) {
      this.baselineManager = new BaselineManager(this.config.baseline.path, this.root);
      this.baselineManagerRoot = this.root;
    }
    return this.baselineManager;
  }

  public analyze(file: string, code: string, extraction?: ExtractionResult): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    // 1. FAST PATH: Check Glob-based global ignores
    if (this.ignoreManager.isFileGloballyIgnored(file)) {
      return diagnostics;
    }

    const scriptCode = extraction ? extraction.code : code;
    if (scriptCode.trim() === '') return diagnostics;

    const parseFilename =
      extraction?.inferredExtension ? `${file}.${extraction.inferredExtension}` : file;
    const { ast, errors } = parseCode(scriptCode, parseFilename);
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

    // Fingerprints read the *original* file text (not the extracted script) so
    // the snippet for an SFC diagnostic is the line a developer actually sees.
    const originalLines = code.split(/\r?\n/);
    // Counts how many diagnostics have shared a (rule, file, snippet) so far, so
    // two identical lines in one file stay distinguishable.
    const occurrenceCounters = new Map<string, number>();

    // Allowlist closure
    const isAllowlisted = (name: string, type: 'function' | 'method'): boolean => {
      if (type === 'function') {
        return this.config.allowlist.functions.includes(name);
      }
      return this.config.allowlist.methods.includes(name);
    };

    const context: RuleContext = {
      file,
      code: scriptCode,
      ast,
      isAllowlisted,
      report: (diag) => {
        // 2. GLOB PATTERN RULE FILTERING
        if (this.ignoreManager.isRuleIgnoredForFile(file, diag.ruleId)) return;

        const severity = diag.severity || this.resolveSeverity(diag.ruleId);
        if (severity === 'off') return;

        const actualLine = (diag.line ?? 1) + offset.lineOffset;
        const actualCol = (diag.column ?? 0) + ((diag.line ?? 1) === 1 ? offset.columnOffset : 0);

        // 3. INLINE COMMENT SUPPRESSION
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

        // Snippet + occurrence index make the fingerprint specific to *what*
        // leaked rather than just which rule and message fired. Neither depends
        // on the line number, so inserting code above a leak keeps it baselined.
        diagnostic.snippet = normalizeSnippet(originalLines[actualLine - 1] ?? '');
        const occurrenceKey = `${diagnostic.ruleId}|${file}|${diagnostic.snippet}`;
        const occurrenceIndex = occurrenceCounters.get(occurrenceKey) ?? 0;
        occurrenceCounters.set(occurrenceKey, occurrenceIndex + 1);

        diagnostic.fingerprint = generateFingerprint(diagnostic, this.root, occurrenceIndex);

        // 4. BASELINE SUPPRESSION
        const baselineManager = this.getBaselineManager();
        if (baselineManager) {
          if (!this.config.baseline.update && baselineManager.isKnown(diagnostic)) {
            // It's a legacy issue and we are NOT in update mode. Skip reporting it.
            return;
          }
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
        !this.config.frameworks.includes(rule.category as any)
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
    const ancestors: any[] = [];
    walk(ast, {
      enter(node: any, parent: any) {
        for (const { visitor } of activeVisitors) {
          const handler = visitor[node.type];
          if (handler) handler(node, parent, ancestors);
        }
        ancestors.push(node);
      },
      leave(node: any, parent: any) {
        ancestors.pop();
        const exitKey = `${node.type}:exit`;
        for (const { visitor } of activeVisitors) {
          const handler = visitor[exitKey];
          if (handler) handler(node, parent, ancestors);
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
