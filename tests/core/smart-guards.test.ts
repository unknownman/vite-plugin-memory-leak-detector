import { describe, it, expect } from 'vitest';
import { runRule } from '../utils.js';
import { noUnclearedTimersRule } from '../../src/rules/generic/no-uncleared-timers.js';
import { reactUseEffectCleanupRule } from '../../src/rules/react/react-useeffect-cleanup.js';

/**
 * A clearance guarded by `if (id)` is safe: the body only runs when the
 * resource actually exists, so the timer is provably released.
 */
describe('Smart conditional guards - scope.isSelfGuarded', () => {
  it('treats `if (id)` as an unconditional (self) guard', () => {
    const code = `
      let id = setInterval(tick, 1000);
      if (id) { clearInterval(id); }
    `;
    expect(runRule(noUnclearedTimersRule, code)).toHaveLength(0);
  });

  it('treats `if (id !== null)` as a self guard', () => {
    const code = `
      let id = setInterval(tick, 1000);
      if (id !== null) { clearInterval(id); }
    `;
    expect(runRule(noUnclearedTimersRule, code)).toHaveLength(0);
  });

  it('treats `if (id != undefined)` as a self guard', () => {
    const code = `
      let id = setInterval(tick, 1000);
      if (id != undefined) { clearInterval(id); }
    `;
    expect(runRule(noUnclearedTimersRule, code)).toHaveLength(0);
  });

  it('treats a logical `&&` guard as a self guard', () => {
    const code = `
      let id = setInterval(tick, 1000);
      let ready = true;
      if (id && ready) { clearInterval(id); }
    `;
    expect(runRule(noUnclearedTimersRule, code)).toHaveLength(0);
  });

  it('treats an optional-chain guard as a self guard', () => {
    const code = `
      let id = setInterval(tick, 1000);
      let ready = true;
      if (id?.ready) { clearInterval(id); }
    `;
    expect(runRule(noUnclearedTimersRule, code)).toHaveLength(0);
  });

  it('reports a conditional leak when the guard tests an unrelated name', () => {
    const code = `
      let id = setInterval(tick, 1000);
      let unrelated = true;
      if (unrelated) { clearInterval(id); }
    `;
    const diagnostics = runRule(noUnclearedTimersRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('only cleared conditionally');
  });

  it('reports a conditional leak when the guard is a bare truthy literal', () => {
    const code = `
      let id = setInterval(tick, 1000);
      if (true) { clearInterval(id); }
    `;
    expect(runRule(noUnclearedTimersRule, code)).toHaveLength(1);
  });

  it('accepts an unguarded clearance', () => {
    const code = `
      let id = setInterval(tick, 1000);
      clearInterval(id);
    `;
    expect(runRule(noUnclearedTimersRule, code)).toHaveLength(0);
  });
});

describe('Logging utility cleanup suppression', () => {
  const effectWithCleanupBody = (body: string) => `
    useEffect(() => {
      const id = setInterval(tick, 1000);
      return () => ${body};
    }, []);
  `;

  it.each([
    ['console.log', `console.log('timer stopped', id)`],
    ['console.warn', `console.warn('timer stopped', id)`],
    ['console.error', `console.error('timer stopped', id)`],
    ['console.info', `console.info('timer stopped', id)`],
    ['console.debug', `console.debug('timer stopped', id)`],
  ])('%s inside cleanup does not suppress the leak warning', (_name, body) => {
    const diagnostics = runRule(reactUseEffectCleanupRule, effectWithCleanupBody(body));
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.message.includes('id'))).toBe(true);
  });

  it('reports when there is no cleanup at all', () => {
    const code = `
      useEffect(() => {
        const id = setInterval(tick, 1000);
      }, []);
    `;
    expect(runRule(reactUseEffectCleanupRule, code).length).toBeGreaterThan(0);
  });

  it('does not report a genuinely cleaned-up effect', () => {
    const code = `
      useEffect(() => {
        const id = setInterval(tick, 1000);
        const handler = () => tick();
        window.addEventListener('resize', handler);
        return () => { clearInterval(id); window.removeEventListener('resize', handler); };
      }, []);
    `;
    expect(runRule(reactUseEffectCleanupRule, code)).toHaveLength(0);
  });

  it('still honours a real external teardown as an opaque suppressor', () => {
    const code = effectWithCleanupBody('registry.teardown(id)');
    expect(runRule(reactUseEffectCleanupRule, code)).toHaveLength(0);
  });
});