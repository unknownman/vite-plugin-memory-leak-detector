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
 * OXC emits oxc-specific node names (`StaticMemberExpression`,
 * `ComputedMemberExpression`, `FunctionBody`) and no `loc` field. This reviver
 * runs inline while hydrating the serialized AST via `JSON.parse`, so the
 * lightweight ESTree normalization happens in the same single pass as
 * hydration — no separate recursive traversal of the tree is needed.
 */
function reviveOxcAst(key: string, value: unknown, lineStarts: number[]): unknown {
  if (!value || typeof value !== 'object') return value;
  const type = (value as { type?: unknown }).type;
  if (typeof type !== 'string') return value;

  const node = value as Record<string, unknown>;
  if (type === 'StaticMemberExpression' || type === 'ComputedMemberExpression') {
    // Add ESTree-standard member expression names.
    node['type'] = 'MemberExpression';
    // ComputedMemberExpression was computed; StaticMemberExpression was not.
    node['computed'] = type === 'ComputedMemberExpression';
    // OXC names the computed member's key `expression`; ESTree (and the rules)
    // expect `property`.
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

  // Attach a lazy loc getter so line numbers are only computed on demand.
  if (typeof node['start'] === 'number') {
    attachLazyLoc(node, lineStarts);
  }

  return value;
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
 * Safely parses code into an ESTree AST using OXC.
 * Type normalization happens during JSON hydration via a reviver, and `loc`
 * data is attached lazily (only computed when a rule reports a diagnostic).
 * Returns the AST and any parsing errors encountered.
 */
export function parseCode(code: string, filename = 'module.tsx'): ParseResult {
  try {
    const result = parseSync(code, {
      sourceType: 'module',
      sourceFilename: toParsableFilename(filename),
    });

    const errors = (result.errors ?? []).map((e) => new Error(String(e) || 'Parse error'));
    if (!result.program) {
      return { ast: null, errors: errors.length ? errors : [new Error('Failed to parse code')] };
    }

    const lineStarts = buildLineStarts(code);
    // OXC serializes the AST as a JSON string; hydrate and normalize it in one pass.
    const ast: Program = JSON.parse(result.program, (key, value) =>
      reviveOxcAst(key, value, lineStarts)
    );
    if (!ast || ast.type !== 'Program') {
      return { ast: null, errors: errors.length ? errors : [new Error('Failed to parse code')] };
    }

    return { ast, errors };
  } catch (error) {
    return {
      ast: null,
      errors: [new Error((error as Error).message || 'Failed to parse code')],
    };
  }
}