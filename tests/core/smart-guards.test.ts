import { describe, it, expect } from 'vitest';
import { runRule } from '../utils.js';
import { noUnclearedTimersRule } from '../../src/rules/generic/no-uncleared-timers.js';
import { noUnsubscribedEventsRule } from '../../src/rules/generic/no-unsubscribed-events.js';
import { noUnclosedWebsocketsRule } from '../../src/rules/generic/no-unclosed-websockets.js';
import { noMissingAbortControllerRule } from '../../src/rules/generic/no-missing-abort-controller.js';
import { noUnconnectedObserversRule } from '../../src/rules/generic/no-unconnected-observers.js';
import { reactUseEffectCleanupRule } from '../../src/rules/react/react-useeffect-cleanup.js';
import { ScopeTracker, attachScopeListeners } from '../../src/rules/utils/scope.js';
import { getAllocationTarget, getExpressionName } from '../../src/rules/utils/tracker.js';
import type { RuleDefinition, RuleVisitor } from '../../src/types/rule.js';

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

  // Changed expectation (Phase 1.3): a `&&` test only counts as a self guard
  // when EVERY conjunct is a guard form of the resource. `if (id && ready)`
  // skips the body for a reason unrelated to `id`, so the timer can outlive it.
  it('treats `if (id && ready)` as conditional, not a self guard', () => {
    const code = `
      let id = setInterval(tick, 1000);
      let ready = true;
      if (id && ready) { clearInterval(id); }
    `;
    const diagnostics = runRule(noUnclearedTimersRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('only cleared conditionally');
  });

  it('accepts `&&` tests where every conjunct guards the same resource', () => {
    const code = `
      let id = setInterval(tick, 1000);
      if (id && id !== null) { clearInterval(id); }
    `;
    expect(runRule(noUnclearedTimersRule, code)).toHaveLength(0);
  });

  it('keeps the expression form `id && clearInterval(id)` unconditional', () => {
    const code = `
      let id = setInterval(tick, 1000);
      id && clearInterval(id);
    `;
    expect(runRule(noUnclearedTimersRule, code)).toHaveLength(0);
  });

  it('reports `ready && id && clearInterval(id)` as conditional', () => {
    const code = `
      let id = setInterval(tick, 1000);
      let ready = true;
      ready && id && clearInterval(id);
    `;
    const diagnostics = runRule(noUnclearedTimersRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('only cleared conditionally');
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

  it('treats `if (this.timer)` as a self guard', () => {
    const code = `
      class Widget {
        timer = setInterval(tick, 1000);
        destroy() {
          if (this.timer) { clearInterval(this.timer); }
        }
      }
    `;
    expect(runRule(noUnclearedTimersRule, code)).toHaveLength(0);
  });

  it('treats `if (this.timer !== null)` as a self guard', () => {
    const code = `
      class Widget {
        timer = setInterval(tick, 1000);
        destroy() {
          if (this.timer !== null) { clearInterval(this.timer); }
        }
      }
    `;
    expect(runRule(noUnclearedTimersRule, code)).toHaveLength(0);
  });
});

describe('Conditional guards - nesting and branch awareness', () => {
  it('reports a nested unrelated guard even when the inner guard is a self guard', () => {
    const code = `
      let id = setInterval(tick, 1000);
      let ready = true;
      if (ready) { if (id) { clearInterval(id); } }
    `;
    const diagnostics = runRule(noUnclearedTimersRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('only cleared conditionally');
  });

  it('reports a clearance in the `else` branch of its own guard', () => {
    const code = `
      let id = setInterval(tick, 1000);
      if (id) { } else { clearInterval(id); }
    `;
    const diagnostics = runRule(noUnclearedTimersRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('only cleared conditionally');
  });

  it('reports a clearance in the consequent of `if (!id)`', () => {
    const code = `
      let id = setInterval(tick, 1000);
      if (!id) { clearInterval(id); }
    `;
    const diagnostics = runRule(noUnclearedTimersRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('only cleared conditionally');
  });

  it('still accepts a clearance in the consequent of a positive guard', () => {
    const code = `
      let id = setInterval(tick, 1000);
      if (id) { clearInterval(id); }
    `;
    expect(runRule(noUnclearedTimersRule, code)).toHaveLength(0);
  });

  it('keeps a `case` label conditional', () => {
    const code = `
      let id = setInterval(tick, 1000);
      switch (mode) { case 1: clearInterval(id); }
    `;
    const diagnostics = runRule(noUnclearedTimersRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('only cleared conditionally');
  });
});

describe('Method-style && clearances', () => {
  it('treats `sub && sub.unsubscribe()` as an unconditional clearance', () => {
    const code = `
      const sub = emitter.subscribe(v => {});
      sub && sub.unsubscribe();
    `;
    expect(runRule(noUnsubscribedEventsRule, code)).toHaveLength(0);
  });

  it('treats `ws && ws.close()` as an unconditional clearance', () => {
    const code = `
      const ws = new WebSocket(url);
      ws && ws.close();
    `;
    expect(runRule(noUnclosedWebsocketsRule, code)).toHaveLength(0);
  });

  it('treats `ctrl && ctrl.abort()` as an unconditional clearance', () => {
    const code = `
      const ctrl = new AbortController();
      ctrl && ctrl.abort();
    `;
    expect(runRule(noMissingAbortControllerRule, code)).toHaveLength(0);
  });

  it('treats `obs && obs.disconnect()` as an unconditional clearance', () => {
    const code = `
      const obs = new IntersectionObserver(cb);
      obs && obs.disconnect();
    `;
    expect(runRule(noUnconnectedObserversRule, code)).toHaveLength(0);
  });

  it('treats `this.sub && this.sub.unsubscribe()` as an unconditional clearance', () => {
    const code = `
      class Widget {
        sub = emitter.subscribe(v => {});
        dispose() {
          this.sub && this.sub.unsubscribe();
        }
      }
    `;
    expect(runRule(noUnsubscribedEventsRule, code)).toHaveLength(0);
  });

  it('handles optional calls: `sub && sub?.unsubscribe()`', () => {
    const code = `
      const sub = emitter.subscribe(v => {});
      sub && sub?.unsubscribe();
    `;
    expect(runRule(noUnsubscribedEventsRule, code)).toHaveLength(0);
  });

  it('handles optional calls: `ws && ws.close?.()`', () => {
    const code = `
      const ws = new WebSocket(url);
      ws && ws.close?.();
    `;
    expect(runRule(noUnclosedWebsocketsRule, code)).toHaveLength(0);
  });

  it('reports `ready && sub && sub.unsubscribe()` as conditional', () => {
    const code = `
      const sub = emitter.subscribe(v => {});
      let ready = true;
      ready && sub && sub.unsubscribe();
    `;
    const diagnostics = runRule(noUnsubscribedEventsRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('never unsubscribed');
  });

  it('reports `other && sub.unsubscribe()` as conditional', () => {
    const code = `
      const sub = emitter.subscribe(v => {});
      let other = true;
      other && sub.unsubscribe();
    `;
    const diagnostics = runRule(noUnsubscribedEventsRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('never unsubscribed');
  });

  it('does not treat a clearance inside a nested function as gating the guard', () => {
    // The arrow only *creates* a function; nothing is unsubscribed while the
    // guard evaluates, so this must not count as a self-guard clearance.
    const code = `
      const sub = emitter.subscribe(v => {});
      sub && (() => sub.unsubscribe());
    `;
    const diagnostics = runRule(noUnsubscribedEventsRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('never unsubscribed');
  });
});

describe('Branch tracking - ternaries and non-block branches', () => {
  it('reports `id ? noop() : clearInterval(id)` as conditional', () => {
    const code = `
      let id = setInterval(tick, 1000);
      id ? noop() : clearInterval(id);
    `;
    const diagnostics = runRule(noUnclearedTimersRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('only cleared conditionally');
  });

  it('accepts `id ? clearInterval(id) : noop()`', () => {
    const code = `
      let id = setInterval(tick, 1000);
      id ? clearInterval(id) : noop();
    `;
    expect(runRule(noUnclearedTimersRule, code)).toHaveLength(0);
  });

  it('reports a clearance in an `else if` chain as conditional', () => {
    const code = `
      let id = setInterval(tick, 1000);
      if (id) {} else if (x) { clearInterval(id); }
    `;
    const diagnostics = runRule(noUnclearedTimersRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('only cleared conditionally');
  });

  it('reports a clearance in a nested `else` block under its own guard', () => {
    const code = `
      let id = setInterval(tick, 1000);
      if (id) {} else { if (id) { clearInterval(id); } }
    `;
    const diagnostics = runRule(noUnclearedTimersRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('only cleared conditionally');
  });

  it('accepts a non-block consequent branch (`if (id) clearInterval(id); else ...`)', () => {
    const code = `
      let id = setInterval(tick, 1000);
      if (id) clearInterval(id); else other();
    `;
    expect(runRule(noUnclearedTimersRule, code)).toHaveLength(0);
  });

  it('accepts a non-block alternate when the guard is unrelated', () => {
    const code = `
      let id = setInterval(tick, 1000);
      let ready = true;
      if (ready) other(); else clearInterval(id);
    `;
    const diagnostics = runRule(noUnclearedTimersRule, code);
    expect(diagnostics).toHaveLength(1);
  });

  it('keeps branch tracking when the rule defines its own ReturnStatement handler', () => {
    const rule: RuleDefinition = {
      id: 'test/branch-with-return-handler',
      description: 'timers plus a rule-owned ReturnStatement visitor',
      category: 'generic',
      defaultSeverity: 'warn',
      triggers: ['setInterval'],
      create(context) {
        const tracker = new ScopeTracker();
        const visitor: RuleVisitor = {};
        attachScopeListeners(tracker, visitor);

        visitor.CallExpression = (node: any, parent: any) => {
          const callee = node.callee;
          if (!callee || callee.type !== 'Identifier') return;
          if (callee.name === 'setInterval') {
            const target = getAllocationTarget(parent);
            if (target.name) tracker.addAllocation(target.name);
          } else if (callee.name === 'clearInterval') {
            const name = getExpressionName(node.arguments?.[0]);
            if (name) tracker.addClearance(name);
          }
        };

        // The rule's own handler for a node type attachScopeListeners used to
        // wrap. Assigning it must not break branch tracking.
        visitor.ReturnStatement = () => {};

        visitor['Program:exit'] = () => {
          for (const alloc of tracker.getAllocations()) {
            if (!alloc.name || tracker.isCleared(alloc.name, alloc.scopeId)) continue;
            const conditional = tracker.isOnlyConditionallyCleared(alloc.name, alloc.scopeId);
            context.report({
              ruleId: 'test/branch-with-return-handler',
              message: conditional
                ? `Resource '${alloc.name}' is only cleared conditionally.`
                : `Resource '${alloc.name}' is not cleared.`,
              line: 1,
              column: 0,
            });
          }
        };
        return visitor;
      },
    };

    // The clearance sits directly in the `else` branch as a ReturnStatement.
    const code = `
      function f() {
        const id = setInterval(tick, 1000);
        if (id) { tick(); } else return clearInterval(id);
      }
    `;
    const diagnostics = runRule(rule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('conditional');
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