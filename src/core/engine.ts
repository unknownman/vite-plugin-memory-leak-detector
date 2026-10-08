import { walk } from 'estree-walker';
import type { Diagnostic } from '../types/diagnostic.js';
import type { RuleContext, RuleDefinition, ExtractionResult, RuleVisitor } from '../types/rule.js';
import type { Severity, ResolvedPluginConfig } from '../types/config.js';
import { parseCode } from './parser.js';
import { CommentDirectivesHandler } from './comments.js';
import { BaselineManager, generateFingerprint, normalizeSnippet } from './baseline.js';
import { IgnoreManager } from './ignore.js';

/** Signature shared by every entry of a `RuleVisitor`, enter or `:exit`. */
type RuleVisitorFn = (node: any, parent: any, ancestors?: any[]) => void;

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

  /** Cached union of `RuleDefinition.triggers` for the currently enabled rules. */
  private activeTriggerCache?: {
    rules: number;
    frameworks: ResolvedPluginConfig['frameworks'];
    customRules: number;
    triggers: Set<string>;
  };

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

  /**
   * True when at least one enabled rule's triggers appear in `source`.
   *
   * The trigger set is cached because it only changes when the configured rule
   * list does, and it is rebuilt on demand so mutating `config.customRules`
   * (the plugin appends the built-ins to it) stays correct.
   */
  private mightContainLeak(source: string): boolean {
    const triggers = this.getActiveTriggers();
    if (triggers === null) return true;
    for (const trigger of triggers) {
      if (source.includes(trigger)) return true;
    }
    return false;
  }

  /**
   * Union of the triggers of every rule that survived category and severity
   * filtering. Returns `null` when a rule has no `triggers` array, which forces
   * the caller down the full-parse path: a rule that cannot describe its own
   * requirements must never be silently skipped.
   */
  private getActiveTriggers(): Set<string> | null {
    const cache = this.activeTriggerCache;
    if (
      cache &&
      cache.rules === this.rules.length &&
      cache.frameworks === this.config.frameworks &&
      cache.customRules === this.config.customRules.length
    ) {
      return cache.triggers;
    }

    const triggers = new Set<string>();
    for (const rule of this.rules) {
      if (
        this.config.frameworks !== 'auto' &&
        rule.category !== 'generic' &&
        !this.config.frameworks.includes(rule.category as any)
      ) {
        continue;
      }
      if (this.resolveSeverity(rule.id) === 'off') continue;
      if (!Array.isArray(rule.triggers) || rule.triggers.length === 0) return null;
      for (const trigger of rule.triggers) triggers.add(trigger);
    }

    this.activeTriggerCache = {
      rules: this.rules.length,
      frameworks: this.config.frameworks,
      customRules: this.config.customRules.length,
      triggers,
    };
    return triggers;
  }

  public analyze(file: string, code: string, extraction?: ExtractionResult): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    // 1. FAST PATH: Check Glob-based global ignores
    if (this.ignoreManager.isFileGloballyIgnored(file)) {
      return diagnostics;
    }

    const scriptCode = extraction ? extraction.code : code;
    if (scriptCode.trim() === '') return diagnostics;

    // 4.2 Prefilter: a module that allocates nothing cannot produce a leak, so
    // it never needs to be parsed. Every enabled rule declares the identifiers
    // it inspects (`RuleDefinition.triggers`); if none of them appears anywhere
    // in the source, bail out before building an AST. This is a substring scan
    // over the raw text — far cheaper than `oxc-parser`, and the dominant cost
    // for the large files (generated bundles, lockfiles, style-heavy views)
    // that make up most of a real project's module graph.
    if (!this.mightContainLeak(scriptCode)) return diagnostics;

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

    // 4.3 Visitor map: one lookup per node instead of a per-rule property
    // probe. Previously every node walked every rule's visitor object, so
    // traversal cost was O(nodes x rules) even though only a handful of
    // (rule, nodeType) pairs are ever live. Building this map is
    // O(sum of each rule's handler count), and the walk becomes
    // O(nodes + handler invocations).
    const enterMap = new Map<string, RuleVisitorFn[]>();
    const exitMap = new Map<string, RuleVisitorFn[]>();
    for (const { visitor } of activeVisitors) {
      for (const key of Object.keys(visitor)) {
        const handler = visitor[key];
        if (typeof handler !== 'function') continue;
        const isExit = key.endsWith(':exit');
        const nodeType = isExit ? key.slice(0, -5) : key;
        const target = isExit ? exitMap : enterMap;
        const bucket = target.get(nodeType);
        if (bucket) bucket.push(handler);
        else target.set(nodeType, [handler]);
      }
    }

    // Single-pass AST Traversal. The `*` / `*:exit` wildcard bucket runs for
    // every node: before the type-specific handlers on enter, after them on
    // exit. That order lets a wildcard wrapper observe the parent's state
    // before (and unwind it after) the node-type handler runs.
    const ancestors: any[] = [];
    walk(ast, {
      enter(node: any, parent: any) {
        const wildcards = enterMap.get('*');
        if (wildcards) for (const handler of wildcards) handler(node, parent, ancestors);
        const handlers = enterMap.get(node.type);
        if (handlers) for (const handler of handlers) handler(node, parent, ancestors);
        ancestors.push(node);
      },
      leave(node: any, parent: any) {
        ancestors.pop();
        const handlers = exitMap.get(node.type);
        if (handlers) for (const handler of handlers) handler(node, parent, ancestors);
        const wildcards = exitMap.get('*');
        if (wildcards) for (const handler of wildcards) handler(node, parent, ancestors);
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
