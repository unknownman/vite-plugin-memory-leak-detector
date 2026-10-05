import { describe, it, expect } from 'vitest';
import { runRule } from '../utils.js';
import { LeakDetectorEngine } from '../../src/core/engine.js';
import { resolvePluginConfig } from '../../src/config/index.js';
import { reactUseEffectCleanupRule } from '../../src/rules/react/react-useeffect-cleanup.js';

const RULE_ID = 'react/react-useeffect-cleanup';

function engineWith(rules: Record<string, string> = {}) {
  return new LeakDetectorEngine(
    resolvePluginConfig({
      mode: 'warn',
      customRules: [reactUseEffectCleanupRule],
      rules,
    })
  );
}

describe('react/react-useeffect-cleanup severity', () => {
  it('defaults to warn so idiomatic React does not fail a build', () => {
    const diagnostics = engineWith().analyze(
      '/app/src/App.tsx',
      'useEffect(() => { el.addEventListener("click", onClick); }, []);'
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe('warn');
    expect(diagnostics[0].ruleId).toBe(RULE_ID);
  });

  it('can still be raised to error per rule', () => {
    const diagnostics = engineWith({ [RULE_ID]: 'error' }).analyze(
      '/app/src/App.tsx',
      'useEffect(() => { el.addEventListener("click", onClick); }, []);'
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe('error');
  });

  it('accepts the object form of a severity override', () => {
    const diagnostics = engineWith({ [RULE_ID]: { severity: 'error' } }).analyze(
      '/app/src/App.tsx',
      'useEffect(() => { el.addEventListener("click", onClick); }, []);'
    );

    expect(diagnostics[0].severity).toBe('error');
  });

  it('can be switched off entirely', () => {
    const diagnostics = engineWith({ [RULE_ID]: 'off' }).analyze(
      '/app/src/App.tsx',
      'useEffect(() => { el.addEventListener("click", onClick); }, []);'
    );

    expect(diagnostics).toHaveLength(0);
  });

  it('is not counted as an error for thresholds when left at the default', () => {
    const diagnostics = engineWith().analyze(
      '/app/src/App.tsx',
      'useEffect(() => { const id = setInterval(tick, 1000); }, []);'
    );

    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    expect(diagnostics.filter((d) => d.severity === 'warn')).toHaveLength(1);
  });
});

describe('react/react-useeffect-cleanup one-shot timers', () => {
  it('does not require cleanup for a setTimeout inside useEffect', () => {
    const diagnostics = runRule(
      reactUseEffectCleanupRule,
      'useEffect(() => { setTimeout(() => save(), 1000); }, []);'
    );

    expect(diagnostics).toHaveLength(0);
  });

  it('does not require cleanup for a setTimeout when the effect has no cleanup', () => {
    const diagnostics = runRule(
      reactUseEffectCleanupRule,
      'useEffect(() => { setTimeout(onTick, 1000); });'
    );

    expect(diagnostics).toHaveLength(0);
  });

  it('does not treat setTimeout as a leak even when an interval leaks too', () => {
    const diagnostics = runRule(
      reactUseEffectCleanupRule,
      `useEffect(() => {
        setTimeout(onTick, 1000);
        const id = setInterval(onTick, 1000);
      }, []);`
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('does not return a cleanup function');
  });

  it('still reports a cleared setTimeout alongside an uncleared listener', () => {
    const diagnostics = runRule(
      reactUseEffectCleanupRule,
      `useEffect(() => {
        const t = setTimeout(onTick, 1000);
        clearTimeout(t);
        el.addEventListener('click', onClick);
      }, []);`
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('does not return a cleanup function');
  });

  it('still requires cleanup for setInterval, observers and listeners', () => {
    const cases: Array<[string, string]> = [
      ['setInterval', 'const id = setInterval(onTick, 1000);'],
      ['MutationObserver', 'const o = new MutationObserver(onChange);'],
      ['IntersectionObserver', 'const o = new IntersectionObserver(onChange);'],
      ['ResizeObserver', 'const o = new ResizeObserver(onChange);'],
      ['addEventListener', "el.addEventListener('click', onClick);"],
      ['requestAnimationFrame', 'const f = requestAnimationFrame(onFrame);'],
      ['WebSocket', "const ws = new WebSocket('wss://example.test');"],
    ];

    for (const [label, body] of cases) {
      const diagnostics = runRule(
        reactUseEffectCleanupRule,
        `useEffect(() => { ${body} }, []);`
      );
      expect(diagnostics.length, label).toBeGreaterThan(0);
    }
  });

  it('accepts an AbortController signal as the cleanup', () => {
    const diagnostics = runRule(
      reactUseEffectCleanupRule,
      `useEffect(() => {
        const ac = new AbortController();
        el.addEventListener('click', onClick, { signal: ac.signal });
        return () => ac.abort();
      }, []);`
    );

    expect(diagnostics).toHaveLength(0);
  });

  it('accepts a using declaration inside the effect', () => {
    const diagnostics = runRule(
      reactUseEffectCleanupRule,
      `useEffect(() => {
        using handle = acquire();
        el.addEventListener('click', onClick, { signal: handle.signal });
      }, []);`
    );

    expect(diagnostics).toHaveLength(0);
  });
});