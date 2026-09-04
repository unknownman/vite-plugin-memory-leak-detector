import { describe, it, expect } from 'vitest';
import { runRule } from '../utils.js';
import { noUnclearedTimersRule } from '../../src/rules/generic/no-uncleared-timers.js';
import { noUnclearedAnimationFramesRule } from '../../src/rules/generic/no-uncleared-animation-frames.js';
import { noUnregisteredListenersRule } from '../../src/rules/generic/no-unregistered-listeners.js';
import { noUnconnectedObserversRule } from '../../src/rules/generic/no-unconnected-observers.js';
import { noUnclosedWebsocketsRule } from '../../src/rules/generic/no-unclosed-websockets.js';
import { noMissingAbortControllerRule } from '../../src/rules/generic/no-missing-abort-controller.js';
import { noUnsubscribedEventsRule } from '../../src/rules/generic/no-unsubscribed-events.js';

describe('no-uncleared-timers', () => {
  it('detects unassigned setInterval', () => {
    const diagnostics = runRule(noUnclearedTimersRule, `setInterval(() => {}, 1000);`);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('never assigned to a variable');
  });

  it('detects assigned but uncleared setInterval', () => {
    const diagnostics = runRule(noUnclearedTimersRule, `const timerId = setInterval(() => {}, 1000);`);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('never cleared');
  });

  it('allows properly cleared setInterval', () => {
    const code = `
      const timerId = setInterval(() => {}, 1000);
      clearInterval(timerId);
    `;
    const diagnostics = runRule(noUnclearedTimersRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('skips setTimeout (fire-and-forget)', () => {
    const diagnostics = runRule(noUnclearedTimersRule, `setTimeout(() => {}, 1000);`);
    expect(diagnostics).toHaveLength(0);
  });

  it('allows timers passed to external functions', () => {
    const code = `myTimers.push(setInterval(() => {}, 1000));`;
    const diagnostics = runRule(noUnclearedTimersRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('allows allowlisted timers', () => {
    const code = `const id = customSetInterval(() => {}, 1000);`;
    const diagnostics = runRule(noUnclearedTimersRule, code, {
      allowlist: { functions: ['customSetInterval'] },
    });
    expect(diagnostics).toHaveLength(0);
  });

  it('flags uncleared timer in one function even if another function clears the same variable name', () => {
    const code = `
      function clean() {
        const timerId = setInterval(() => {}, 1000);
        clearInterval(timerId);
      }
      function leaked() {
        const timerId = setInterval(() => {}, 1000);
      }
    `;
    const diagnostics = runRule(noUnclearedTimersRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('timerId');
    expect(diagnostics[0].message).toContain('never cleared');
  });

  it('allows allocation in function cleared by outer scope via variable pass-through', () => {
    const code = `
      let timerId;
      function setup() {
        timerId = setInterval(() => {}, 1000);
      }
      clearInterval(timerId);
    `;
    const diagnostics = runRule(noUnclearedTimersRule, code);
    expect(diagnostics).toHaveLength(0);
  });
});

describe('no-uncleared-animation-frames', () => {
  it('detects unassigned requestAnimationFrame', () => {
    const diagnostics = runRule(noUnclearedAnimationFramesRule, `requestAnimationFrame(() => {});`);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('never assigned to a variable');
  });

  it('detects assigned but uncancelled rAF', () => {
    const diagnostics = runRule(
      noUnclearedAnimationFramesRule,
      `const id = requestAnimationFrame(() => {});`
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('never canceled');
  });

  it('allows properly canceled rAF', () => {
    const code = `
      const id = requestAnimationFrame(() => {});
      cancelAnimationFrame(id);
    `;
    const diagnostics = runRule(noUnclearedAnimationFramesRule, code);
    expect(diagnostics).toHaveLength(0);
  });
});

describe('no-unregistered-listeners', () => {
  it('detects anonymous global listeners', () => {
    const diagnostics = runRule(noUnregisteredListenersRule, `window.addEventListener('scroll', () => {});`);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('Anonymous event listener');
  });

  it('detects named listeners never removed', () => {
    const code = `
      const handler = () => {};
      document.addEventListener('click', handler);
    `;
    const diagnostics = runRule(noUnregisteredListenersRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('never removed');
  });

  it('allows listeners that are properly removed', () => {
    const code = `
      const handler = () => {};
      document.addEventListener('click', handler);
      document.removeEventListener('click', handler);
    `;
    const diagnostics = runRule(noUnregisteredListenersRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('allows non-global anonymous listeners (local element)', () => {
    const diagnostics = runRule(noUnregisteredListenersRule, `el.addEventListener('click', () => {});`);
    expect(diagnostics).toHaveLength(0);
  });

  it('flags listener in one function even if another function removes the same handler name', () => {
    const code = `
      function setup() {
        const handler = () => {};
        document.addEventListener('click', handler);
      }
      function teardown() {
        const handler = () => {};
        document.removeEventListener('click', handler);
      }
    `;
    const diagnostics = runRule(noUnregisteredListenersRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('never removed');
  });
});

describe('no-unconnected-observers', () => {
  it('detects observer without disconnect', () => {
    const code = `const obs = new IntersectionObserver(() => {});`;
    const diagnostics = runRule(noUnconnectedObserversRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('disconnect');
  });

  it('allows observer with disconnect', () => {
    const code = `
      const obs = new IntersectionObserver(() => {});
      obs.disconnect();
    `;
    const diagnostics = runRule(noUnconnectedObserversRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('detects unassigned observer', () => {
    const diagnostics = runRule(noUnconnectedObserversRule, `new ResizeObserver(() => {});`);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('without being assigned');
  });

  it('flags observer in one function even if another disconnects the same variable name', () => {
    const code = `
      function setup() {
        const obs = new IntersectionObserver(() => {});
      }
      function teardown() {
        const obs = new IntersectionObserver(() => {});
        obs.disconnect();
      }
    `;
    const diagnostics = runRule(noUnconnectedObserversRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('disconnect');
  });
});

describe('no-unclosed-websockets', () => {
  it('detects WebSocket without close', () => {
    const code = `const ws = new WebSocket('ws://localhost');`;
    const diagnostics = runRule(noUnclosedWebsocketsRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('.close() is never called');
  });

  it('allows WebSocket with close', () => {
    const code = `
      const ws = new WebSocket('ws://localhost');
      ws.close();
    `;
    const diagnostics = runRule(noUnclosedWebsocketsRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('allows WebSocket pushed to collection', () => {
    const code = `sockets.push(new WebSocket('ws://localhost'));`;
    const diagnostics = runRule(noUnclosedWebsocketsRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('flags WebSocket in one function even if another closes the same variable name', () => {
    const code = `
      function open() {
        const ws = new WebSocket('ws://localhost');
      }
      function close() {
        const ws = new WebSocket('ws://localhost');
        ws.close();
      }
    `;
    const diagnostics = runRule(noUnclosedWebsocketsRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('.close() is never called');
  });
});

describe('no-missing-abort-controller', () => {
  it('detects AbortController without abort', () => {
    const code = `const ctrl = new AbortController();`;
    const diagnostics = runRule(noMissingAbortControllerRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('.abort() is never called');
  });

  it('allows AbortController with abort', () => {
    const code = `
      const ctrl = new AbortController();
      ctrl.abort();
    `;
    const diagnostics = runRule(noMissingAbortControllerRule, code);
    expect(diagnostics).toHaveLength(0);
  });
});

describe('no-unsubscribed-events', () => {
  it('detects subscription without unsubscribe', () => {
    const code = `
      const sub = observable.subscribe(val => {});
    `;
    const diagnostics = runRule(noUnsubscribedEventsRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('never unsubscribed');
  });

  it('allows subscription with unsubscribe', () => {
    const code = `
      const sub = observable.subscribe(val => {});
      sub.unsubscribe();
    `;
    const diagnostics = runRule(noUnsubscribedEventsRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('detects unassigned subscription', () => {
    const code = `observable.subscribe(val => {});`;
    const diagnostics = runRule(noUnsubscribedEventsRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('never assigned to a variable');
  });
});
