import { memoryLeakDetectorPlugin } from './plugin.js';

export default memoryLeakDetectorPlugin;
export { memoryLeakDetectorPlugin };

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
} from './types/config.js';

export type {
  Diagnostic,
  SourceLocation,
  CodeFrame,
} from './types/diagnostic.js';

export type {
  RuleContext,
  RuleDefinition,
  ExtractionResult,
} from './types/rule.js';

export { LeakDetectorEngine } from './core/engine.js';
export { resolvePluginConfig } from './config/index.js';
export { BaselineManager, generateFingerprint } from './core/baseline.js';
export { CommentDirectivesHandler } from './core/comments.js';
export { builtinRules } from './rules/index.js';
export { noUnclearedTimersRule } from './rules/generic/no-uncleared-timers.js';
export { noUnregisteredListenersRule } from './rules/generic/no-unregistered-listeners.js';
export { reactUseEffectCleanupRule } from './rules/react/react-useeffect-cleanup.js';
