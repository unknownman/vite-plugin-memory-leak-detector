import type { ExtractionResult } from '../../types/rule.js';

const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;

/**
 * Extracts JavaScript from a Vue Single File Component.
 *
 * Handles both plain `<script>` and `<script setup>` blocks.
 * Computes line/column offsets so reported diagnostics refer to the
 * actual location in the original `.vue` file.
 */
export function extractVue(code: string): ExtractionResult {
  // When multiple script blocks exist, `<script setup>` takes precedence
  // for analysis. Collect all blocks and prefer the one that best matches.
  const blocks: { match: RegExpExecArray; attrs: string; body: string }[] = [];
  let match: RegExpExecArray | null;

  while ((match = SCRIPT_RE.exec(code)) !== null) {
    const attrs = match[1] || '';
    const body = match[2] || '';
    blocks.push({ match, attrs, body });
  }

  if (blocks.length === 0) {
    return { code: '', lineOffset: 0, columnOffset: 0 };
  }

  // Prefer `<script setup>` if present.
  const setupBlock = blocks.find((b) => b.attrs.includes('setup'));
  const block = setupBlock || blocks[0];
  const openingTag = block.match[0];

  // Compute line offset: count newlines before the opening script tag.
  const beforeMatch = code.slice(0, block.match.index);
  const lineOffset = beforeMatch.split('\n').length - 1;

  // Compute column offset for the open tag line.
  const lastNewlineIndex = beforeMatch.lastIndexOf('\n');
  const columnOffset = lastNewlineIndex === -1 ? beforeMatch.length : beforeMatch.length - lastNewlineIndex - 1;

  // Strip surrounding newlines from the body so the script content starts
  // cleanly. The leading `\n` we prepend keeps the body's first line at
  // AST line 2, making the offset math deterministic regardless of whether
  // the extracted body begins with a newline.
  const body = block.body.replace(/^\n+/, '');

  return {
    code: `\n${body}`,
    lineOffset,
    // Account for the `<script ...>` opening tag position on the first line.
    columnOffset: columnOffset + openingTag.length,
  };
}
