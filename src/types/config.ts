import type { FilterPattern } from '@rollup/pluginutils';
import type { RuleDefinition } from './rule.js';

export type Severity = 'error' | 'warn' | 'info' | 'off';

export type PluginMode = 'warn' | 'error' | 'report-only';

export type FrameworkType = 'react' | 'vue' | 'svelte' | 'solid';

export type ReportFormat = 'stylish' | 'default' | 'json' | 'sarif' | 'html' | 'markdown';

export interface ReportDestination {
  format: ReportFormat;
  outputFile?: string;
}

export interface ThresholdConfig {
  /**
   * Maximum allowed warnings before failing the build.
   * (Triggered in 'warn' and 'error' modes).
   * @default Infinity
   */
  maxWarnings?: number;

  /**
   * Maximum allowed errors before failing the build.
   * @default 0 in 'error' mode, Infinity in 'warn' or 'report-only' mode
   */
  maxErrors?: number;

  /**
   * Maximum total diagnostics allowed before failing the build.
   * @default Infinity
   */
  maxTotal?: number;
}

export interface BaselineConfig {
  /**
   * Path to the baseline JSON file.
   * @default '.leak-baseline.json'
   */
  path?: string;

  /**
   * If true, records all detected leaks into the baseline file instead of failing.
   * @default false
   */
  update?: boolean;
}

export interface CommentDirectivesConfig {
  /**
   * Whether inline suppression comments are enabled.
   * @default true
   */
  enabled?: boolean;

  /**
   * Custom directive prefix.
   * Example: 'memory-leak' supports `// memory-leak-ignore-next-line`
   * @default 'memory-leak'
   */
  prefix?: string;
}

export interface RuleSeverityConfig {
  [ruleId: string]: Severity | { severity: Severity; options?: Record<string, unknown> };
}

export interface IgnoreRule {
  /** Glob pattern(s) to match against file paths (e.g., '**\\/*.test.ts') */
  glob: string | string[];
  /** Rules to ignore for these files. If omitted, ignores ALL rules. */
  rules?: string[];
}

export type IgnoreConfig = Array<string | IgnoreRule>;

export interface AllowlistConfig {
  /**
   * Global function names to ignore (e.g., ['useInterval', 'customSetTimeout'])
   */
  functions?: string[];
  /**
   * Object method names to ignore (e.g., ['onCustomEvent', 'subscribeSafe'])
   */
  methods?: string[];
}

export interface PluginOptions {
  /**
   * Operating mode:
   * - `'error'`: Emits errors and fails build when errors or thresholds are exceeded.
   * - `'warn'`: Emits diagnostics as warnings. Fails build only if threshold limits are exceeded.
   * - `'report-only'`: Does not fail the build or block Vite transform; writes reports quietly.
   * @default 'warn'
   */
  mode?: PluginMode;

  /**
   * Active frameworks to analyze. If `'auto'`, enabled frameworks are inferred from rules & files.
   * @default 'auto'
   */
  frameworks?: 'auto' | FrameworkType[];

  /**
   * Thresholds for build failure.
   */
  thresholds?: ThresholdConfig;

  /**
   * Files to include in analysis.
   * @default /\.[jt]sx?$|\.vue$|\.svelte$/
   */
  include?: FilterPattern;

  /**
   * Files to exclude from analysis.
   * @default /node_modules/
   */
  exclude?: FilterPattern;

  /**
   * Per-rule severity overrides.
   */
  rules?: RuleSeverityConfig;

  /**
   * Advanced glob-based ignore system for files and specific rules.
   */
  ignores?: IgnoreConfig;

  /**
   * Allowlist specific function and method names that handle their own memory cleanup.
   */
  allowlist?: AllowlistConfig;

  /**
   * Custom detection rules.
   */
  customRules?: RuleDefinition[];

  /**
   * Inline comment suppression settings (`// vite-leak-disable-next-line`).
   */
  comments?: CommentDirectivesConfig;

  /**
   * Baseline configuration to ignore known legacy issues.
   */
  baseline?: string | BaselineConfig;

  /**
   * Report output formats and destinations.
   * Can be a single format string, an array of formats, or structured output destinations.
   * @default 'stylish'
   */
  reports?: ReportFormat | (ReportFormat | ReportDestination)[];

  /**
   * Legacy shorthand for console reporter format.
   */
  reporter?: ReportFormat;

  /**
   * Output directory for file-based reports (e.g., .html, .sarif, .json).
   * @default '.leak-reports'
   */
  outputDir?: string;

  /**
   * Enable verbose debugging logs.
   * @default false
   */
  verbose?: boolean;
}

export interface ResolvedPluginConfig {
  mode: PluginMode;
  frameworks: 'auto' | FrameworkType[];
  thresholds: Required<ThresholdConfig>;
  include: FilterPattern;
  exclude: FilterPattern;
  rules: RuleSeverityConfig;
  customRules: RuleDefinition[];
  ignores: IgnoreConfig;
  allowlist: Required<AllowlistConfig>;
  comments: Required<CommentDirectivesConfig>;
  baseline: {
    enabled: boolean;
    path: string;
    update: boolean;
  };
  reports: ReportDestination[];
  outputDir: string;
  verbose: boolean;
}
