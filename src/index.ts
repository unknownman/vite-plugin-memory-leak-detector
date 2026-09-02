import { memoryLeakDetectorPlugin } from './plugin.js';

export default memoryLeakDetectorPlugin;
export { memoryLeakDetectorPlugin };

export type {
  PluginOptions,
  Severity,
  ReporterType,
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
export { parseCode } from './core/parser.js';
export { builtinRules } from './rules/index.js';
export { noUnclearedTimersRule } from './rules/generic/no-uncleared-timers.js';
export { noUnregisteredListenersRule } from './rules/generic/no-unregistered-listeners.js';
export { reactUseEffectCleanupRule } from './rules/react/react-useeffect-cleanup.js';
