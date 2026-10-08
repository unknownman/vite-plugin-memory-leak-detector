/**
 * Phase 4 benchmark: parser prefilter + visitor map.
 *
 * Run with: npx tsx benchmarks/phase4.ts
 *
 * Measures a realistic corpus (mostly leak-free modules, which is what dominates
 * a real app's module graph) against a handful of files that genuinely leak.
 */
import { LeakDetectorEngine } from '../src/core/engine.js';
import { resolvePluginConfig } from '../src/config/index.js';
import { builtinRules } from '../src/rules/index.js';

const CLEAN_MODULE = `
import { formatMoney, formatDate } from './format';

export interface LedgerEntry {
  id: string;
  amount: number;
  postedAt: Date;
  memo?: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  income: 'Income',
  expense: 'Expense',
  transfer: 'Transfer',
};

export class Ledger {
  private entries: LedgerEntry[] = [];

  constructor(entries: LedgerEntry[] = []) {
    this.entries = [...entries];
  }

  get total(): number {
    return this.entries.reduce((sum, entry) => sum + entry.amount, 0);
  }

  byCategory(): Map<string, LedgerEntry[]> {
    const grouped = new Map<string, LedgerEntry[]>();
    for (const entry of this.entries) {
      const key = entry.memo ?? 'uncategorized';
      const bucket = grouped.get(key);
      if (bucket) bucket.push(entry);
      else grouped.set(key, [entry]);
    }
    return grouped;
  }

  toString(): string {
    return 'Ledger(' + this.entries.length + ', ' + formatMoney(this.total) + ')';
  }
}

export function summarize(entries: LedgerEntry[]): string {
  return entries
    .map((e) => formatDate(e.postedAt) + ': ' + formatMoney(e.amount))
    .join('\\n');
}

export const clamp = (value: number, min = 0, max = 1_000_000): number =>
  value < min ? min : value > max ? max : value;

export const DEFAULT_CATEGORY = CATEGORY_LABELS.transfer;
`;

const LEAKY_MODULE = `
import { useEffect, useState } from 'react';

export function Ticker({ label }: { label: string }) {
  const [ticks, setTicks] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTicks((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return { label, ticks };
}

export function LegacyTicker() {
  const id = setInterval(() => {}, 1000);
  const ws = new WebSocket('wss://example.test');
  const observer = new IntersectionObserver(() => {});
  const sub = emitter.subscribe(() => {});
  return { id, ws, observer, sub };
}
`;

function corpus(clean: number, leaky: number): Array<[string, string]> {
  const files: Array<[string, string]> = [];
  for (let i = 0; i < clean; i++) files.push([`/app/src/clean-${i}.ts`, CLEAN_MODULE]);
  for (let i = 0; i < leaky; i++) files.push([`/app/src/leaky-${i}.tsx`, LEAKY_MODULE]);
  return files;
}

/**
 * A leak-free module that still contains a trigger substring (`addEventListener`),
 * so the prefilter lets it through and the full parser + traversal runs.
 * Models a real app where ~30% of clean files register listeners.
 */
const CLEAN_LISTENER_MODULE = `
import { onClickOutside } from './dom';

export function bindPanel(panel: HTMLElement, onClose: () => void) {
  const handler = () => onClose();
  panel.addEventListener('keydown', handler);
  onClickOutside(panel, handler);
  return () => panel.removeEventListener('keydown', handler);
}
`;

/** 30% of the clean corpus contains `addEventListener`; the rest never triggers. */
function mixedCorpus(clean: number): Array<[string, string]> {
  const files: Array<[string, string]> = [];
  for (let i = 0; i < clean; i++) {
    const listener = i % 10 < 3;
    files.push(
      listener
        ? [`/app/src/clean-listener-${i}.ts`, CLEAN_LISTENER_MODULE]
        : [`/app/src/clean-${i}.ts`, CLEAN_MODULE]
    );
  }
  return files;
}

function time(engine: LeakDetectorEngine, files: Array<[string, string]>) {
  const started = performance.now();
  let diagnostics = 0;
  for (const [file, code] of files) diagnostics += engine.analyze(file, code).length;
  return { ms: performance.now() - started, diagnostics };
}

const engine = new LeakDetectorEngine(resolvePluginConfig({ mode: 'warn', customRules: builtinRules }));

// Same rules with an empty trigger list: the prefilter is disabled engine-wide,
// so every file takes the full parse + traversal path. This is the "off" side
// of the README's prefilter comparison.
const enginePrefilterOff = new LeakDetectorEngine(
  resolvePluginConfig({
    mode: 'warn',
    customRules: builtinRules.map((r) => ({ ...r, triggers: [] })),
  })
);

const CLEAN = 300;
const LEAKY = 20;
const files = corpus(CLEAN, LEAKY);

// Warm up so JIT compilation is not attributed to the prefilter.
for (let i = 0; i < 3; i++) time(engine, files);

const RUNS = 10;
const cleanRuns: number[] = [];
const mixedRuns: number[] = [];
const offRuns: number[] = [];
const leakyRuns: number[] = [];
let diagnostics = 0;

for (let i = 0; i < RUNS; i++) {
  cleanRuns.push(time(engine, corpus(CLEAN, 0)).ms);
  mixedRuns.push(time(engine, mixedCorpus(CLEAN)).ms);
  offRuns.push(time(enginePrefilterOff, corpus(CLEAN, 0)).ms);
  const leaky = time(engine, corpus(0, LEAKY));
  leakyRuns.push(leaky.ms);
  diagnostics = leaky.diagnostics;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const kb = (n: number) => `${(n / 1024).toFixed(1)} kB`;

const totalBytes = files.reduce((n, [, code]) => n + code.length, 0);

console.log(`corpus: ${CLEAN} clean modules + ${LEAKY} leaky modules (${kb(totalBytes)} total)`);
console.log(`rules:  ${builtinRules.length} built-in, trigger union ${new Set(builtinRules.flatMap((r) => r.triggers)).size} substrings\n`);
console.log(`clean files, 0% trigger hits   median ${median(cleanRuns).toFixed(1)} ms`);
console.log(`clean files, 30% addEventListener hits (parsed)  median ${median(mixedRuns).toFixed(1)} ms`);
console.log(`clean files, prefilter off (every file parsed)  median ${median(offRuns).toFixed(1)} ms`);
console.log(`leaky files  median ${median(leakyRuns).toFixed(1)} ms`);
console.log(`leaky diagnostics found: ${diagnostics}`);