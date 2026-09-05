import { parseSync } from 'oxc-parser';
import type { Program, Position, SourceLocation } from 'estree';

export interface ParseResult {
  ast: Program | null;
  errors: Error[];
}

/**
 * Builds an array of byte offsets where each line starts (index 0 marks line 1).
 * Used by `offsetToPosition` to translate raw `start`/`end` offsets into
 * line/column pairs without recomputing per node.
 */
export function buildLineStarts(code: string): number[] {
  const starts = [0];
  for (let i = 0; i < code.length; i++) {
    if (code.charCodeAt(i) === 10 /* \n */) {
      starts.push(i + 1);
    } else if (code.charCodeAt(i) === 13 /* \r */) {
      if (code.charCodeAt(i + 1) === 10) i++;
      starts.push(i + 1);
    }
  }
  return starts;
}

/**
 * Converts a code offset into a 1-based line / 0-based column position using a
 * binary search over the precomputed line starts.
 */
export function offsetToPosition(offset: number, lineStarts: number[]): Position {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (lineStarts[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  const lineStart = lineStarts[low];
  return {
    line: low + 1,
    column: offset - lineStart,
  };
}

/**
 * Attaches a lazily-computed, non-enumerable `loc` property to an AST node.
 * `start`/`end` offsets are translated to line/column only when the property is
 * actually read (typically when a rule calls `context.report`), so line numbers
 * are never computed for the vast majority of leak-free nodes.
 */
function attachLazyLoc(node: Record<string, unknown>, lineStarts: number[]): void {
  if (!Object.prototype.hasOwnProperty.call(node, 'loc')) {
    let cached: SourceLocation | null = null;
    Object.defineProperty(node, 'loc', {
      enumerable: false,
      configurable: true,
      get() {
        if (cached) return cached;
        const start = node['start'] as number | undefined;
        const end = node['end'] as number | undefined;
        if (typeof start !== 'number') return null;
        cached = {
          start: offsetToPosition(start, lineStarts),
          end: offsetToPosition(typeof end === 'number' ? end : start, lineStarts),
        };
        return cached;
      },
    });
  }
}

/**
 * Normalizes an OXC native AST (returned directly as an in-memory JS object
 * graph, no JSON serialization involved) into ESTree conventions in place.
 *
 * Modern OXC already emits ESTree-friendly shapes (`MemberExpression`,
 * `BlockStatement`, a plain array of `params`), so the type coercions below are
 * defensive aliases for the oxc-specific node names emitted by older dialects.
 * The real cost of this pass is attaching the lazy `loc` getter to every node —
 * after that, traversal needs no further work. An explicit work stack keeps the
 * walk from recursing deeply and overflowing the call stack on pathological
 * inputs.
 */
export function normalizeAstInPlace(root: Record<string, unknown> | null | undefined, lineStarts: number[]): void {
  if (!root || typeof root !== 'object') return;

  const stack: Record<string, unknown>[] = [root];

  while (stack.length > 0) {
    const node = stack.pop() as Record<string, unknown>;
    if (!node || typeof node !== 'object') continue;

    const type = node['type'];
    if (typeof type === 'string') {
      if (type === 'StaticMemberExpression' || type === 'ComputedMemberExpression') {
        // OXC's pre-ESTree member names; add the standard name and `computed`.
        node['type'] = 'MemberExpression';
        node['computed'] = type === 'ComputedMemberExpression';
        // OXC names the computed member's key `expression`; ESTree (and the
        // rules) expect `property`.
        if (type === 'ComputedMemberExpression' && node['expression'] !== undefined) {
          node['property'] = node['expression'];
        }
      } else if (type === 'FunctionBody') {
        // Normalize oxc's function block body to ESTree BlockStatement.
        node['type'] = 'BlockStatement';
        const statements = node['statements'];
        if (Array.isArray(statements)) {
          node['body'] = statements;
          delete node['statements'];
        }
      }

      if (typeof node['start'] === 'number') {
        attachLazyLoc(node, lineStarts);
      }
    }

    for (const key of Object.keys(node)) {
      const value = node[key];
      if (value && typeof value === 'object') {
        if (Array.isArray(value)) {
          for (const item of value) {
            if (item && typeof item === 'object') stack.push(item as Record<string, unknown>);
          }
        } else {
          stack.push(value as Record<string, unknown>);
        }
      }
    }
  }
}

const SOURCE_EXTENSION_RE = /\.(js|jsx|mjs|cjs|ts|tsx|mts|cts)$/;

/**
 * oxc-parser picks its syntax dialect (JS/TS/JSX) from the filename extension.
 * Files whose extension is not a recognizable code extension (e.g. `.vue`,
 * `.svelte`, or none) default to TSX, which is a superset of plain JS and
 * supports both TypeScript and JSX.
 */
function toParsableFilename(filename: string): string {
  return SOURCE_EXTENSION_RE.test(filename) ? filename : `${filename}.tsx`;
}

/**
 * Safely parses code into an ESTree-compatible AST using OXC.
 *
 * OXC (>= 0.148) deserializes the AST to native JS objects directly — there is
 * no JSON round-trip — so `program` is normalized in place via
 * `normalizeAstInPlace`, which attaches lazy `loc` getters (line/column are
 * only computed when a rule reports a diagnostic).
 *
 * Returns the AST and any parsing errors encountered.
 */
export function parseCode(code: string, filename = 'module.tsx'): ParseResult {
  try {
    const result = parseSync(toParsableFilename(filename), code, {
      sourceType: 'module',
    });

    const errors = (result.errors ?? []).map((e) => {
      const message =
        typeof e === 'object' && e !== null && 'message' in e ? String(e.message) : String(e);
      return new Error(message || 'Parse error');
    });

    const program = result.program as unknown as Record<string, unknown> | null | undefined;
    if (!program || program['type'] !== 'Program') {
      return { ast: null, errors: errors.length ? errors : [new Error('Failed to parse code')] };
    }

    const lineStarts = buildLineStarts(code);
    normalizeAstInPlace(program, lineStarts);

    return { ast: program as unknown as Program, errors };
  } catch (error) {
    return {
      ast: null,
      errors: [new Error((error as Error).message || 'Failed to parse code')],
    };
  }
}