import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RuleDefinition } from '../../src/types/rule.js';

// Count every `parseCode` call so we can assert a file never reaches the parser.
const parseCalls: string[] = [];
vi.mock('../../src/core/parser.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/parser.js')>();
  return {
    ...actual,
    parseCode(code: string, filename?: string) {
      parseCalls.push(filename ?? 'module.tsx');
      return actual.parseCode(code, filename);
    },
  };
});

const { LeakDetectorEngine } = await import('../../src/core/engine.js');
const { resolvePluginConfig } = await import('../../src/config/index.js');
const { builtinRules } = await import('../../src/rules/index.js');

function makeEngine(rules: RuleDefinition[] = builtinRules, extra: Record<string, unknown> = {}) {
  return new LeakDetectorEngine(
    resolvePluginConfig({ mode: 'warn', customRules: rules, ...extra })
  );
}

/** A file with no allocation, lifecycle or observer API anywhere in it. */
const CLEAN_CODE = `
import { helper } from './helper';

export interface Row { id: string; total: number }

export const LABELS: Record<string, string> = { open: 'Open', done: 'Done' };

export class Ledger {
  private rows: Row[] = [];
  constructor(rows: Row[] = []) { this.rows = rows; }
  get total(): number { return this.rows.reduce((sum, r) => sum + r.total, 0); }
  toString(): string { return 'Ledger(' + this.rows.length + ')'; }
}

export function summarize(rows: Row[]): string {
  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[helper(r.id)] = (acc[helper(r.id)] ?? 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts).map(([k, v]) => k + ':' + v).join(', ');
}

export const clamp = (n: number, lo = 0, hi = 100): number => Math.min(hi, Math.max(lo, n));
`;

describe('parser prefilter', () => {
  beforeEach(() => {
    parseCalls.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never reaches the parser for a file that allocates nothing', () => {
    const engine = makeEngine();
    const diagnostics = engine.analyze('/app/src/ledger.ts', CLEAN_CODE);

    expect(diagnostics).toHaveLength(0);
    expect(parseCalls).toHaveLength(0);
  });

  it('does parse a file that contains a triggering allocation', () => {
    const engine = makeEngine();
    engine.analyze('/app/src/timer.ts', 'const id = setInterval(tick, 1000);');

    expect(parseCalls).toHaveLength(1);
  });

  it('parses a component file that allocates inside its lifecycle', () => {
    const engine = makeEngine();
    const code =
      'export default { setup() { const id = setInterval(tick, 1000); onUnmounted(() => clearInterval(id)); return { id }; } };';
    const diagnostics = engine.analyze('/app/src/C.vue', code);

    expect(parseCalls).toHaveLength(1);
    // The interval is cleaned up in onUnmounted, so this must stay silent.
    expect(diagnostics).toHaveLength(0);
  });

  it('skips a component file whose lifecycle hooks allocate nothing', () => {
    const engine = makeEngine();
    const code =
      'export default { setup() { const n = ref(0); onUnmounted(() => {}); return { n }; } };';
    const diagnostics = engine.analyze('/app/src/C.vue', code);

    // `ref`/`onUnmounted` are not allocations, so no rule can report here.
    expect(diagnostics).toHaveLength(0);
    expect(parseCalls).toHaveLength(0);
  });

  it('is applied to the extracted script of an SFC', () => {
    const engine = makeEngine();
    const extraction = { code: CLEAN_CODE, lineOffset: 0, columnOffset: 0 };
    engine.analyze('/app/src/C.vue', '<template><div/></template>', extraction);

    expect(parseCalls).toHaveLength(0);
  });

  it('skips a plain SFC whose script allocates nothing', () => {
    const engine = makeEngine();
    const extraction = { code: 'const answer = 42;', lineOffset: 0, columnOffset: 0 };
    engine.analyze('/app/src/D.vue', '<template><div/></template>', extraction);

    expect(parseCalls).toHaveLength(0);
  });

  it('still reports leaks it would otherwise have skipped', () => {
    const engine = makeEngine();
    const cases: Array<[string, string]> = [
      ['/app/a.ts', 'const id = setInterval(fn, 1);'],
      ['/app/b.ts', 'const ws = new WebSocket(url);'],
      ['/app/c.ts', 'const ac = new AbortController();'],
      ['/app/d.ts', 'const o = new IntersectionObserver(cb);'],
      ['/app/e.ts', 'const sub = emitter.subscribe(v => {});'],
      ['/app/f.ts', 'useEffect(() => { setInterval(tick, 1); });'],
      ['/app/g.ts', 'setInterval(tick, 1);'],
      ['/app/h.ts', 'new MutationObserver(cb);'],
      ['/app/i.ts', 'el.addEventListener("click", fn);'],
    ];

    for (const [file, code] of cases) {
      expect(engine.analyze(file, code).length, file).toBeGreaterThan(0);
    }
  });

  it('skips rules whose trigger is absent without disabling the rest', () => {
    const engine = makeEngine();
    // Only a listener rule can fire here.
    const diagnostics = engine.analyze(
      '/app/listener.ts',
      'el.addEventListener("click", fn);'
    );

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(new Set(diagnostics.map((d) => d.ruleId))).toEqual(
      new Set(['generic/no-unregistered-listeners'])
    );
  });

  it('falls back to a full parse when a rule declares no triggers', () => {
    const undeclared: RuleDefinition = {
      id: 'test/undeclared-triggers',
      description: 'reports any timer regardless of declaration',
      category: 'generic',
      defaultSeverity: 'warn',
      triggers: [],
      create: (context) => ({
        Identifier(node: any) {
          context.report({
            ruleId: 'test/undeclared-triggers',
            message: 'unconditional',
            line: node.loc?.start?.line ?? 1,
            column: node.loc?.start?.column ?? 0,
          });
        },
      }),
    };

    const engine = makeEngine([undeclared]);
    const diagnostics = engine.analyze('/app/anything.ts', CLEAN_CODE);

    // The prefilter must not have short-circuited this rule.
    expect(parseCalls).toHaveLength(1);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(new Set(diagnostics.map((d) => d.ruleId))).toEqual(
      new Set(['test/undeclared-triggers'])
    );
  });

  it('excludes disabled rules from the trigger set', () => {
    const engine = makeEngine(builtinRules, {
      frameworks: [],
      rules: { 'generic/no-uncleared-timers': 'off' },
    });
    const diagnostics = engine.analyze('/app/only-timer.ts', 'const id = setInterval(tick, 1);');

    expect(diagnostics).toHaveLength(0);
    // With the only rule that cares about `setInterval` switched off, its trigger
    // disappears from the union and the file is never parsed at all.
    expect(parseCalls).toHaveLength(0);
  });
});