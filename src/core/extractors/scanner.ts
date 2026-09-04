export interface ScriptBlock {
  attrs: string;
  bodyStart: number;
  bodyEnd: number;
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
