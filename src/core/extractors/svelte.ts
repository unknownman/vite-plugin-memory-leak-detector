import type { ExtractionResult } from '../../types/rule.js';

const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;

/**
 * Extracts JavaScript from a Svelte component.
 *
 * Handles plain `<script>` and `<script context="module">` blocks.
 * Computes line/column offsets so reported diagnostics refer to the
 * actual location in the original `.svelte` file.
 */
export function extractSvelte(code: string): ExtractionResult {
  const blocks: { match: RegExpExecArray; body: string }[] = [];
  let match: RegExpExecArray | null;

  while ((match = SCRIPT_RE.exec(code)) !== null) {
    blocks.push({ match, body: match[2] || '' });
  }

  if (blocks.length === 0) {
    return { code: '', lineOffset: 0, columnOffset: 0 };
  }

  const block = blocks[0];
  const openingTag = block.match[0];

  const beforeMatch = code.slice(0, block.match.index);
  const lineOffset = beforeMatch.split('\n').length - 1;

  const lastNewlineIndex = beforeMatch.lastIndexOf('\n');
  const columnOffset = lastNewlineIndex === -1 ? beforeMatch.length : beforeMatch.length - lastNewlineIndex - 1;

  const body = block.body.replace(/^\n+/, '');

  return {
    code: `\n${body}`,
    lineOffset,
    columnOffset: columnOffset + openingTag.length,
  };
}
