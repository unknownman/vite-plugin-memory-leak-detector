import type { ExtractionResult } from '../../types/rule.js';
import { parseScriptBlocks, stitchScriptBlocks } from './scanner.js';

/**
 * Extracts JavaScript from a Vue Single File Component.
 *
 * Stitches together ALL <script> bodies (both plain `<script>` and
 * `<script setup>` blocks). Every block is padded back to its exact original
 * line/column, so reported diagnostics map perfectly to the `.vue` file with
 * lineOffset/columnOffset of 0. Plain `<script>` blocks are stitched first so
 * imports that live there stay at the top of the synthetic module (keeps
 * top-level imports valid for the parser); `<script setup>` bodies follow.
 */
export function extractVue(code: string): ExtractionResult {
  try {
    const blocks = parseScriptBlocks(code);

    const stitched = stitchScriptBlocks(code, [
      ...blocks.filter((b) => !/\bsetup\b/.test(b.attrs)),
      ...blocks.filter((b) => /\bsetup\b/.test(b.attrs)),
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