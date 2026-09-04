import { memoryLeakDetectorPlugin } from './plugin.js';

export default memoryLeakDetectorPlugin;
export { memoryLeakDetectorPlugin as memoryLeakDetector };

// Core Config Types
export type {
  PluginOptions,
  ResolvedPluginConfig,
  PluginMode,
  FrameworkType,
  ReportFormat,
  ReportDestination,
  ThresholdConfig,
  BaselineConfig,
  CommentDirectivesConfig,
  Severity,
  RuleSeverityConfig,
  IgnoreRule,
  IgnoreConfig,
  AllowlistConfig,
} from './types/config.js';

// Diagnostic Types
export type {
  Diagnostic,
  SourceLocation,
  CodeFrame,
} from './types/diagnostic.js';

// Rule Extensibility Types
export type {
  RuleContext,
  RuleDefinition,
  RuleVisitor,
  ExtractionResult,
} from './types/rule.js';

// Engine & Utils
export { LeakDetectorEngine } from './core/engine.js';
export { resolvePluginConfig } from './config/index.js';
export { BaselineManager, generateFingerprint } from './core/baseline.js';
export { CommentDirectivesHandler } from './core/comments.js';
export { IgnoreManager } from './core/ignore.js';

// Built-in Rules
export {
  builtinRules,
  noUnclearedTimersRule,
  noUnregisteredListenersRule,
  noUnconnectedObserversRule,
  noUnsubscribedEventsRule,
  reactUseEffectCleanupRule,
  vueMissingOnUnmountedRule,
  svelteMissingOnDestroyRule,
  solidMissingOnCleanupRule,
} from './rules/index.js';
