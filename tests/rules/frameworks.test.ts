import { describe, it, expect } from 'vitest';
import { runRule } from '../utils.js';
import { reactUseEffectCleanupRule } from '../../src/rules/react/react-useeffect-cleanup.js';
import { vueMissingOnUnmountedRule } from '../../src/rules/vue/vue-missing-onunmounted.js';
import { svelteMissingOnDestroyRule } from '../../src/rules/svelte/svelte-missing-ondestroy.js';
import { solidMissingOnCleanupRule } from '../../src/rules/solid/solid-missing-oncleanup.js';

describe('react/react-useeffect-cleanup', () => {
  it('detects leaky useEffect without cleanup', () => {
    const code = `
      useEffect(() => {
        window.addEventListener('resize', handleResize);
      }, []);
    `;
    const diagnostics = runRule(reactUseEffectCleanupRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('does not return a cleanup function');
  });

  it('allows useEffect with a cleanup return', () => {
    const code = `
      useEffect(() => {
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
      }, []);
    `;
    const diagnostics = runRule(reactUseEffectCleanupRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('detects setInterval inside useEffect without cleanup', () => {
    const code = `
      useEffect(() => {
        setInterval(tick, 1000);
      }, []);
    `;
    const diagnostics = runRule(reactUseEffectCleanupRule, code);
    expect(diagnostics).toHaveLength(1);
  });

  it('detects WebSocket inside useEffect without cleanup', () => {
    const code = `
      useEffect(() => {
        const ws = new WebSocket(url);
      }, []);
    `;
    const diagnostics = runRule(reactUseEffectCleanupRule, code);
    expect(diagnostics).toHaveLength(1);
  });

  it('allows useEffect with no block body (implicit return)', () => {
    const code = `useEffect(() => fetch(url), []);`;
    const diagnostics = runRule(reactUseEffectCleanupRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('does not suppress warning when returning null', () => {
    const code = `
      useEffect(() => {
        if (!ready) return null;
        setInterval(tick, 1000);
      }, [ready]);
    `;
    const diagnostics = runRule(reactUseEffectCleanupRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('does not return a cleanup function');
  });

  it('does not suppress warning when returning false', () => {
    const code = `
      useEffect(() => {
        if (!ready) return false;
        setInterval(tick, 1000);
      }, [ready]);
    `;
    const diagnostics = runRule(reactUseEffectCleanupRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('does not return a cleanup function');
  });

  it('does not treat an early return without a value as cleanup', () => {
    const code = `
      useEffect(() => {
        if (!ready) return;
        const id = setInterval(tick, 1000);
      }, [ready]);
    `;
    const diagnostics = runRule(reactUseEffectCleanupRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('does not return a cleanup function');
  });

  it('suppresses warning when returning () => clearInterval(id)', () => {
    const code = `
      useEffect(() => {
        if (!ready) return null;
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
      }, [ready]);
    `;
    const diagnostics = runRule(reactUseEffectCleanupRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('allows returning an identifier holding a cleanup function reference', () => {
    const code = `
      useEffect(() => {
        const id = setInterval(tick, 1000);
        const cleanup = () => clearInterval(id);
        return cleanup;
      }, []);
    `;
    const diagnostics = runRule(reactUseEffectCleanupRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('flags unassigned setInterval even when a cleanup for an unrelated resource is returned', () => {
    const code = `
      useEffect(() => {
        setInterval(foo, 1000);
        return () => removeEventListener('resize', bar);
      }, []);
    `;
    const diagnostics = runRule(reactUseEffectCleanupRule, code);
    expect(diagnostics).toHaveLength(1);
  });

  it('flags an assigned resource when the returned cleanup does not clear it', () => {
    const code = `
      useEffect(() => {
        const id = setInterval(foo, 1000);
        return () => removeEventListener('resize', bar);
      }, []);
    `;
    const diagnostics = runRule(reactUseEffectCleanupRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("Resource 'id'");
    expect(diagnostics[0].message).toContain('does not clear it');
  });

  it('allows an assigned resource when the returned cleanup clears it by name', () => {
    const code = `
      useEffect(() => {
        const id = setInterval(foo, 1000);
        return () => clearInterval(id);
      }, []);
    `;
    const diagnostics = runRule(reactUseEffectCleanupRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('allows addEventListener with an AbortSignal and no cleanup', () => {
    const code = `
      useEffect(() => {
        const handler = () => {};
        window.addEventListener('resize', handler, { signal: ctrl.signal });
      }, []);
    `;
    const diagnostics = runRule(reactUseEffectCleanupRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('allows effect results stored in React state setters', () => {
    const code = `
      useEffect(() => {
        setTimerId(setInterval(tick, 1000));
        return () => setTimerId(null);
      }, []);
    `;
    const diagnostics = runRule(reactUseEffectCleanupRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('suppresses warnings when the returned cleanup calls an opaque external teardown', () => {
    const code = `
      useEffect(() => {
        const id = setInterval(tick, 1000);
        return () => customTeardownUtility(id);
      }, []);
    `;
    const diagnostics = runRule(reactUseEffectCleanupRule, code);
    expect(diagnostics).toHaveLength(0);
  });
});

describe('vue/missing-onunmounted', () => {
  it('detects allocations without onUnmounted', () => {
    const code = `
      import { onMounted } from 'vue';
      const id = setInterval(tick, 1000);
      onMounted(() => {});
    `;
    const diagnostics = runRule(vueMissingOnUnmountedRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("Resource 'id'");
    expect(diagnostics[0].message).toContain('never cleared');
  });

  it('allows allocations if onUnmounted clears the exact resource', () => {
    const code = `
      import { onUnmounted } from 'vue';
      const id = setInterval(tick, 1000);
      onUnmounted(() => { clearInterval(id); });
    `;
    const diagnostics = runRule(vueMissingOnUnmountedRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('flags a resource when onUnmounted clears a different variable', () => {
    const code = `
      import { onUnmounted } from 'vue';
      const id = setInterval(tick, 1000);
      onUnmounted(() => { clearInterval(other); });
    `;
    const diagnostics = runRule(vueMissingOnUnmountedRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("Resource 'id'");
  });

  it('detects leak when onUnmounted is empty', () => {
    const code = `
      import { onUnmounted } from 'vue';
      const id = setInterval(tick, 1000);
      onUnmounted(() => {});
    `;
    const diagnostics = runRule(vueMissingOnUnmountedRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('never cleared');
  });

  it('allows allocations if onBeforeUnmount is present and clears resource', () => {
    const code = `
      import { onBeforeUnmount } from 'vue';
      onBeforeUnmount(() => { clearInterval(id); });
      const id = setInterval(tick, 1000);
    `;
    const diagnostics = runRule(vueMissingOnUnmountedRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('detects leak if onBeforeUnmount is empty', () => {
    const code = `
      import { onBeforeUnmount } from 'vue';
      onBeforeUnmount(() => {});
      const id = setInterval(tick, 1000);
    `;
    const diagnostics = runRule(vueMissingOnUnmountedRule, code);
    expect(diagnostics).toHaveLength(1);
  });

  it('flags only the uncleared resource when two allocations exist but only one is cleared', () => {
    const code = `
      import { onUnmounted } from 'vue';
      const timerA = setInterval(tick, 1000);
      const timerB = setInterval(tock, 2000);
      onUnmounted(() => {
        clearInterval(timerA);
      });
    `;
    const diagnostics = runRule(vueMissingOnUnmountedRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("Resource 'timerB'");
  });

  it('flags allocations inside onMounted callbacks (reactive wrapper)', () => {
    const code = `
      import { onMounted } from 'vue';
      onMounted(() => {
        const id = setInterval(tick, 1000);
      });
    `;
    const diagnostics = runRule(vueMissingOnUnmountedRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("Resource 'id'");
    expect(diagnostics[0].message).toContain('never cleared');
  });

  it('flags allocations inside a watch callback when never cleared', () => {
    const code = `
      import { watch, onMounted } from 'vue';
      watch(() => {
        const id = setInterval(tick, 1000);
      });
      onMounted(() => {});
    `;
    const diagnostics = runRule(vueMissingOnUnmountedRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("Resource 'id'");
  });

  it('allows a watch allocation that is cleared in onUnmounted', () => {
    const code = `
      import { watch, onUnmounted } from 'vue';
      watch(() => {
        const id = setInterval(tick, 1000);
        onUnmounted(() => clearInterval(id));
      });
    `;
    const diagnostics = runRule(vueMissingOnUnmountedRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('ignores allocations inside DOM event callbacks', () => {
    const code = `
      import { onMounted } from 'vue';
      el.addEventListener('click', () => {
        const id = setInterval(tick, 1000);
      });
      onMounted(() => {});
    `;
    const diagnostics = runRule(vueMissingOnUnmountedRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('does not flag allocations inside pure utility functions', () => {
    const code = `
      import { onMounted } from 'vue';
      export function useUtils() {
        window.addEventListener('resize', () => {});
        const id = setInterval(tick, 1000);
      }
      onMounted(() => {});
    `;
    const diagnostics = runRule(vueMissingOnUnmountedRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('allows onUnmounted referencing a local cleanup function', () => {
    const code = `
      const id = setInterval(tick, 1000);
      const cleanup = () => clearInterval(id);
      onUnmounted(cleanup);
    `;
    const diagnostics = runRule(vueMissingOnUnmountedRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('allows onUnmounted referencing an external (imported) cleanup function', () => {
    const code = `
      import { cleanup } from './utils';
      const id = setInterval(tick, 1000);
      onUnmounted(cleanup);
    `;
    const diagnostics = runRule(vueMissingOnUnmountedRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('flags allocations when the referenced cleanup does not clear anything', () => {
    const code = `
      const cleanup = () => console.log('no-op');
      const id = setInterval(tick, 1000);
      onUnmounted(cleanup);
    `;
    const diagnostics = runRule(vueMissingOnUnmountedRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("Resource 'id'");
  });
});

describe('svelte/missing-ondestroy', () => {
  it('detects allocations without onDestroy', () => {
    const code = `
      const id = setInterval(tick, 1000);
    `;
    const diagnostics = runRule(svelteMissingOnDestroyRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("Resource 'id'");
    expect(diagnostics[0].message).toContain('never cleared');
  });

  it('allows allocations if onDestroy clears the exact resource', () => {
    const code = `
      import { onDestroy } from 'svelte';
      onDestroy(() => { clearInterval(id); });
      const id = setInterval(tick, 1000);
    `;
    const diagnostics = runRule(svelteMissingOnDestroyRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('flags a resource when onDestroy clears a different variable', () => {
    const code = `
      import { onDestroy } from 'svelte';
      const id = setInterval(tick, 1000);
      onDestroy(() => { clearInterval(other); });
    `;
    const diagnostics = runRule(svelteMissingOnDestroyRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("Resource 'id'");
  });

  it('detects leak if onDestroy is empty', () => {
    const code = `
      import { onDestroy } from 'svelte';
      onDestroy(() => {});
      const id = setInterval(tick, 1000);
    `;
    const diagnostics = runRule(svelteMissingOnDestroyRule, code);
    expect(diagnostics).toHaveLength(1);
  });

  it('allows onDestroy referencing a local cleanup function', () => {
    const code = `
      const id = setInterval(tick, 1000);
      function cleanup() {
        clearInterval(id);
      }
      onDestroy(cleanup);
    `;
    const diagnostics = runRule(svelteMissingOnDestroyRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('flags allocations inside onMount callbacks (reactive wrapper)', () => {
    const code = `
      import { onMount } from 'svelte';
      onMount(() => {
        const id = setInterval(tick, 1000);
      });
    `;
    const diagnostics = runRule(svelteMissingOnDestroyRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("Resource 'id'");
  });

  it('flags allocations inside a $effect callback when never cleared', () => {
    const code = `
      $effect(() => {
        const id = setInterval(tick, 1000);
      });
    `;
    const diagnostics = runRule(svelteMissingOnDestroyRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("Resource 'id'");
  });

  it('allows a $effect allocation that is cleared in onDestroy', () => {
    const code = `
      import { onDestroy } from 'svelte';
      $effect(() => {
        const id = setInterval(tick, 1000);
        onDestroy(() => clearInterval(id));
      });
    `;
    const diagnostics = runRule(svelteMissingOnDestroyRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('ignores allocations inside DOM event callbacks', () => {
    const code = `
      el.addEventListener('click', () => {
        const id = setInterval(tick, 1000);
      });
    `;
    const diagnostics = runRule(svelteMissingOnDestroyRule, code);
    expect(diagnostics).toHaveLength(0);
  });
});

describe('solid/missing-oncleanup', () => {
  it('detects allocations without onCleanup', () => {
    const code = `
      const id = setInterval(tick, 1000);
    `;
    const diagnostics = runRule(solidMissingOnCleanupRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("Resource 'id'");
    expect(diagnostics[0].message).toContain('never cleared');
  });

  it('allows allocations if onCleanup clears the exact resource', () => {
    const code = `
      import { onCleanup } from 'solid-js';
      onCleanup(() => { clearInterval(id); });
      const id = setInterval(tick, 1000);
    `;
    const diagnostics = runRule(solidMissingOnCleanupRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('flags a resource when onCleanup clears a different variable', () => {
    const code = `
      import { onCleanup } from 'solid-js';
      const id = setInterval(tick, 1000);
      onCleanup(() => { clearInterval(other); });
    `;
    const diagnostics = runRule(solidMissingOnCleanupRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("Resource 'id'");
  });

  it('detects leak if onCleanup is empty', () => {
    const code = `
      import { onCleanup } from 'solid-js';
      onCleanup(() => {});
      const id = setInterval(tick, 1000);
    `;
    const diagnostics = runRule(solidMissingOnCleanupRule, code);
    expect(diagnostics).toHaveLength(1);
  });

  it('flags only the uncleared resource when two allocations exist but only one is cleared', () => {
    const code = `
      import { onCleanup } from 'solid-js';
      const timerA = setInterval(tick, 1000);
      const timerB = setInterval(tock, 2000);
      onCleanup(() => {
        clearInterval(timerA);
      });
    `;
    const diagnostics = runRule(solidMissingOnCleanupRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("Resource 'timerB'");
  });

  it('allows onCleanup referencing a local cleanup function', () => {
    const code = `
      const id = setInterval(tick, 1000);
      const cleanup = () => clearInterval(id);
      onCleanup(cleanup);
    `;
    const diagnostics = runRule(solidMissingOnCleanupRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('flags allocations inside onMount callbacks (reactive wrapper)', () => {
    const code = `
      import { onMount } from 'solid-js';
      onMount(() => {
        const id = setInterval(tick, 1000);
      });
    `;
    const diagnostics = runRule(solidMissingOnCleanupRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("Resource 'id'");
  });

  it('flags allocations inside a createEffect callback when never cleared', () => {
    const code = `
      import { createEffect } from 'solid-js';
      createEffect(() => {
        const id = setInterval(tick, 1000);
      });
    `;
    const diagnostics = runRule(solidMissingOnCleanupRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("Resource 'id'");
  });

  it('allows a createEffect allocation that is cleared in onCleanup', () => {
    const code = `
      import { createEffect, onCleanup } from 'solid-js';
      createEffect(() => {
        const id = setInterval(tick, 1000);
        onCleanup(() => clearInterval(id));
      });
    `;
    const diagnostics = runRule(solidMissingOnCleanupRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('ignores allocations inside DOM event callbacks', () => {
    const code = `
      import { createEffect } from 'solid-js';
      el.addEventListener('click', () => {
        const id = setInterval(tick, 1000);
      });
      createEffect(() => {});
    `;
    const diagnostics = runRule(solidMissingOnCleanupRule, code);
    expect(diagnostics).toHaveLength(0);
  });
});