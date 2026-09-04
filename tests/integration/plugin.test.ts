import { describe, it, expect, vi } from 'vitest';
import { memoryLeakDetectorPlugin } from '../../src/plugin.js';
import * as reporterModule from '../../src/reporter/index.js';

describe('memoryLeakDetectorPlugin UX and reporting', () => {
  it('does not duplicate stylish reporting in buildEnd when rollupReporter was emitted during build', async () => {
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

    // Transform leaky code
    await plugin.transform.call(rollupContext, code, '/test/src/App.ts');

    // Vite should have received the warning natively during transform
    expect(warnSpy).toHaveBeenCalled();

    // Call buildEnd
    await plugin.buildEnd.call(rollupContext);

    // dispatchReports should NOT have received stylish report because rollupReporter already emitted it
    expect(dispatchSpy).toHaveBeenCalled();
    const passedReports = dispatchSpy.mock.calls[0][1];
    expect(passedReports.some((r: any) => r.format === 'stylish')).toBe(false);

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

    // Errors must be downgraded to warnings in transform; context.error is
    // reserved for buildEnd threshold enforcement.
    expect(rollupContext.warn).toHaveBeenCalled();
    expect(rollupContext.error).not.toHaveBeenCalled();

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
    expect(rollupContext.warn).not.toHaveBeenCalled();

    // Real module transform: reported once.
    await plugin.transform.call(rollupContext, code, '/test/src/App.ts');
    expect(rollupContext.warn).toHaveBeenCalledTimes(1);

    await plugin.buildEnd.call(rollupContext);

    // Exactly one physical file's diagnostics reach the summary, not two.
    expect(dispatchSpy).toHaveBeenCalled();
    expect(dispatchSpy.mock.calls[0][0]).toHaveLength(1);

    consoleLogSpy.mockRestore();
    dispatchSpy.mockRestore();
  });
});
