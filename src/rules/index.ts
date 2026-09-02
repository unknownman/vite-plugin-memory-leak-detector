import type { RuleDefinition } from '../types/rule.js';
import { noUnclearedTimersRule } from './generic/no-uncleared-timers.js';
import { noUnregisteredListenersRule } from './generic/no-unregistered-listeners.js';
import { reactUseEffectCleanupRule } from './react/react-useeffect-cleanup.js';

export const builtinRules: RuleDefinition[] = [
  noUnclearedTimersRule,
  noUnregisteredListenersRule,
  reactUseEffectCleanupRule,
];

export { noUnclearedTimersRule } from './generic/no-uncleared-timers.js';
export { noUnregisteredListenersRule } from './generic/no-unregistered-listeners.js';
export { reactUseEffectCleanupRule } from './react/react-useeffect-cleanup.js';
