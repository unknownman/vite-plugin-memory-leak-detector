import type { ExtractionResult } from '../../types/rule.js';
import { parseScriptBlocks } from './scanner.js';

/**
 * Extracts JavaScript from a Svelte component.
 *
 * Handles plain `<script>` and `<script context="module">` blocks.
 * Computes line/column offsets so reported diagnostics map perfectly
 * back to the original `.svelte` file coordinates.
 *
 * LIMITATIONS:
 * - If a file contains BOTH `<script>` and `<script context="module">`,
 *   this currently prefers the instance `<script>` block, skipping the
 *   module-scoped block analysis.
 */
export function extractSvelte(code: string): ExtractionResult {
  try {
    const blocks = parseScriptBlocks(code);

    if (blocks.length === 0) {
      return { code: '', lineOffset: 0, columnOffset: 0 };
    }

    // Prefer component instance scripts over module-context scripts
    const instanceBlock = blocks.find((b) => !/\bcontext=["']module["']/.test(b.attrs));
    const block = instanceBlock || blocks[0];

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
