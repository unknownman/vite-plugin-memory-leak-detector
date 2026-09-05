import { describe, it, expect, vi } from 'vitest';
import { memoryLeakDetectorPlugin } from '../../src/plugin.js';
import * as reporterModule from '../../src/reporter/index.js';

describe('memoryLeakDetectorPlugin UX and reporting', () => {
  it('does not emit rollup warnings during transform; stylish is dispatched in buildEnd', async () => {
    const plugin = memoryLeakDetectorPlugin({
      reports: [{ format: 'stylish' }],
    }) as any;

    const warnSpy = vi.fn();
    const rollupContext = {
      warn: warnSpy,
      error: vi.fn(),
    };

    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const dispatchSpy = vi.spyOn(reporterModule, 'dispatchReports');

    // Simulate Vite build
    plugin.configResolved({ command: 'build' });
    plugin.buildStart();

    const code = `
      setInterval(() => {}, 1000);
    `;

    // Transform leaky code. Reporting must NOT happen here: real-time warnings
    // are printed from the dev-server side (handleHotUpdate + summaries), so
    // Vite's transform cache cannot swallow them.
    await plugin.transform.call(rollupContext, code, '/test/src/App.ts');
    expect(warnSpy).not.toHaveBeenCalled();
    expect(rollupContext.error).not.toHaveBeenCalled();

    // Call buildEnd
    await plugin.buildEnd.call(rollupContext);

    // The stylish report is dispatched from buildEnd in this architecture.
    expect(dispatchSpy).toHaveBeenCalled();
    const passedReports = dispatchSpy.mock.calls[0][1];
    expect(passedReports.some((r: any) => r.format === 'stylish')).toBe(true);

    // Numeric summary should still be printed
    const loggedMessages = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(loggedMessages).toContain('Memory Leak Summary');
    expect(loggedMessages).toContain('warnings');

    consoleLogSpy.mockRestore();
    dispatchSpy.mockRestore();
  });

  it('prints clean run message when there are no leaks', async () => {
    const plugin = memoryLeakDetectorPlugin() as any;
    const rollupContext = {
      warn: vi.fn(),
      error: vi.fn(),
    };

    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    plugin.configResolved({ command: 'build' });
    plugin.buildStart();

    await plugin.buildEnd.call(rollupContext);

    const loggedMessages = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(loggedMessages).toContain('Clean run! No memory leaks detected.');

    consoleLogSpy.mockRestore();
  });

  it('never fatally aborts the module during transform even in error mode', async () => {
    const plugin = memoryLeakDetectorPlugin({
      mode: 'error',
      reports: [{ format: 'stylish' }],
    }) as any;
    const rollupContext = {
      warn: vi.fn(),
      error: vi.fn(),
    };
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    plugin.configResolved({ command: 'serve' });
    plugin.buildStart();

    const code = `setInterval(() => {}, 1000);`;
    await plugin.transform.call(rollupContext, code, '/test/src/App.ts');

    // The transform hook must never call context.error() — aborting the module
    // chain would fatal the build. Warnings are also no longer emitted here;
    // they surface via the dev-server reporting path instead.
    expect(rollupContext.error).not.toHaveBeenCalled();
    expect(rollupContext.warn).not.toHaveBeenCalled();

    consoleLogSpy.mockRestore();
  });

  it('keys the diagnostic cache by physical path, skipping virtual module slices', async () => {
    const plugin = memoryLeakDetectorPlugin({
      reports: [{ format: 'stylish' }, { format: 'json' }],
    }) as any;
    const rollupContext = {
      warn: vi.fn(),
      error: vi.fn(),
    };
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const dispatchSpy = vi.spyOn(reporterModule, 'dispatchReports');

    plugin.configResolved({ command: 'build' });
    plugin.buildStart();

    const code = `setInterval(() => {}, 1000);`;

    // Virtual module slice (same physical file): must be ignored entirely.
    await plugin.transform.call(rollupContext, code, '/test/src/App.ts?vue&type=script&lang.ts');

    // Real module transform: analyzed normally.
    await plugin.transform.call(rollupContext, code, '/test/src/App.ts');

    await plugin.buildEnd.call(rollupContext);

    // Exactly one physical file's diagnostics reach the summary, not two.
    expect(dispatchSpy).toHaveBeenCalled();
    expect(dispatchSpy.mock.calls[0][0]).toHaveLength(1);

    consoleLogSpy.mockRestore();
    dispatchSpy.mockRestore();
  });
});