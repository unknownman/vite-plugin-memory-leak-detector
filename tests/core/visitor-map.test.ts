import { describe, it, expect } from 'vitest';
import { walk } from 'estree-walker';
import { LeakDetectorEngine } from '../../src/core/engine.js';
import { parseCode } from '../../src/core/parser.js';
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

describe('wildcard visitor keys', () => {
  const WILDCARD_RULE: RuleDefinition = {
    id: 'probe/wildcard',
    description: 'exercises the * and *:exit visitor keys',
    category: 'generic',
    defaultSeverity: 'warn',
    triggers: ['setInterval'],
    create: () => ({}),
  };

  const CODE_WITH_ONE_CALL = 'setInterval(tick, 1);';

  it('calls the * and *:exit handlers for every node', () => {
    const enters: string[] = [];
    const exits: string[] = [];
    const rule: RuleDefinition = {
      ...WILDCARD_RULE,
      create: () => ({
        '*': (node: any) => enters.push(node.type),
        '*:exit': (node: any) => exits.push(node.type),
      }),
    };
    const engine = new LeakDetectorEngine(
      resolvePluginConfig({ mode: 'warn', customRules: [rule] })
    );

    expect(engine.analyze('/app/src/x.ts', CODE_WITH_ONE_CALL)).toHaveLength(0);

    const { ast } = parseCode(CODE_WITH_ONE_CALL, 'x.ts');
    let nodeCount = 0;
    walk(ast!, {
      enter() {
        nodeCount++;
      },
    });

    expect(nodeCount).toBeGreaterThan(1);
    expect(enters).toHaveLength(nodeCount);
    expect(exits).toHaveLength(nodeCount);
    // Same nodes seen exactly once on each side, root enters first and leaves last.
    expect([...enters].sort()).toEqual([...exits].sort());
    expect(enters[0]).toBe('Program');
    expect(exits[exits.length - 1]).toBe('Program');
  });

  it('runs * before the type-specific handler on enter and after it on exit', () => {
    const log: string[] = [];
    const rule: RuleDefinition = {
      ...WILDCARD_RULE,
      create: () => ({
        '*': () => log.push('wild'),
        CallExpression: () => log.push('type'),
        '*:exit': () => log.push('wild:exit'),
        'CallExpression:exit': () => log.push('type:exit'),
      }),
    };
    const engine = new LeakDetectorEngine(
      resolvePluginConfig({ mode: 'warn', customRules: [rule] })
    );

    engine.analyze('/app/src/x.ts', CODE_WITH_ONE_CALL);

    const typeEnter = log.indexOf('type');
    const typeExit = log.indexOf('type:exit');
    expect(typeEnter).toBeGreaterThan(0);
    expect(typeExit).toBeGreaterThan(typeEnter);

    // The wildcard handler for this very node runs immediately before/after.
    expect(log[typeEnter - 1]).toBe('wild');
    expect(log[typeExit + 1]).toBe('wild:exit');
    expect(log.indexOf('wild:exit')).toBeGreaterThan(typeEnter);
  });

  it('keeps type-specific handlers working when a wildcard handler exists', () => {
    const seen: string[] = [];
    const rule: RuleDefinition = {
      ...WILDCARD_RULE,
      create: () => ({
        '*': () => seen.push('*'),
        Program: () => seen.push('Program'),
        'Program:exit': () => seen.push('Program:exit'),
        '*:exit': () => seen.push('*:exit'),
      }),
    };
    const engine = new LeakDetectorEngine(
      resolvePluginConfig({ mode: 'warn', customRules: [rule] })
    );

    engine.analyze('/app/src/x.ts', CODE_WITH_ONE_CALL);

    const programEnter = seen.indexOf('Program');
    const programExit = seen.indexOf('Program:exit');
    expect(programEnter).toBeGreaterThan(0);
    expect(seen[programEnter - 1]).toBe('*');
    expect(seen[programExit + 1]).toBe('*:exit');
  });
});

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