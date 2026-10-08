import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import { memoryLeakDetectorPlugin } from '../../src/plugin.js';
import { LeakDetectorEngine } from '../../src/core/engine.js';
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
describe('memoryLeakDetectorPlugin Vite integration (phase 3)', () => {
  let tmp: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmp = mkdtempSync(joinPath(tmpdir(), 'mld-p3-'));
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    vi.restoreAllMocks();
    vi.useRealTimers();
    rmSync(tmp, { recursive: true, force: true });
  });

  const write = (name: string, code: string) => {
    const file = joinPath(tmp, name);
    writeFileSync(file, code, 'utf8');
    return file;
  };

  it('analyzes a given file content only once even when several hooks see it', async () => {
    const plugin = memoryLeakDetectorPlugin() as any;
    plugin.configResolved({ command: 'serve' });
    plugin.buildStart();

    const file = write('once.ts', 'setInterval(() => {}, 1000);');
    const code = readFileSync(file, 'utf8');
    const analyzeSpy = vi.spyOn(LeakDetectorEngine.prototype, 'analyze');

    const ctx = { warn: vi.fn(), error: vi.fn() };
    await plugin.transform.call(ctx, code, file);
    await plugin.transform.call(ctx, code, file);
    await plugin.handleHotUpdate.call(ctx, { file, modules: [] });
    await plugin.hotUpdate.call(ctx, { file, modules: [{ file }] });

    expect(analyzeSpy).toHaveBeenCalledTimes(1);
  });

  it('prints the per-file report once when both HMR hooks fire for one edit', async () => {
    const plugin = memoryLeakDetectorPlugin() as any;
    plugin.configResolved({ command: 'serve' });
    plugin.buildStart();

    const file = write('hmr.ts', 'setInterval(() => {}, 1000);');
    const ctx = { warn: vi.fn(), error: vi.fn() };

    await plugin.handleHotUpdate.call(ctx, { file, modules: [] });
    await plugin.hotUpdate.call(ctx, { file, modules: [{ file }] });

    const reports = logSpy.mock.calls.map((c) => c.join(' ')).filter((m) => m.includes('hmr.ts'));
    expect(reports).toHaveLength(1);
  });

  it('deduplicates identical findings reported by two environments', async () => {
    const plugin = memoryLeakDetectorPlugin() as any;
    plugin.configResolved({ command: 'build' });
    plugin.buildStart();

    const file = write('env.ts', 'setInterval(() => {}, 1000);');
    const code = readFileSync(file, 'utf8');
    const ctx = { warn: vi.fn(), error: vi.fn() };
    const dispatchSpy = vi.spyOn(reporterModule, 'dispatchReports');

    // Vite 6+ transforms a module once per environment.
    await plugin.transform.call({ ...ctx, environment: { name: 'client' } }, code, file);
    await plugin.transform.call({ ...ctx, environment: { name: 'ssr' } }, code, file);

    expect(dispatchSpy).not.toHaveBeenCalled();
    await plugin.buildEnd.call(ctx);

    const reported = dispatchSpy.mock.calls[0][0] as any[];
    const keys = reported.map((d) => `${d.file}|${d.ruleId}|${d.line}|${d.column}|${d.message}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps distinct findings from one environment', async () => {
    const plugin = memoryLeakDetectorPlugin() as any;
    plugin.configResolved({ command: 'build' });
    plugin.buildStart();

    const file = write('multi.ts', 'const id = setInterval(tick, 1000);\nconst s = setInterval(tick, 500);');
    const code = readFileSync(file, 'utf8');
    const ctx = { warn: vi.fn(), error: vi.fn() };
    const dispatchSpy = vi.spyOn(reporterModule, 'dispatchReports');

    await plugin.transform.call({ ...ctx, environment: { name: 'client' } }, code, file);
    await plugin.buildEnd.call(ctx);

    expect((dispatchSpy.mock.calls[0][0] as any[]).length).toBeGreaterThanOrEqual(2);
  });

  it('clears stale diagnostics between watch rebuilds in build mode', async () => {
    const plugin = memoryLeakDetectorPlugin() as any;
    plugin.configResolved({ command: 'build' });
    plugin.buildStart();

    const file = write('watch.ts', 'setInterval(() => {}, 1000);');
    const code = readFileSync(file, 'utf8');
    const ctx = { warn: vi.fn(), error: vi.fn() };
    const dispatchSpy = vi.spyOn(reporterModule, 'dispatchReports');

    await plugin.transform.call(ctx, code, file);
    await plugin.buildEnd.call(ctx);
    expect((dispatchSpy.mock.calls[0][0] as any[]).length).toBe(1);

    // Second rebuild after the leak was fixed.
    plugin.buildStart();
    const fixed = 'export const noop = 1;';
    writeFileSync(file, fixed, 'utf8');
    await plugin.transform.call(ctx, fixed, file);
    await plugin.buildEnd.call(ctx);

    expect((dispatchSpy.mock.calls[1][0] as any[]).length).toBe(0);
  });

  it('keeps the dev cache across buildStart so summaries stay current', async () => {
    const plugin = memoryLeakDetectorPlugin() as any;
    plugin.configResolved({ command: 'serve' });
    plugin.buildStart();

    const file = write('dev.ts', 'setInterval(() => {}, 1000);');
    const ctx = { warn: vi.fn(), error: vi.fn() };
    const analyzeSpy = vi.spyOn(LeakDetectorEngine.prototype, 'analyze');

    await plugin.handleHotUpdate.call(ctx, { file, modules: [] });
    const afterFirst = analyzeSpy.mock.calls.length;

    plugin.buildStart();
    await plugin.handleHotUpdate.call(ctx, { file, modules: [] });

    // Content unchanged: served from the (surviving) analysis cache.
    expect(analyzeSpy.mock.calls.length).toBe(afterFirst);
  });

  it('reprints the debounced summary when a leak is replaced by a different one of the same count', async () => {
    vi.useFakeTimers();
    const plugin = memoryLeakDetectorPlugin() as any;
    plugin.configResolved({ command: 'serve' });
    plugin.buildStart();

    const file = write('swap.ts', 'const id = setInterval(tick, 1000);');
    const ctx = { warn: vi.fn(), error: vi.fn() };
    const summaryPrints = () =>
      logSpy.mock.calls.map((c) => c.join(' ')).filter((m) => m.includes('swap.ts'));

    await plugin.transform.call(ctx, readFileSync(file, 'utf8'), file);
    await vi.advanceTimersByTimeAsync(2000);
    expect(summaryPrints()).toHaveLength(1);

    // Same file, same diagnostic count, different leak -> different fingerprint.
    writeFileSync(file, 'const id = setInterval(tick, 2000);', 'utf8');
    await plugin.transform.call(ctx, readFileSync(file, 'utf8'), file);
    await vi.advanceTimersByTimeAsync(2000);
    expect(summaryPrints()).toHaveLength(2);

    // Re-analyzing identical content must not reprint.
    await plugin.transform.call(ctx, readFileSync(file, 'utf8'), file);
    await vi.advanceTimersByTimeAsync(2000);
    expect(summaryPrints()).toHaveLength(2);
  });

  it('does not reprint the summary when nothing changed', async () => {
    vi.useFakeTimers();
    const plugin = memoryLeakDetectorPlugin() as any;
    plugin.configResolved({ command: 'serve' });
    plugin.buildStart();

    const file = write('stable.ts', 'const id = setInterval(tick, 1000);');
    const ctx = { warn: vi.fn(), error: vi.fn() };
    const summaryPrints = () =>
      logSpy.mock.calls.map((c) => c.join(' ')).filter((m) => m.includes('stable.ts'));

    await plugin.transform.call(ctx, readFileSync(file, 'utf8'), file);
    await vi.advanceTimersByTimeAsync(2000);
    expect(summaryPrints()).toHaveLength(1);

    await plugin.transform.call(ctx, readFileSync(file, 'utf8'), file);
    await vi.advanceTimersByTimeAsync(2000);
    expect(summaryPrints()).toHaveLength(1);
  });

  it('treats a missing environment as the client environment', async () => {
    const plugin = memoryLeakDetectorPlugin() as any;
    plugin.configResolved({ command: 'serve' });
    plugin.buildStart();

    const file = write('canon.ts', 'setInterval(() => {}, 1000);');
    const ctx = { warn: vi.fn(), error: vi.fn() };

    // Vite 6 environment hook fires with an explicit environment, then the
    // legacy hook fires with a context that carries none. Both must address
    // the same bucket or the second pass reprints the identical report.
    await plugin.hotUpdate.call({ ...ctx, environment: { name: 'client' } }, { file, modules: [{ file }] });
    await plugin.handleHotUpdate.call(ctx, { file, modules: [] });

    const reports = logSpy.mock.calls.map((c) => c.join(' ')).filter((m) => m.includes('canon.ts'));
    expect(reports).toHaveLength(1);
  });

  it('deduplicates the dev summary across environments that saw the same file', async () => {
    vi.useFakeTimers();
    const plugin = memoryLeakDetectorPlugin() as any;
    plugin.configResolved({ command: 'serve' });
    plugin.buildStart();

    const file = write('envsum.ts', 'setInterval(() => {}, 1000);');
    const code = readFileSync(file, 'utf8');
    const ctx = { warn: vi.fn(), error: vi.fn() };

    await plugin.transform.call({ ...ctx, environment: { name: 'client' } }, code, file);
    await plugin.transform.call({ ...ctx, environment: { name: 'ssr' } }, code, file);
    await vi.advanceTimersByTimeAsync(2000);

    const leakLines = logSpy.mock.calls
      .map((c) => c.join(' '))
      .filter((m) => m.includes("never assigned to a variable"));
    expect(leakLines).toHaveLength(1);
  });

  it('does not collapse distinct diagnostics that lack fingerprints', async () => {
    const plugin = memoryLeakDetectorPlugin() as any;
    plugin.configResolved({ command: 'build' });
    plugin.buildStart();

    vi.spyOn(LeakDetectorEngine.prototype, 'analyze').mockImplementation(
      ((file: string) => [
        {
          ruleId: 'test/no-fp',
          message: `leak in ${file}`,
          line: 1,
          column: 1,
          severity: 'warn',
          file,
          snippet: 'x',
          // deliberately no fingerprint
        },
      ]) as any
    );

    const ctx = { warn: vi.fn(), error: vi.fn() };
    const dispatchSpy = vi.spyOn(reporterModule, 'dispatchReports');
    await plugin.transform.call(ctx, 'const a = 1;', write('a.ts', 'const a = 1;'));
    await plugin.transform.call(ctx, 'const b = 2;', write('b.ts', 'const b = 2;'));
    await plugin.buildEnd.call(ctx);

    expect(dispatchSpy.mock.calls[0][0]).toHaveLength(2);
    dispatchSpy.mockRestore();
  });

  it('uses the Vite logger instead of the console once the config is resolved', async () => {
    const info = vi.fn();
    const plugin = memoryLeakDetectorPlugin() as any;
    plugin.configResolved({ command: 'build', logger: { info, warn: vi.fn(), error: vi.fn() } });
    plugin.buildStart();

    const ctx = { warn: vi.fn(), error: vi.fn() };
    await plugin.transform.call(ctx, 'setInterval(() => {}, 1000);', write('log.ts', 'setInterval(() => {}, 1000);'));
    await plugin.buildEnd.call(ctx);

    expect(info).toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });
});
