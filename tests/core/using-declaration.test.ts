import { describe, it, expect } from 'vitest';
import { runRule } from '../utils.js';
import { noMissingAbortControllerRule } from '../../src/rules/generic/no-missing-abort-controller.js';
import { noUnclearedTimersRule } from '../../src/rules/generic/no-uncleared-timers.js';

describe('using declaration - explicit resource management', () => {
  it('does not flag AbortController created with using keyword', () => {
    const code = `
      using ctrl = new AbortController();
    `;
    const diagnostics = runRule(noMissingAbortControllerRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('does not flag setInterval created with using keyword', () => {
    const code = `
      using timer = setInterval(tick, 1000);
    `;
    const diagnostics = runRule(noUnclearedTimersRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('still flags const setInterval as a leak when uncleared', () => {
    const code = `
      const id = setInterval(tick, 1000);
    `;
    const diagnostics = runRule(noUnclearedTimersRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].ruleId).toBe('generic/no-uncleared-timers');
  });

  it('does not flag new WebSocket created with using keyword', () => {
    const code = `
      using ws = new WebSocket('/url');
    `;
    const diagnostics = runRule(noMissingAbortControllerRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('nested block scope using is safe inside and below its declaration block', () => {
    const code = `
      using ctrl = new AbortController();
      if (true) {
        // ctrl is still in scope and implicitly handled
      }
      // ctrl is cleaned up at block exit
    `;
    const abortDiagnostics = runRule(noMissingAbortControllerRule, code);
    expect(abortDiagnostics).toHaveLength(0);
  });

  it('using inside a block is safe within that block', () => {
    const code = `
      if (true) {
        using ctrl = new AbortController();
      }
    `;
    const abortDiagnostics = runRule(noMissingAbortControllerRule, code);
    expect(abortDiagnostics).toHaveLength(0);
  });

  it('using timer inside a block does not trigger no-uncleared-timers', () => {
    const code = `
      if (true) {
        using timer = setInterval(tick, 1000);
      }
    `;
    const timerDiagnostics = runRule(noUnclearedTimersRule, code);
    expect(timerDiagnostics).toHaveLength(0);
  });
});