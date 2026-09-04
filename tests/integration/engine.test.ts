import { describe, it, expect } from 'vitest';
import { LeakDetectorEngine } from '../../src/core/engine.js';
import { resolvePluginConfig } from '../../src/config/index.js';
import { builtinRules } from '../../src/rules/index.js';

describe('LeakDetectorEngine (Integration)', () => {
  it('runs full pipeline and detects leaks', () => {
    const config = resolvePluginConfig({
      mode: 'warn',
      customRules: builtinRules,
    });
    const engine = new LeakDetectorEngine(config);

    const code = `
const handler = () => {};
document.addEventListener('click', handler);
`;
    const diagnostics = engine.analyze('test.ts', code);
    expect(diagnostics.length).toBeGreaterThan(0);
    const ruleIds = diagnostics.map((d) => d.ruleId);
    expect(ruleIds).toContain('generic/no-unregistered-listeners');
  });

  it('respects comment directives', () => {
    const config = resolvePluginConfig({
      mode: 'warn',
      customRules: builtinRules,
    });
    const engine = new LeakDetectorEngine(config);

    const code = `
// memory-leak-ignore-next-line generic/no-unregistered-listeners
document.addEventListener('click', () => {});
const b = 2;
`;
    const diagnostics = engine.analyze('test.ts', code);
    const listenerDiags = diagnostics.filter((d) => d.ruleId === 'generic/no-unregistered-listeners');
    expect(listenerDiags).toHaveLength(0);
  });

  it('respects global ignores', () => {
    const config = resolvePluginConfig({
      mode: 'warn',
      customRules: builtinRules,
      ignores: ['**/*.test.ts'],
    });
    const engine = new LeakDetectorEngine(config);

    const code = `setInterval(() => {}, 1000);`;
    const diagnostics = engine.analyze('src/button.test.ts', code);
    expect(diagnostics).toHaveLength(0);
  });

  it('respects rule-specific ignores', () => {
    const config = resolvePluginConfig({
      mode: 'warn',
      customRules: builtinRules,
      ignores: [{ glob: 'legacy/**', rules: ['generic/no-unregistered-listeners'] }],
    });
    const engine = new LeakDetectorEngine(config);

    const code = `
const handler = () => {};
document.addEventListener('click', handler);
`;
    const diagnostics = engine.analyze('legacy/old.js', code);
    const listenerDiags = diagnostics.filter((d) => d.ruleId === 'generic/no-unregistered-listeners');
    expect(listenerDiags).toHaveLength(0);
  });

  it('generates fingerprints for diagnostics', () => {
    const config = resolvePluginConfig({
      mode: 'warn',
      customRules: builtinRules,
    });
    const engine = new LeakDetectorEngine(config);

    const code = `setInterval(() => {}, 1000);`;
    const diagnostics = engine.analyze('test.ts', code);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].fingerprint).toBeDefined();
    expect(diagnostics[0].fingerprint).toHaveLength(16);
  });

  it('handles empty files gracefully', () => {
    const config = resolvePluginConfig({ mode: 'warn', customRules: builtinRules });
    const engine = new LeakDetectorEngine(config);
    const diagnostics = engine.analyze('test.ts', '');
    expect(diagnostics).toHaveLength(0);
  });

  it('handles parse errors gracefully', () => {
    const config = resolvePluginConfig({ mode: 'warn', customRules: builtinRules });
    const engine = new LeakDetectorEngine(config);
    const diagnostics = engine.analyze('test.ts', 'const = ;');
    expect(diagnostics).toHaveLength(0);
  });
});
