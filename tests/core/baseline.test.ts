import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  generateFingerprint,
  generateLegacyFingerprint,
  normalizeSnippet,
  BaselineManager,
} from '../../src/core/baseline.js';
import { LeakDetectorEngine } from '../../src/core/engine.js';
import { resolvePluginConfig } from '../../src/config/index.js';
import { builtinRules } from '../../src/rules/index.js';
import type { Diagnostic } from '../../src/types/diagnostic.js';

const TIMER_RULE = 'generic/no-uncleared-timers';

function makeEngine(baseline?: { path: string; update?: boolean }) {
  const config = resolvePluginConfig({
    mode: 'warn',
    customRules: builtinRules,
    // Several framework rules also fire on a bare setInterval; scope the
    // engine to generic so these tests observe exactly one finding.
    frameworks: [],
    ...(baseline ? { baseline: { path: baseline.path, update: baseline.update ?? false } } : {}),
  });
  return new LeakDetectorEngine(config);
}

describe('Baseline Fingerprinting', () => {
  it('generates consistent fingerprints independent of line numbers', () => {
    const diag1: Diagnostic = {
      ruleId: 'rule-a',
      message: 'Leak found',
      severity: 'warn',
      file: '/app/src/file.ts',
      line: 10,
      column: 5,
      snippet: 'const id = setInterval(tick, 1);',
    };

    const diag2: Diagnostic = {
      ...diag1,
      line: 20,
    };

    expect(generateFingerprint(diag1, '/app')).toBe(generateFingerprint(diag2, '/app'));
  });

  it('generates different fingerprints for different rules', () => {
    const diag1: Diagnostic = {
      ruleId: 'rule-a',
      message: 'Leak',
      severity: 'warn',
      file: '/app/src/file.ts',
      line: 10,
      column: 5,
    };

    const diag2: Diagnostic = {
      ...diag1,
      ruleId: 'rule-b',
    };

    expect(generateFingerprint(diag1, '/app')).not.toBe(generateFingerprint(diag2, '/app'));
  });

  it('generates different fingerprints for different files', () => {
    const diag1: Diagnostic = {
      ruleId: 'rule-a',
      message: 'Leak',
      severity: 'warn',
      file: '/app/src/one.ts',
      line: 10,
      column: 5,
      snippet: 'const id = setInterval(tick, 1);',
    };

    const diag2: Diagnostic = { ...diag1, file: '/app/src/two.ts' };

    expect(generateFingerprint(diag1, '/app')).not.toBe(generateFingerprint(diag2, '/app'));
  });

  // Changed expectation (Phase 2.2): the v2 key is
  // `rule|file|snippet|occurrenceIndex`. The message is deliberately NOT part
  // of it — the source snippet already identifies what leaked, and two
  // diagnostics of the same rule on the same line are separated by their
  // occurrence index. Rewording a message therefore no longer orphans a
  // baseline entry, whereas renaming the variable still creates a new finding.
  it('is insensitive to message wording but sensitive to the snippet', () => {
    const base: Diagnostic = {
      ruleId: 'rule-a',
      message: 'Leak A',
      severity: 'warn',
      file: '/app/src/file.ts',
      line: 10,
      column: 5,
      snippet: 'const id = setInterval(f, 1);',
    };

    const reworded = generateFingerprint({ ...base, message: 'Leak B' }, '/app');
    const renamed = generateFingerprint({ ...base, snippet: 'const timer = setInterval(f, 1);' }, '/app');

    expect(reworded).toBe(generateFingerprint(base, '/app'));
    expect(reworded).not.toBe(renamed);
  });

  it('separates diagnostics that share a snippet by occurrence index', () => {
    const base: Diagnostic = {
      ruleId: 'rule-a',
      message: "Timer 'id' is allocated but never cleared.",
      severity: 'warn',
      file: '/app/src/file.ts',
      line: 10,
      column: 5,
      snippet: 'const id = setInterval(f, 1);',
    };

    expect(generateFingerprint(base, '/app', 0)).not.toBe(generateFingerprint(base, '/app', 1));
  });

  it('collapses whitespace so reindentation does not change a fingerprint', () => {
    expect(normalizeSnippet('  const   id  =  1;  ')).toBe('const id = 1;');
    const diag: Diagnostic = {
      ruleId: 'rule-a',
      message: 'Leak',
      severity: 'warn',
      file: '/app/src/file.ts',
      line: 1,
      column: 0,
      snippet: 'const id = 1;',
    };
    expect(generateFingerprint({ ...diag, snippet: 'const id = 1;' }, '/app')).toBe(
      generateFingerprint(diag, '/app')
    );
  });

  it('uses relative paths for cross-machine portability', () => {
    const diag: Diagnostic = {
      ruleId: 'rule-a',
      message: 'Leak',
      severity: 'warn',
      file: '/home/user/project/src/file.ts',
      line: 10,
      column: 5,
    };

    expect(generateFingerprint(diag, '/home/user/project')).toHaveLength(16);
  });

  it('keeps the version 1 fingerprint independent of line numbers', () => {
    const diag: Diagnostic = {
      ruleId: 'rule-a',
      message: 'Leak',
      severity: 'warn',
      file: '/app/src/file.ts',
      line: 3,
      column: 0,
      snippet: 'const id = setInterval(f, 1);',
    };
    expect(generateLegacyFingerprint(diag, '/app')).toBe(
      generateLegacyFingerprint({ ...diag, line: 99 }, '/app')
    );
  });
});

