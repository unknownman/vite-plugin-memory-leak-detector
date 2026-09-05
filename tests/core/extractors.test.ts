import { describe, it, expect } from 'vitest';
import { extractVue } from '../../src/core/extractors/vue.js';
import { extractSvelte } from '../../src/core/extractors/svelte.js';
import { parseCode } from '../../src/core/parser.js';
import { LeakDetectorEngine } from '../../src/core/engine.js';
import { resolvePluginConfig } from '../../src/config/index.js';
import { builtinRules } from '../../src/rules/index.js';

describe('extractors infer script language', () => {
  it('infers ts for Vue <script setup lang="ts">', async () => {
    const result = await extractVue(`<script setup lang="ts">\nconst id: number = 1;\n</script>`);
    expect(result.inferredExtension).toBe('ts');
  });

  it('infers tsx for Vue lang="tsx"', async () => {
    const result = await extractVue(`<script setup lang="tsx">\nconst el = <div />;\n</script>`);
    expect(result.inferredExtension).toBe('tsx');
  });

  it('infers jsx for Vue lang="jsx"', async () => {
    const result = await extractVue(`<script setup lang="jsx">\nconst el = <div />;\n</script>`);
    expect(result.inferredExtension).toBe('jsx');
  });

  it('defaults to js when Vue has no lang attribute', async () => {
    const result = await extractVue(`<script setup>\nconst id = 1;\n</script>`);
    expect(result.inferredExtension).toBe('js');
  });

  it('infers ts for Svelte lang="ts"', async () => {
    const result = await extractSvelte(`<script lang="ts">\nconst id: number = 1;\n</script>`);
    expect(result.inferredExtension).toBe('ts');
  });

  it('defaults to js when Svelte has no lang attribute', async () => {
    const result = await extractSvelte(`<script>\nconst id = 1;\n</script>`);
    expect(result.inferredExtension).toBe('js');
  });
});

describe('parser handles TS/JSX in SFC scripts', () => {
  async function analyzeVue(scriptSetup: string) {
    const code = `<script setup lang="tsx">\n${scriptSetup}\n</script>`;
    const config = resolvePluginConfig({ mode: 'warn', customRules: builtinRules });
    const engine = new LeakDetectorEngine(config);
    return engine.analyze('App.vue', code, await extractVue(code));
  }

  it('does not crash on TypeScript annotations in Vue script setup', async () => {
    const diagnostics = await analyzeVue(`const id: number = setInterval(() => {}, 1000);`);
    const leaked = diagnostics.filter((d) => d.ruleId === 'generic/no-uncleared-timers');
    expect(leaked).toHaveLength(1);
  });

  it('does not crash on JSX in Vue script setup', async () => {
    const diagnostics = await analyzeVue(`const el = <div>{foo}</div>;`);
    expect(diagnostics).toHaveLength(0);
  });

  it('parses TypeScript from a Svelte <script lang="ts"> with the engine', async () => {
    const code = `<script lang="ts">\nconst id: number = setInterval(() => {}, 1000);\n</script>`;
    const config = resolvePluginConfig({ mode: 'warn', customRules: builtinRules });
    const engine = new LeakDetectorEngine(config);
    const diagnostics = engine.analyze('App.svelte', code, await extractSvelte(code));
    const leaked = diagnostics.filter((d) => d.ruleId === 'generic/no-uncleared-timers');
    expect(leaked).toHaveLength(1);
  });

  it('falls back to tsx dialect for unknown extensions', () => {
    const { ast, errors } = parseCode('const x: number = 1;', 'app.custom');
    expect(ast).not.toBeNull();
    expect(errors).toHaveLength(0);
  });
});

describe('extractors stitch all script blocks with exact line mapping', () => {
  it('Vue: analyzes plain <script> AND <script setup> with original line numbers', async () => {
    const code = `<template>
  <div>Hi</div>
</template>

<script>
import { destroy } from 'somewhere';
const moduleTimer = setInterval(() => {}, 1000);
export function clearAll() {
  clearInterval(moduleTimer);
}
</script>

<script setup lang="ts">
const setupTimer = setInterval(() => {}, 2000);
</script>
`;

    const result = await extractVue(code);
    expect(result.lineOffset).toBe(0);
    expect(result.columnOffset).toBe(0);
    expect(result.inferredExtension).toBe('ts');
    // Both blocks present; plain <script> (with imports) stitched before setup.
    expect(result.code.indexOf("from 'somewhere'")).toBeLessThan(result.code.indexOf('moduleTimer'));
    expect(result.code.indexOf('moduleTimer')).toBeLessThan(result.code.indexOf('setupTimer'));

    const config = resolvePluginConfig({ mode: 'warn', customRules: builtinRules });
    const engine = new LeakDetectorEngine(config);
    const diagnostics = engine.analyze('App.vue', code, await extractVue(code));
    const leaked = diagnostics.filter((d) => d.ruleId === 'vue/missing-onunmounted');
    expect(leaked.map((d) => d.line)).toEqual([7, 14]);
  });

  it('Svelte: analyzes module-context AND instance scripts with original line numbers', async () => {
    const code = `<script context="module">
import { onDestroy } from 'svelte';
const moduleTimer = setInterval(() => {}, 1000);
export function clearAll() { clearInterval(moduleTimer); }
</script>

<script>
const instanceTimer = setInterval(() => {}, 2000);
onDestroy(() => {});
</script>
`;

    const result = await extractSvelte(code);
    expect(result.lineOffset).toBe(0);
    expect(result.columnOffset).toBe(0);
    // Module-context block (with imports) stitched before instance block.
    expect(result.code.indexOf("from 'svelte'")).toBeLessThan(result.code.indexOf('moduleTimer'));
    expect(result.code.indexOf('moduleTimer')).toBeLessThan(result.code.indexOf('instanceTimer'));

    const config = resolvePluginConfig({ mode: 'warn', customRules: builtinRules });
    const engine = new LeakDetectorEngine(config);
    const diagnostics = engine.analyze('App.svelte', code, await extractSvelte(code));
    const leaked = diagnostics.filter((d) => d.ruleId === 'svelte/missing-ondestroy');
    expect(leaked.map((d) => d.line)).toEqual([3, 8]);
  });
});