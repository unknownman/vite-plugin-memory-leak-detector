import { describe, it, expect } from 'vitest';
import { runRule } from '../utils.js';
import { noUnclearedTimersRule } from '../../src/rules/generic/no-uncleared-timers.js';

describe('class boundary isolation for this.* resources', () => {
  it('reports a leak when a sibling class clears another class\'s this.timer', () => {
    const code = `
      class WidgetA {
        timer = setInterval(tick, 1000);
      }

      class WidgetB {
        destroy() {
          clearInterval(this.timer);
        }
      }
    `;

    const diagnostics = runRule(noUnclearedTimersRule, code);

    // WidgetA's this.timer is never cleared; WidgetB's clearInterval cannot
    // reach across the class boundary.
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('this.timer');
  });

  it('does not leak when the class clears its own this.timer in destroy()', () => {
    const code = `
      class Widget {
        timer = setInterval(tick, 1000);
        destroy() {
          clearInterval(this.timer);
        }
      }
    `;

    expect(runRule(noUnclearedTimersRule, code)).toHaveLength(0);
  });

  it('does not leak when a teardown method on the same class clears this.timer', () => {
    const code = `
      class Widget {
        start() {
          this.timer = setInterval(tick, 1000);
        }
        onDestroy() {
          clearInterval(this.timer);
        }
      }
    `;

    expect(runRule(noUnclearedTimersRule, code)).toHaveLength(0);
  });

  it('reports leaks for sibling classes that each allocate but only one clears', () => {
    const code = `
      class Alpha {
        timer = setInterval(tick, 1000);
        destroy() {
          clearInterval(this.timer);
        }
      }

      class Beta {
        timer = setInterval(tick, 1000);
      }
    `;

    const diagnostics = runRule(noUnclearedTimersRule, code);

    // Beta's timer (declared on line 10) leaks; Alpha's is cleared within its
    // own class and must not be reported.
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('this.timer');
    expect(diagnostics[0].line).toBe(10);
  });

  it('resolves nested classes to their own boundaries', () => {
    const code = `
      function factory() {
        class Outer {
          timer = setInterval(tick, 1000);
          destroy() {
            clearInterval(this.timer);
          }
        }

        class Inner {
          timer = setInterval(tick, 1000);
        }

        return { Outer, Inner };
      }
    `;

    const diagnostics = runRule(noUnclearedTimersRule, code);

    // Inner's this.timer must not be satisfied by Outer's clearInterval.
    expect(diagnostics).toHaveLength(1);
  });

  it('keeps sibling classes inside one outer class isolated from each other', () => {
    const code = `
      class Container {
        inner = class Inner {
          timer = setInterval(tick, 1000);
          destroy() {
            clearInterval(this.timer);
          }
        };
      }

      class Other {
        timer = setInterval(tick, 1000);
        destroy() {
          clearInterval(this.timer);
        }
      }
    `;

    expect(runRule(noUnclearedTimersRule, code)).toHaveLength(0);
  });

  it('treats computed this[...] access as class instance state', () => {
    const code = `
      class Widget {
        start() {
          this['timer'] = setInterval(tick, 1000);
        }
      }

      class Other {
        destroy() {
          clearInterval(this['timer']);
        }
      }
    `;

    const diagnostics = runRule(noUnclearedTimersRule, code);

    expect(diagnostics).toHaveLength(1);
  });

  it('does not let a nested class clearance satisfy the enclosing class allocation', () => {
    const code = `
      class Outer {
        timer = setInterval(tick, 1000);

        method() {
          class Helper {
            destroy() {
              clearInterval(this.timer);
            }
          }
          return Helper;
        }
      }
    `;

    // The nested Helper is a different instance, so Outer.timer still leaks.
    expect(runRule(noUnclearedTimersRule, code)).toHaveLength(1);
  });

  it('keeps non-class member expressions on the legacy subtree behavior', () => {
    const code = `
      function setup() {
        const store = { current: null };
        store.current = setInterval(tick, 1000);
        return () => clearInterval(store.current);
      }
    `;

    expect(runRule(noUnclearedTimersRule, code)).toHaveLength(0);
  });
});