import type { ExtractionResult } from '../../types/rule.js';
import { buildLineStarts, offsetToPosition } from '../parser.js';
import { stitchBlocks, langToExtension, type StitchedBlock } from './stitch.js';

interface VueSfcBlock {
  content?: string;
  lang?: string;
  loc?: { start?: { offset?: number } };
}

interface VueCompilerSfc {
  parse(source: string, options?: unknown): {
    descriptor: { script?: VueSfcBlock | null; scriptSetup?: VueSfcBlock | null };
    errors?: unknown[];
  };
}

let vueCompilerPromise: Promise<VueCompilerSfc> | null = null;

/**
 * Lazily loads `vue/compiler-sfc` (an optional peer dependency). The promise is
 * cached so the dynamic import only happens once per process.
 */
function loadVueCompiler(): Promise<VueCompilerSfc> {
  if (!vueCompilerPromise) {
    vueCompilerPromise = import('vue/compiler-sfc') as Promise<VueCompilerSfc>;
  }
  return vueCompilerPromise;
}

const EMPTY: ExtractionResult = { code: '', lineOffset: 0, columnOffset: 0 };

/**
 * Extracts JavaScript from a Vue Single File Component using the official
 * `vue/compiler-sfc` parser.
 *
 * Stitches together ALL <script> bodies (both plain `<script>` and
 * `<script setup>` blocks). Every block is padded back to its exact original
 * line/column (derived from the compiler-provided AST locations), so reported
 * diagnostics map perfectly to the `.vue` file with lineOffset/columnOffset of
 * 0. Plain `<script>` blocks are stitched first so imports that live there stay
 * at the top of the synthetic module.
 *
 * If `vue` is not installed (e.g. the consumer only deals with vanilla JS),
 * the dynamic import fails gracefully and an empty extraction is returned —
 * without crashing the Vite build.
 */
export async function extractVue(code: string): Promise<ExtractionResult> {
  try {
    const { parse } = await loadVueCompiler();
    const { descriptor } = parse(code);
    const lineStarts = buildLineStarts(code);

    const blocks: StitchedBlock[] = [];
    for (const block of [descriptor.script, descriptor.scriptSetup]) {
      if (!block || !block.content || block.content.trim() === '') continue;
      const offset = block.loc?.start?.offset ?? -1;
      const pos =
        offset >= 0 ? offsetToPosition(offset, lineStarts) : { line: 1, column: 0 };
      blocks.push({
        content: block.content,
        line: pos.line,
        column: pos.column,
        extension: langToExtension(block.lang),
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
    // vue/compiler-sfc is unavailable (not installed) or the SFC is malformed.
    // Failsafe: never crash the build.
    return EMPTY;
  }
}