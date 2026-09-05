import type { ExtractionResult } from '../../types/rule.js';
import { buildLineStarts, offsetToPosition } from '../parser.js';
import { stitchBlocks, langToExtension, type StitchedBlock } from './stitch.js';

interface SvelteScriptNode {
  content?: { start?: number; end?: number } | null;
  attributes?: Array<{ name?: string; value?: Array<{ data?: string }> | { data?: string } | string }>;
}

interface SvelteCompiler {
  parse(source: string, options?: unknown): {
    instance?: SvelteScriptNode | null;
    module?: SvelteScriptNode | null;
  };
}

let svelteCompilerPromise: Promise<SvelteCompiler> | null = null;

/**
 * Lazily loads `svelte/compiler` (an optional peer dependency). The promise is
 * cached so the dynamic import only happens once per process.
 */
function loadSvelteCompiler(): Promise<SvelteCompiler> {
  if (!svelteCompilerPromise) {
    svelteCompilerPromise = import('svelte/compiler') as Promise<SvelteCompiler>;
  }
  return svelteCompilerPromise;
}

const EMPTY: ExtractionResult = { code: '', lineOffset: 0, columnOffset: 0 };

function scriptLang(script: SvelteScriptNode): string | null {
  const langAttr = (script.attributes ?? []).find((a) => a && a.name === 'lang');
  if (!langAttr || langAttr.value == null) return null;
  const value = langAttr.value;
  if (Array.isArray(value) && value[0]) return value[0].data ?? null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && 'data' in value) return (value as { data?: string }).data ?? null;
  return null;
}

/**
 * Extracts JavaScript from a Svelte component using the official
 * `svelte/compiler` parser.
 *
 * Stitches together ALL <script> bodies (both `<script>` and
 * `<script context="module">` blocks). Every block is padded back to its exact
 * original line/column (derived from the compiler-provided AST offsets), so
 * reported diagnostics map perfectly to the `.svelte` file with
 * lineOffset/columnOffset of 0. Module-context scripts are stitched first so
 * their imports stay at the top of the synthetic module.
 *
 * If `svelte` is not installed, the dynamic import fails gracefully and an
 * empty extraction is returned — without crashing the Vite build.
 */
export async function extractSvelte(code: string): Promise<ExtractionResult> {
  try {
    const { parse } = await loadSvelteCompiler();
    const ast = parse(code, { modern: true });
    const lineStarts = buildLineStarts(code);

    const blocks: StitchedBlock[] = [];
    for (const script of [ast.module, ast.instance]) {
      if (!script || !script.content) continue;
      const { start, end } = script.content;
      if (typeof start !== 'number' || typeof end !== 'number') continue;
      const content = code.slice(start, end);
      if (content.trim() === '') continue;

      const pos = offsetToPosition(start, lineStarts);
      blocks.push({
        content,
        line: pos.line,
        column: pos.column,
        extension: langToExtension(scriptLang(script)),
      });
    }

    const stitched = stitchBlocks(blocks);
    if (!stitched) return EMPTY;

    return {
      code: stitched.code,
      lineOffset: 0,
      columnOffset: 0,
      inferredExtension: stitched.inferredExtension,
    };
  } catch (error) {
    // svelte/compiler is unavailable (not installed) or the component is
    // malformed. Failsafe: never crash the build.
    return EMPTY;
  }
}