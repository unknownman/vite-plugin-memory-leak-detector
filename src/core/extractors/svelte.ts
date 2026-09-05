import type { ExtractionResult } from '../../types/rule.js';
import { parseScriptBlocks, stitchScriptBlocks } from './scanner.js';

/**
 * Extracts JavaScript from a Svelte component.
 *
 * Stitches together ALL <script> bodies (both `<script>` and
 * `<script context="module">` blocks). Every block is padded back to its exact
 * original line/column, so reported diagnostics map perfectly to the `.svelte`
 * file with lineOffset/columnOffset of 0. Module-context scripts are stitched
 * first so their imports stay at the top of the synthetic module; instance
 * scripts follow.
 */
export function extractSvelte(code: string): ExtractionResult {
  try {
    const blocks = parseScriptBlocks(code);

    const stitched = stitchScriptBlocks(code, [
      ...blocks.filter((b) => /\bcontext=["']module["']/.test(b.attrs)),
      ...blocks.filter((b) => !/\bcontext=["']module["']/.test(b.attrs)),
    ]);

    if (!stitched) {
      return { code: '', lineOffset: 0, columnOffset: 0 };
    }

    return {
      code: stitched.code,
      lineOffset: 0,
      columnOffset: 0,
      inferredExtension: stitched.inferredExtension,
    };
  } catch (error) {
    // Failsafe: Never crash the build due to a malformed SFC
    return { code: '', lineOffset: 0, columnOffset: 0 };
  }
}