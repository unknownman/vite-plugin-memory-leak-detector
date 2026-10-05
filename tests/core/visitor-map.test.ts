import { describe, it, expect } from 'vitest';
import { LeakDetectorEngine } from '../../src/core/engine.js';
import { resolvePluginConfig } from '../../src/config/index.js';
import { builtinRules } from '../../src/rules/index.js';
import type { RuleDefinition } from '../../src/types/rule.js';

/** A rule whose visitor records every property read performed on it. */
function countingRule(id: string, counters: Record<string, { gets: number; calls: number }>) {
  const wrap = (key: string, fn: () => void) => () => {
    counters[key].calls++;
    fn();
  };

  const visitor: Record<string, any> = {};
  // Two handlers on node types that do occur, one on a type that does not.
  visitor['CallExpression'] = wrap(`${id}:CallExpression`, () => {});
  visitor['Identifier'] = wrap(`${id}:Identifier`, () => {});
  visitor['VariableDeclarator:exit'] = wrap(`${id}:VariableDeclarator:exit`, () => {});
  visitor['ClassDeclaration'] = wrap(`${id}:ClassDeclaration`, () => {});

  const rule: RuleDefinition = {
    id,
    description: 'counts visitor property reads',
    category: 'generic',
    // 'warn', not 'off': an off rule is skipped before its visitor is built.
    // The handlers deliberately never call context.report.
    defaultSeverity: 'warn',
    triggers: ['compute'], // present in CODE, so the file is parsed
    create: () => visitor,
  };

  // A Proxy makes the per-node `visitor[node.type]` probe of the old traversal
  // observable: every miss was a property read on every rule.
  const countingVisitor = new Proxy(visitor, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && prop in target) counters[`${id}:${prop}`].gets++;
      return Reflect.get(target, prop, receiver);
    },
  });

  return { rule, counters, countingVisitor };
}

const CODE = `
const a = compute(1);
const b = compute(2);
class Store { value = compute(3); }
function run() { const c = compute(4); return c; }
`;

describe('visitor map', () => {
  it('reads each rule visitor a bounded number of times instead of once per node', () => {
    const counters: Record<string, { gets: number; calls: number }> = {
      'probe:CallExpression': { gets: 0, calls: 0 },
      'probe:Identifier': { gets: 0, calls: 0 },
      'probe:VariableDeclarator:exit': { gets: 0, calls: 0 },
      'probe:ClassDeclaration': { gets: 0, calls: 0 },
    };
    const { rule, countingVisitor } = countingRule('probe', counters);
    const engine = new LeakDetectorEngine(
      resolvePluginConfig({ mode: 'warn', customRules: [rule] })
    );
    (rule as any).create = () => countingVisitor;

    const diagnostics = engine.analyze('/app/src/x.ts', CODE);
    expect(diagnostics).toHaveLength(0);

    const callReads = counters['probe:CallExpression'].gets;
    const identifierReads = counters['probe:Identifier'].gets;

    // The map is built once: one read per declared handler while indexing.
    expect(callReads).toBe(1);
    expect(identifierReads).toBe(1);

    // The whole point: reads are independent of how many nodes the file has.
    // Under the old traversal each of these would equal the node count.
    const small = new LeakDetectorEngine(resolvePluginConfig({ mode: 'warn', customRules: [rule] }));
    (rule as any).create = () => countingVisitor;
    small.analyze('/app/src/small.ts', 'const a = compute(1);');

    expect(counters['probe:CallExpression'].gets).toBe(2);
    expect(counters['probe:Identifier'].gets).toBe(2);
  });

  it('never invokes a handler for a node type that does not occur', () => {
    const calls: string[] = [];
    const rule: RuleDefinition = {
      id: 'probe/absent',
      description: 'visits an absent node type',
      category: 'generic',
      defaultSeverity: 'warn',
      triggers: ['setInterval'],
      create: () => ({
        CallExpression: () => calls.push('CallExpression'),
        // `WithStatement` never appears in the fixture.
        WithStatement: () => calls.push('WithStatement'),
        'CallExpression:exit': () => calls.push('CallExpression:exit'),
      }),
    };
    const engine = new LeakDetectorEngine(
      resolvePluginConfig({ mode: 'warn', customRules: [rule] })
    );

    engine.analyze('/app/src/x.ts', 'setInterval(tick, 1);');

    expect(calls).toEqual(['CallExpression', 'CallExpression:exit']);
  });

  it('keeps exit handlers running after ancestors are popped', () => {
    const seen: number[] = [];
    const rule: RuleDefinition = {
      id: 'probe/ancestors',
      description: 'records ancestor depth',
      category: 'generic',
      defaultSeverity: 'warn',
      triggers: ['setInterval'],
      create: () => ({
        CallExpression(_node: any, _parent: any, ancestors: any[] = []) {
          seen.push(ancestors.length);
        },
        'CallExpression:exit'(_node: any, _parent: any, ancestors: any[] = []) {
          seen.push(-ancestors.length);
        },
      }),
    };
    const engine = new LeakDetectorEngine(
      resolvePluginConfig({ mode: 'warn', customRules: [rule] })
    );

    engine.analyze('/app/src/x.ts', 'function f() { setInterval(tick, 1); }');

    expect(seen).toHaveLength(2);
    // Exit handlers observe the same strict-ancestor depth as enter handlers:
    // the node is pushed after enter and popped before exit.
    expect(seen[0]).toBeGreaterThan(0);
    expect(-seen[1]).toBe(seen[0]);
  });

  it('still reports through every built-in rule after the refactor', () => {
    const engine = new LeakDetectorEngine(
      resolvePluginConfig({ mode: 'warn', customRules: builtinRules })
    );

    const cases: Array<[string, string, string]> = [
      ['/app/a.ts', 'const id = setInterval(tick, 1000);', 'generic/no-uncleared-timers'],
      ['/app/b.ts', 'const ws = new WebSocket(url);', 'generic/no-unclosed-websockets'],
      ['/app/c.ts', 'const o = new IntersectionObserver(cb);', 'generic/no-unconnected-observers'],
      ['/app/d.ts', 'const sub = emitter.subscribe(v => {});', 'generic/no-unsubscribed-events'],
      [
        '/app/e.tsx',
        'useEffect(() => { const id = setInterval(tick, 1); });',
        'react/react-useeffect-cleanup',
      ],
    ];

    for (const [file, code, ruleId] of cases) {
      const diagnostics = engine.analyze(file, code);
      expect(diagnostics.map((d) => d.ruleId), file).toContain(ruleId);
    }
  });
});