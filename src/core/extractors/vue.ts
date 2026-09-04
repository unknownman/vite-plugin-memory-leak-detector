import type { ExtractionResult } from '../../types/rule.js';
import { parseScriptBlocks } from './scanner.js';

/**
 * Extracts JavaScript from a Vue Single File Component.
 *
 * Handles both plain `<script>` and `<script setup>` blocks accurately.
 * Computes exact line/column offsets so reported diagnostics refer to the
 * precise location in the original `.vue` file.
 *
 * LIMITATIONS:
 * - If a file contains BOTH `<script setup>` and `<script>`, this extractor
 *   currently only analyzes the `<script setup>` block, as memory leaks
 *   are overwhelmingly concentrated in instance/setup logic.
 */
export function extractVue(code: string): ExtractionResult {
  try {
    const blocks = parseScriptBlocks(code);

    if (blocks.length === 0) {
      return { code: '', lineOffset: 0, columnOffset: 0 };
    }

    // Prefer <script setup> over a standard <script> block
    const setupBlock = blocks.find((b) => /\bsetup\b/.test(b.attrs));
    const block = setupBlock || blocks[0];

    // Compute Exact Offsets
    const prefix = code.slice(0, block.bodyStart);
    const lineOffset = prefix.split('\n').length - 1;

    const lastNewline = prefix.lastIndexOf('\n');
    const columnOffset = lastNewline === -1 ? block.bodyStart : block.bodyStart - lastNewline - 1;

    return {
      code: code.slice(block.bodyStart, block.bodyEnd),
      lineOffset,
      columnOffset,
    };
  } catch (error) {
    // Failsafe: Never crash the build due to a malformed SFC
    return { code: '', lineOffset: 0, columnOffset: 0 };
  }
}
