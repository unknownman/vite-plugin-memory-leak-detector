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
});

describe('vue/missing-onunmounted', () => {
  it('detects allocations without onUnmounted', () => {
    const code = `
      import { onMounted } from 'vue';
      onMounted(() => {
        setInterval(tick, 1000);
      });
    `;
    const diagnostics = runRule(vueMissingOnUnmountedRule, code);
    expect(diagnostics).toHaveLength(1);
  });

  it('allows allocations if onUnmounted is present and clears resource', () => {
    const code = `
      import { onMounted, onUnmounted } from 'vue';
      onMounted(() => { setInterval(tick, 1000); });
      onUnmounted(() => { clearInterval(id); });
    `;
    const diagnostics = runRule(vueMissingOnUnmountedRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('detects leak when onUnmounted is empty', () => {
    const code = `
      import { onMounted, onUnmounted } from 'vue';
      onMounted(() => { setInterval(tick, 1000); });
      onUnmounted(() => {});
    `;
    const diagnostics = runRule(vueMissingOnUnmountedRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('allocates external resources');
  });

  it('allows allocations if onBeforeUnmount is present and clears resource', () => {
    const code = `
      import { onBeforeUnmount } from 'vue';
      onBeforeUnmount(() => {
        clearInterval(id);
      });
      setInterval(tick, 1000);
    `;
    const diagnostics = runRule(vueMissingOnUnmountedRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('detects leak if onBeforeUnmount is empty', () => {
    const code = `
      import { onBeforeUnmount } from 'vue';
      onBeforeUnmount(() => {});
      setInterval(tick, 1000);
    `;
    const diagnostics = runRule(vueMissingOnUnmountedRule, code);
    expect(diagnostics).toHaveLength(1);
  });
});

describe('svelte/missing-ondestroy', () => {
  it('detects allocations without onDestroy', () => {
    const code = `
      setInterval(tick, 1000);
    `;
    const diagnostics = runRule(svelteMissingOnDestroyRule, code);
    expect(diagnostics).toHaveLength(1);
  });

  it('allows allocations if onDestroy is present and clears resource', () => {
    const code = `
      import { onDestroy } from 'svelte';
      onDestroy(() => {
        clearInterval(id);
      });
      setInterval(tick, 1000);
    `;
    const diagnostics = runRule(svelteMissingOnDestroyRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('detects leak if onDestroy is empty', () => {
    const code = `
      import { onDestroy } from 'svelte';
      onDestroy(() => {});
      setInterval(tick, 1000);
    `;
    const diagnostics = runRule(svelteMissingOnDestroyRule, code);
    expect(diagnostics).toHaveLength(1);
  });
});

describe('solid/missing-oncleanup', () => {
  it('detects allocations without onCleanup', () => {
    const code = `
      setInterval(tick, 1000);
    `;
    const diagnostics = runRule(solidMissingOnCleanupRule, code);
    expect(diagnostics).toHaveLength(1);
  });

  it('allows allocations if onCleanup is present and clears resource', () => {
    const code = `
      import { onCleanup } from 'solid-js';
      onCleanup(() => {
        clearInterval(id);
      });
      setInterval(tick, 1000);
    `;
    const diagnostics = runRule(solidMissingOnCleanupRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('detects leak if onCleanup is empty', () => {
    const code = `
      import { onCleanup } from 'solid-js';
      onCleanup(() => {});
      setInterval(tick, 1000);
    `;
    const diagnostics = runRule(solidMissingOnCleanupRule, code);
    expect(diagnostics).toHaveLength(1);
  });
});
