import type { RuleDefinition } from '../types/rule.js';
import { noUnclearedTimersRule } from './generic/no-uncleared-timers.js';
import { noUnregisteredListenersRule } from './generic/no-unregistered-listeners.js';
import { noUnconnectedObserversRule } from './generic/no-unconnected-observers.js';
import { noUnsubscribedEventsRule } from './generic/no-unsubscribed-events.js';
import { reactUseEffectCleanupRule } from './react/react-useeffect-cleanup.js';
import { vueMissingOnUnmountedRule } from './vue/vue-missing-onunmounted.js';
import { svelteMissingOnDestroyRule } from './svelte/svelte-missing-ondestroy.js';
import { solidMissingOnCleanupRule } from './solid/solid-missing-oncleanup.js';

export const builtinRules: RuleDefinition[] = [
  noUnclearedTimersRule,
  noUnregisteredListenersRule,
  noUnconnectedObserversRule,
  noUnsubscribedEventsRule,
  reactUseEffectCleanupRule,
  vueMissingOnUnmountedRule,
  svelteMissingOnDestroyRule,
  solidMissingOnCleanupRule,
];

export {
  noUnclearedTimersRule,
  noUnregisteredListenersRule,
  noUnconnectedObserversRule,
  noUnsubscribedEventsRule,
  reactUseEffectCleanupRule,
  vueMissingOnUnmountedRule,
  svelteMissingOnDestroyRule,
  solidMissingOnCleanupRule,
};
