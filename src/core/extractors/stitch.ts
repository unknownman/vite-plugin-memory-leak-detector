export type InferredExtension = 'js' | 'ts' | 'jsx' | 'tsx';

export interface StitchedBlock {
  /** The raw script body text (between the opening and closing tags). */
  content: string;
  /** 1-based line of the content's first character in the original file. */
  line: number;
  /** 0-based column of the content's first character in the original file. */
  column: number;
  extension: InferredExtension;
}

const EXTENSION_PRIORITY: Record<InferredExtension, number> = {
  tsx: 4,
  ts: 3,
  jsx: 2,
  js: 1,
};

export function langToExtension(lang: string | null | undefined): InferredExtension {
  switch ((lang ?? '').toLowerCase()) {
    case 'ts':
    case 'typescript':
      return 'ts';
    case 'jsx':
      return 'jsx';
    case 'tsx':
      return 'tsx';
    default:
      return 'js';
  }
}

export interface StitchedResult {
  code: string;
  inferredExtension: InferredExtension;
}

/**
 * Merges `blocks` (in the given order) into a single synthetic module,
 * inserting leading newlines and spaces before each block so every block body
 * starts at its exact original line/column in the source file. Because each
 * block is padded back to its own coordinates, the caller can use
 * lineOffset/columnOffset of 0 and reported line numbers will match the
 * original `.vue`/`.svelte` file directly.
 */
export function stitchBlocks(blocks: StitchedBlock[]): StitchedResult | null {
  if (blocks.length === 0) return null;

  const parts: string[] = [];
  let curLine = 1;
  let curCol = 0;
  let topExtension: InferredExtension = 'js';
  let topPriority = -1;

  for (const block of blocks) {
    const content = block.content ?? '';
    if (content.trim() === '') continue;

    const padLines = Math.max(0, block.line - curLine);
    if (padLines > 0) {
      parts.push('\n'.repeat(padLines));
      curLine += padLines;
      curCol = 0;
    }
    const padCols = block.column - curCol;
    if (padCols > 0) {
      parts.push(' '.repeat(padCols));
      curCol += padCols;
    }

    parts.push(content);
    for (const ch of content) {
      if (ch === '\n' || ch === '\r') {
        curLine++;
        curCol = 0;
      } else {
        curCol++;
      }
    }

    const priority = EXTENSION_PRIORITY[block.extension];
    if (priority > topPriority) {
      topPriority = priority;
      topExtension = block.extension;
    }
  }

  const code = parts.join('');
  if (code.trim() === '') return null;
  return { code, inferredExtension: topExtension };
}