describe('Baseline precision (v2)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-baseline-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('gives two leaks of the same variable in one file distinct fingerprints', () => {
    const engine = makeEngine();
    const code = [
      'export function a() {',
      '  const id = setInterval(tick, 1000);',
      '}',
      'export function b() {',
      '  const id = setInterval(tick, 1000);',
      '}',
    ].join('\n');

    const diagnostics = engine.analyze(path.join(dir, 'twice.ts'), code);
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.every((d) => d.ruleId === TIMER_RULE)).toBe(true);
    expect(diagnostics[0].fingerprint).not.toBe(diagnostics[1].fingerprint);
  });

  it('keeps a baselined leak suppressed after its line moves', () => {
    const file = path.join(dir, 'moves.ts');
    const before = ['const id = setInterval(tick, 1000);'].join('\n');

    const engineA = makeEngine({ path: file + '.baseline.json', update: true });
    const initial = engineA.analyze(file, before);
    expect(initial).toHaveLength(1);
    new BaselineManager(file + '.baseline.json', dir).updateBaseline(initial);

    // Same leak, pushed further down the file by unrelated new code.
    const after = ['// a brand new comment', '// and another', '', 'const id = setInterval(tick, 1000);'].join('\n');
    const engineB = makeEngine({ path: file + '.baseline.json' });
    expect(engineB.analyze(file, after)).toHaveLength(0);
  });

  it('reports a new leak that sits next to a baselined one', () => {
    const file = path.join(dir, 'sibling.ts');
    const initialCode = ['const id = setInterval(tick, 1000);'].join('\n');

    const engineA = makeEngine({ path: file + '.baseline.json', update: true });
    const initial = engineA.analyze(file, initialCode);
    expect(initial).toHaveLength(1);
    new BaselineManager(file + '.baseline.json', dir).updateBaseline(initial);

    // A second, differently-named leak is added on its own line.
    const updatedCode = ['const id = setInterval(tick, 1000);', 'const other = setInterval(tick, 500);'].join('\n');
    const engineB = makeEngine({ path: file + '.baseline.json' });
    const remaining = engineB.analyze(file, updatedCode);

    expect(remaining).toHaveLength(1);
    expect(remaining[0].ruleId).toBe(TIMER_RULE);
    expect(remaining[0].message).toContain('other');
  });

  it('still suppresses leaks from a version 1 baseline file and warns once', () => {
    const file = path.join(dir, 'legacy.ts');
    const baselinePath = file + '.baseline.json';
    const code = 'const id = setInterval(tick, 1000);';

    // Hand-write a v1 baseline keyed by the legacy `rule|file|message` hash.
    const probe = makeEngine().analyze(file, code);
    expect(probe).toHaveLength(1);
    fs.writeFileSync(
      baselinePath,
      JSON.stringify(
        {
          version: '1.0.0',
          updatedAt: new Date().toISOString(),
          issues: [
            {
              fingerprint: generateLegacyFingerprint(probe[0], dir),
              ruleId: probe[0].ruleId,
              file: 'legacy.ts',
              message: probe[0].message,
            },
          ],
        },
        null,
        2
      )
    );

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const engine = makeEngine({ path: baselinePath });
      engine.setRoot(dir);
      expect(engine.analyze(file, code)).toHaveLength(0);
      // The compatibility notice is printed exactly once.
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('legacy v1 format');
    } finally {
      warn.mockRestore();
    }
  });

  it('writes version 2 baselines', () => {
    const file = path.join(dir, 'v2.ts');
    const baselinePath = file + '.baseline.json';
    const engine = makeEngine({ path: baselinePath, update: true });
    const diagnostics = engine.analyze(file, 'const id = setInterval(tick, 1000);');
    new BaselineManager(baselinePath, dir).updateBaseline(diagnostics);

    const written = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
    expect(written.version).toBe('2.0.0');
  });

  it('resolves the baseline path and relative files against the Vite root, not cwd', () => {
    const nested = path.join(dir, 'project');
    fs.mkdirSync(nested, { recursive: true });

    const engine = makeEngine();
    engine.setRoot(nested);

    const code = 'const id = setInterval(tick, 1000);';
    const diagnostics = engine.analyze(path.join(nested, 'src', 'a.ts'), code);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].snippet).toContain('setInterval');

    // Fingerprints are stable no matter what the process cwd is, because the
    // repo-relative path is derived from the root.
    const again = makeEngine();
    again.setRoot(nested);
    expect(again.analyze(path.join(nested, 'src', 'a.ts'), code)[0].fingerprint).toBe(
      diagnostics[0].fingerprint
    );
  });

  it('writes the baseline under the Vite root when it differs from cwd', () => {
    const nested = path.join(dir, 'root-differs');
    fs.mkdirSync(nested, { recursive: true });

    const baselinePath = 'nested/.leak-baseline.json';
    const engine = makeEngine({ path: baselinePath, update: true });
    engine.setRoot(dir);

    const file = path.join(nested, 'a.ts');
    const diagnostics = engine.analyze(file, 'const id = setInterval(tick, 1000);');
    new BaselineManager(baselinePath, dir).updateBaseline(diagnostics);

    expect(fs.existsSync(path.join(dir, baselinePath))).toBe(true);
  });
});