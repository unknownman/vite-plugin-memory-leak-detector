import type { FilterPattern } from '@rollup/pluginutils';

export type Severity = 'error' | 'warn' | 'off';

export type ReporterType = 'stylish' | 'json' | 'default';

export interface RuleSeverityConfig {
  [ruleId: string]: Severity | { severity: Severity; options?: Record<string, unknown> };
}

export interface PluginOptions {
  /**
   * Files to include in the analysis.
   * @default /\.[jt]sx?$/
   */
  include?: FilterPattern;

  /**
   * Files to exclude from the analysis.
   * @default /node_modules/
   */
  exclude?: FilterPattern;

  /**
   * Fail the build if error-level diagnostics are found.
   * @default false
   */
  failOnError?: boolean;

  /**
   * Override severity levels for specific rules.
   */
  rules?: RuleSeverityConfig;

  /**
   * Custom rules to add to the detector.
   */
  customRules?: RuleDefinition[];

  /**
   * Reporter type for output formatting.
   * @default 'stylish'
   */
  reporter?: ReporterType;

  /**
   * Enable verbose logging for debugging.
   * @default false
   */
  verbose?: boolean;
}

import type { RuleDefinition } from './rule.js';
