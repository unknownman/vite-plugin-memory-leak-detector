import { buildLineStarts, offsetToPosition } from '../parser.js';

export interface ScriptBlock {
  attrs: string;
  bodyStart: number;
  bodyEnd: number;
}

export type InferredExtension = 'js' | 'ts' | 'jsx' | 'tsx';

export interface StitchedScript {
  code: string;
  inferredExtension: InferredExtension;
}

const EXTENSION_PRIORITY: Record<InferredExtension, number> = {
  tsx: 4,
  ts: 3,
  jsx: 2,
  js: 1,
};

function langToExtension(lang: string | null): InferredExtension {
  switch (lang) {
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

/**
 * Extracts the value of the `lang` attribute (e.g. `lang="ts"`) from a
 * <script> tag's attribute string, or null when absent.
 */
export function getScriptLang(attrs: string): string | null {
  const match = /lang\s*=\s*["']([^"']+)["']/i.exec(attrs);
  return match ? match[1].toLowerCase() : null;
}

/**
 * A robust, lightweight state-machine scanner to find <script> blocks.
 *
 * Overcomes RegExp limitations by understanding JavaScript strings and comments
 * inside the script body. This ensures nested or malformed-looking tags inside
 * strings/comments (e.g., `const str = "</script>"` or `/* </script> *​/`)
 * don't prematurely break the extraction.
 *
 * LIMITATIONS:
 * - Does not implement full recursive descent for JS template literals with complex
 *   nested expressions (e.g., `` `${'</script>'}` ``).
 * - Ignores standard HTML comments outside scripts, but might be confused by highly
 *   malformed HTML or archaic IE conditional comments.
 */
export function parseScriptBlocks(code: string): ScriptBlock[] {
  const blocks: ScriptBlock[] = [];
  let i = 0;

  while (i < code.length) {
    const nextScript = code.indexOf('<script', i);
    const nextComment = code.indexOf('<!--', i);

    if (nextScript === -1) break;

    // Skip over HTML comments to avoid parsing <script> inside them
    if (nextComment !== -1 && nextComment < nextScript) {
      const endComment = code.indexOf('-->', nextComment + 4);
      i = endComment !== -1 ? endComment + 3 : code.length;
      continue;
    }

    // Validate tag boundary (must be space, >, or empty after <script)
    const nextChar = code[nextScript + 7];
    if (nextChar && !/[\s>]/i.test(nextChar)) {
      i = nextScript + 7;
      continue;
    }

    const attrStart = nextScript + 7;
    const tagEnd = code.indexOf('>', attrStart);
    if (tagEnd === -1) break; // Malformed HTML, bail out

    const attrs = code.slice(attrStart, tagEnd);
    const bodyStart = tagEnd + 1;

    // JS Tokenizer state to safely find </script>
    let bodyEnd = -1;
    let j = bodyStart;
    let inQuote: string | null = null;
    let inLineComment = false;
    let inBlockComment = false;

    while (j < code.length) {
      const char = code[j];
      const next = code[j + 1];

      if (inBlockComment) {
        if (char === '*' && next === '/') {
          inBlockComment = false;
          j++; // Advance extra char
        }
      } else if (inLineComment) {
        if (char === '\n' || char === '\r') {
          inLineComment = false;
        }
      } else if (inQuote) {
        if (char === '\\') {
          j++; // Skip escaped character (e.g., \", \')
        } else if (char === inQuote) {
          inQuote = null;
        }
      } else {
        // Not in any string or comment, look for standard tokens
        if (char === '/' && next === '*') {
          inBlockComment = true;
          j++;
        } else if (char === '/' && next === '/') {
          inLineComment = true;
          j++;
        } else if (char === '"' || char === "'" || char === '`') {
          inQuote = char;
        } else if (char === '<' && code.substring(j, j + 9).toLowerCase() === '</script>') {
          bodyEnd = j;
          break; // Successfully found the safe end of the script!
        }
      }
      j++;
    }

    if (bodyEnd !== -1) {
      blocks.push({ attrs, bodyStart, bodyEnd });
      i = bodyEnd + 9; // skip past </script>
    } else {
      // Unclosed script tag, bail out
      break;
    }
  }

  return blocks;
}

/**
 * Merges `blocks` (in the given display order) into a single synthetic module,
 * inserting leading newlines and spaces before each block so every block body
 * starts at its exact original line/column in the source file. Because each
 * block is padded back to its own coordinates, the caller can use
 * lineOffset/columnOffset of 0 and reported line numbers will match the
 * original `.vue`/`.svelte` file directly.
 */
export function stitchScriptBlocks(code: string, blocks: ScriptBlock[]): StitchedScript | null {
  if (blocks.length === 0) return null;

  const lineStarts = buildLineStarts(code);
  const parts: string[] = [];
  let curLine = 1;
  let curCol = 0;
  let topExtension: InferredExtension = 'js';
  let topPriority = -1;

  for (const block of blocks) {
    const pos = offsetToPosition(block.bodyStart, lineStarts);
    const padLines = Math.max(0, pos.line - curLine);
    if (padLines > 0) {
      parts.push('\n'.repeat(padLines));
      curLine += padLines;
      curCol = 0;
    }
    const padCols = pos.column - curCol;
    if (padCols > 0) {
      parts.push(' '.repeat(padCols));
      curCol += padCols;
    }

    const body = code.slice(block.bodyStart, block.bodyEnd);
    parts.push(body);
    for (const ch of body) {
      if (ch === '\n' || ch === '\r') {
        curLine++;
        curCol = 0;
      } else {
        curCol++;
      }
    }

    const extension = langToExtension(getScriptLang(block.attrs) ?? 'js');
    const priority = EXTENSION_PRIORITY[extension];
    if (priority > topPriority) {
      topPriority = priority;
      topExtension = extension;
    }
  }

  return { code: parts.join(''), inferredExtension: topExtension };
}
