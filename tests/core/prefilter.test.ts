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
const { reactUseEffectCleanupRule } = await import('../../src/rules/react/react-useeffect-cleanup.js');
const { vueMissingOnUnmountedRule } = await import('../../src/rules/vue/vue-missing-onunmounted.js');

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

  it('reports effect hooks that do not literally contain "useEffect"', () => {
    const engine = makeEngine([reactUseEffectCleanupRule]);
    const hooks = ['useLayoutEffect', 'useIsomorphicLayoutEffect', 'useUpdateEffect'];

    for (const hook of hooks) {
      const code = `${hook}(() => { el.addEventListener("click", onClick); }, []);`;
      const diagnostics = engine.analyze(`/app/src/${hook}.tsx`, code);
      expect(
        diagnostics.map((d) => d.ruleId),
        hook
      ).toContain('react/react-useeffect-cleanup');
      expect(parseCalls, hook).toContain(`/app/src/${hook}.tsx`);
    }
  });

  it('skips a file with no effect hook even when other triggers occur', () => {
    const engine = makeEngine([reactUseEffectCleanupRule]);
    const code = 'const id = setInterval(tick, 1000); clearInterval(id);';

    expect(engine.analyze('/app/src/no-effect.ts', code)).toHaveLength(0);
    expect(parseCalls).toHaveLength(0);
  });

  it('parses and reports files that only use useLayoutEffect', () => {
    const engine = makeEngine([reactUseEffectCleanupRule]);
    const code = 'useLayoutEffect(() => { const id = setInterval(tick, 1000); }, []);';

    const diagnostics = engine.analyze('/app/src/layout.tsx', code);
    expect(diagnostics.map((d) => d.ruleId)).toContain('react/react-useeffect-cleanup');
    expect(parseCalls).toHaveLength(1);
  });

  it('skips a file that only contains a trigger no report can come from', () => {
    // The vue rule never reports on `.on(...)` subscriptions — its detection
    // only matches setInterval / addEventListener / subscribe — so `.on(`
    // must not be part of its trigger set.
    const engine = makeEngine([vueMissingOnUnmountedRule]);

    expect(engine.analyze('/app/src/sub-only.ts', "store.on('change', cb);")).toHaveLength(0);
    expect(parseCalls).toHaveLength(0);
  });

  it('parses a file the vue rule can actually report on', () => {
    const engine = makeEngine([vueMissingOnUnmountedRule]);

    const diagnostics = engine.analyze('/app/src/setup.ts', 'const id = setInterval(tick, 1000);');
    expect(diagnostics.map((d) => d.ruleId)).toContain('vue/missing-onunmounted');
    expect(parseCalls).toHaveLength(1);
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

  it('warns once in verbose mode when a rule disables the prefilter with triggers: []', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const undeclared: RuleDefinition = {
      id: 'test/untriggered-verbose',
      description: 'reports any identifier',
      category: 'generic',
      defaultSeverity: 'warn',
      triggers: [],
      create: (context) => ({
        Identifier(node: any) {
          context.report({
            ruleId: 'test/untriggered-verbose',
            message: 'unconditional',
            line: node.loc?.start?.line ?? 1,
            column: node.loc?.start?.column ?? 0,
          });
        },
      }),
    };

    const engine = makeEngine([undeclared], { verbose: true });
    engine.analyze('/app/a.ts', CLEAN_CODE);
    engine.analyze('/app/b.ts', CLEAN_CODE);
    engine.analyze('/app/c.ts', CLEAN_CODE);

    const triggerWarnings = warnSpy.mock.calls
      .map((c) => c.join(' '))
      .filter((m) => m.includes('triggers'));
    expect(triggerWarnings).toHaveLength(1);
    expect(triggerWarnings[0]).toContain('test/untriggered-verbose');

    warnSpy.mockRestore();
  });

  it('does not warn about triggers: [] when verbose is off', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const undeclared: RuleDefinition = {
      id: 'test/untriggered-quiet',
      description: 'reports any identifier',
      category: 'generic',
      defaultSeverity: 'warn',
      triggers: [],
      create: (context) => ({
        Identifier(node: any) {
          context.report({
            ruleId: 'test/untriggered-quiet',
            message: 'unconditional',
            line: node.loc?.start?.line ?? 1,
            column: node.loc?.start?.column ?? 0,
          });
        },
      }),
    };

    const engine = makeEngine([undeclared]);
    engine.analyze('/app/a.ts', CLEAN_CODE);

    expect(
      warnSpy.mock.calls.map((c) => c.join(' ')).filter((m) => m.includes('triggers'))
    ).toHaveLength(0);
    warnSpy.mockRestore();
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