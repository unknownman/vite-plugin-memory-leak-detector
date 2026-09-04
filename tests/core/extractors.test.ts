import { describe, it, expect } from 'vitest';
import { extractVue } from '../../src/core/extractors/vue.js';
import { extractSvelte } from '../../src/core/extractors/svelte.js';
import { parseCode } from '../../src/core/parser.js';
import { LeakDetectorEngine } from '../../src/core/engine.js';
import { resolvePluginConfig } from '../../src/config/index.js';
import { builtinRules } from '../../src/rules/index.js';

describe('extractors infer script language', () => {
  it('infers ts for Vue <script setup lang="ts">', () => {
    const result = extractVue(`<script setup lang="ts">\nconst id: number = 1;\n</script>`);
    expect(result.inferredExtension).toBe('ts');
  });

  it('infers tsx for Vue lang="tsx"', () => {
    const result = extractVue(`<script setup lang="tsx">\nconst el = <div />;\n</script>`);
    expect(result.inferredExtension).toBe('tsx');
  });

  it('infers jsx for Vue lang="jsx"', () => {
    const result = extractVue(`<script setup lang="jsx">\nconst el = <div />;\n</script>`);
    expect(result.inferredExtension).toBe('jsx');
  });

  it('defaults to js when Vue has no lang attribute', () => {
    const result = extractVue(`<script setup>\nconst id = 1;\n</script>`);
    expect(result.inferredExtension).toBe('js');
  });

  it('infers ts for Svelte lang="ts"', () => {
    const result = extractSvelte(`<script lang="ts">\nconst id: number = 1;\n</script>`);
    expect(result.inferredExtension).toBe('ts');
  });

  it('defaults to js when Svelte has no lang attribute', () => {
    const result = extractSvelte(`<script>\nconst id = 1;\n</script>`);
    expect(result.inferredExtension).toBe('js');
  });
});

describe('parser handles TS/JSX in SFC scripts', () => {
  function analyzeVue(scriptSetup: string) {
    const code = `<script setup lang="tsx">\n${scriptSetup}\n</script>`;
    const config = resolvePluginConfig({ mode: 'warn', customRules: builtinRules });
    const engine = new LeakDetectorEngine(config);
    return engine.analyze('App.vue', code, extractVue(code));
  }

  it('does not crash on TypeScript annotations in Vue script setup', () => {
    const diagnostics = analyzeVue(`const id: number = setInterval(() => {}, 1000);`);
    const leaked = diagnostics.filter((d) => d.ruleId === 'generic/no-uncleared-timers');
    expect(leaked).toHaveLength(1);
  });

  it('does not crash on JSX in Vue script setup', () => {
    const diagnostics = analyzeVue(`const el = <div>{foo}</div>;`);
    expect(diagnostics).toHaveLength(0);
  });

  it('parses TypeScript from a Svelte <script lang="ts"> with the engine', () => {
    const code = `<script lang="ts">\nconst id: number = setInterval(() => {}, 1000);\n</script>`;
    const config = resolvePluginConfig({ mode: 'warn', customRules: builtinRules });
    const engine = new LeakDetectorEngine(config);
    const diagnostics = engine.analyze('App.svelte', code, extractSvelte(code));
    const leaked = diagnostics.filter((d) => d.ruleId === 'generic/no-uncleared-timers');
    expect(leaked).toHaveLength(1);
  });

  it('falls back to tsx dialect for unknown extensions', () => {
    const { ast, errors } = parseCode('const x: number = 1;', 'app.custom');
    expect(ast).not.toBeNull();
    expect(errors).toHaveLength(0);
  });
});