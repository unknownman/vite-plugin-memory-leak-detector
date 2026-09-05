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

  it('allows setInterval inside ternary when assigned and cleared', () => {
    const code = `
      const id = ready ? setInterval() : null;
      clearInterval(id);
    `;
    const diagnostics = runRule(noUnclearedTimersRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('detects unassigned setInterval inside a ternary', () => {
    const code = `ready ? setInterval() : null;`;
    const diagnostics = runRule(noUnclearedTimersRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('never assigned to a variable');
  });

  it('detects uncleared setInterval inside a ternary', () => {
    const code = `const id = ready ? setInterval() : null;`;
    const diagnostics = runRule(noUnclearedTimersRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("Timer 'id' (setInterval) is allocated but never cleared");
  });

  it('allows setInterval wrapped in logical expression and type casting when cleared', () => {
    const code = `
      const id = (ready && setInterval()) as number;
      clearInterval(id);
    `;
    const diagnostics = runRule(noUnclearedTimersRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('skips setTimeout (fire-and-forget)', () => {
    const diagnostics = runRule(noUnclearedTimersRule, `setTimeout(() => {}, 1000);`);
    expect(diagnostics).toHaveLength(0);
  });

  it('allows timers pushed into collections', () => {
    const code = `myTimers.push(setInterval(() => {}, 1000));`;
    const diagnostics = runRule(noUnclearedTimersRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('flags timers passed to console.log', () => {
    const diagnostics = runRule(noUnclearedTimersRule, `console.log(setInterval(() => {}, 1000));`);
    expect(diagnostics).toHaveLength(1);
  });

  it('flags timers passed to non-allowlisted wrapper functions', () => {
    const diagnostics = runRule(noUnclearedTimersRule, `mySafeWrapper(setInterval(() => {}, 1000));`);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('never assigned to a variable');
  });

  it('flags timers passed to non-allowlisted member calls', () => {
    const diagnostics = runRule(
      noUnclearedTimersRule,
      `manager.track(setInterval(() => {}, 1000));`
    );
    expect(diagnostics).toHaveLength(1);
  });

  it('allows timers passed to allowlisted wrapper functions', () => {
    const code = `register(setInterval(() => {}, 1000));`;
    const diagnostics = runRule(noUnclearedTimersRule, code, {
      allowlist: { functions: ['register'] },
    });
    expect(diagnostics).toHaveLength(0);
  });

  it('flags timers stored as object literal properties', () => {
    const diagnostics = runRule(
      noUnclearedTimersRule,
      `const cfg = { timer: setInterval(() => {}, 1000) };`
    );
    expect(diagnostics).toHaveLength(1);
  });

  it('allows allowlisted timers', () => {
    const code = `const id = customSetInterval(() => {}, 1000);`;
    const diagnostics = runRule(noUnclearedTimersRule, code, {
      allowlist: { functions: ['customSetInterval'] },
    });
    expect(diagnostics).toHaveLength(0);
  });

  it('allows allocation in one function and clearance in a sibling function', () => {
    const code = `
      let timerId;
      function start() {
        timerId = setInterval(() => {}, 1000);
      }
      function stop() {
        clearInterval(timerId);
      }
    `;
    const diagnostics = runRule(noUnclearedTimersRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('allows allocation in onMounted and clearance in onUnmounted (sibling scopes)', () => {
    const code = `
      let timer;
      onMounted(() => {
        timer = setInterval(tick, 1000);
      });
      onUnmounted(() => {
        clearInterval(timer);
      });
    `;
    const diagnostics = runRule(noUnclearedTimersRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('detects uncleared timer across functions when no sibling clears it', () => {
    const code = `
      let timerId;
      function start() {
        timerId = setInterval(() => {}, 1000);
      }
      function other() {
        console.log(timerId);
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

  it('flags a timer whose local id is never cleared even when a sibling function clears its own id', () => {
    const code = `
      function start() {
        const id = setInterval(() => {}, 1000);
      }
      function stop() {
        const id = setInterval(() => {}, 500);
        clearInterval(id);
      }
    `;
    const diagnostics = runRule(noUnclearedTimersRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("Timer 'id'");
  });

  it('flags a timer whose local id is not cleared by a sibling function clearing the same name', () => {
    const code = `
      function start() {
        const id = setInterval(() => {}, 1000);
      }
      function stop() {
        clearInterval(id);
      }
    `;
    const diagnostics = runRule(noUnclearedTimersRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("Timer 'id'");
  });

  it('does not treat onUnmounted clearance as valid for a resource declared inside onMounted', () => {
    const code = `
      onMounted(() => {
        const timer = setInterval(tick, 1000);
      });
      onUnmounted(() => {
        clearInterval(timer);
      });
    `;
    const diagnostics = runRule(noUnclearedTimersRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("Timer 'timer'");
  });

  it('allows var-declared timer in a block to be cleared in the enclosing function', () => {
    const code = `
      function setup() {
        if (ready) {
          var id = setInterval(tick, 1000);
        }
        clearInterval(id);
      }
    `;
    const diagnostics = runRule(noUnclearedTimersRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('allows timers destructured from an object literal when cleared', () => {
    const code = `
      const { id } = { id: setInterval(() => {}, 1000) };
      clearInterval(id);
    `;
    const diagnostics = runRule(noUnclearedTimersRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('allows timers destructured from array literal when cleared', () => {
    const code = `
      const [id] = [setInterval(() => {}, 1000)];
      clearInterval(id);
    `;
    const diagnostics = runRule(noUnclearedTimersRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('detects destructured timer that is never cleared', () => {
    const code = `
      const { id } = { id: setInterval(() => {}, 1000) };
      console.log(id);
    `;
    const diagnostics = runRule(noUnclearedTimersRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("Timer 'id'");
  });

  it('allows timer allocated and cleared inside a for loop block scope', () => {
    const code = `
      function setup() {
        for (let i = 0; i < 3; i++) {
          const id = setInterval(tick, 1000);
          clearInterval(id);
        }
      }
    `;
    const diagnostics = runRule(noUnclearedTimersRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('flags timer cleared outside the switch case that declares it', () => {
    const code = `
      function setup(value) {
        switch (value) {
          case 1:
            const id = setInterval(tick, 1000);
            break;
        }
        clearInterval(id);
      }
    `;
    const diagnostics = runRule(noUnclearedTimersRule, code);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("Timer 'id'");
  });

  it('allows timer cleared inside the same catch scope that declares it', () => {
    const code = `
      try {
        run();
      } catch (err) {
        const id = setInterval(tick, 1000);
        clearInterval(id);
      }
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

  it('allows add and remove with optional-chained handlers', () => {
    const code = `
      window.addEventListener('resize', handlers?.resize);
      window.removeEventListener('resize', handlers?.resize);
    `;
    const diagnostics = runRule(noUnregisteredListenersRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('allows listeners registered with an AbortSignal', () => {
    const code = `
      const handler = () => {};
      window.addEventListener('resize', handler, { signal: ctrl.signal });
    `;
    const diagnostics = runRule(noUnregisteredListenersRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('flags anonymous listener on global target with AbortSignal options absent', () => {
    const diagnostics = runRule(noUnregisteredListenersRule, `window.addEventListener('scroll', () => {});`);
    expect(diagnostics).toHaveLength(1);
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

  it('allows observer in one function and disconnect in a sibling function', () => {
    const code = `
      let obs;
      function setup() {
        obs = new IntersectionObserver(() => {});
      }
      function teardown() {
        obs.disconnect();
      }
    `;
    const diagnostics = runRule(noUnconnectedObserversRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('detects uncleared observer when no function disconnects it', () => {
    const code = `
      let obs;
      function setup() {
        obs = new IntersectionObserver(() => {});
      }
      function other() {
        console.log(obs);
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

  it('allows WebSocket in one function and close in a sibling function', () => {
    const code = `
      let ws;
      function open() {
        ws = new WebSocket('ws://localhost');
      }
      function close() {
        ws.close();
      }
    `;
    const diagnostics = runRule(noUnclosedWebsocketsRule, code);
    expect(diagnostics).toHaveLength(0);
  });

  it('detects uncleared WebSocket when no function closes it', () => {
    const code = `
      let ws;
      function open() {
        ws = new WebSocket('ws://localhost');
      }
      function other() {
        console.log(ws);
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
