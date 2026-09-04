import { parseSync } from 'oxc-parser';
import type { Program, Node, Position, SourceLocation } from 'estree';

export interface ParseResult {
  ast: Program | null;
  errors: Error[];
}

/**
 * OXC emits oxc-specific member-expression node names (StaticMemberExpression,
 * ComputedMemberExpression) and no `loc` field. This normalizer rewrites the
 * serialized AST to be fully ESTree-compliant so downstream traversal and rules
 * can rely on standard `MemberExpression` nodes and `loc` line/column info.
 */
function normalizeToEstree(program: Program, code: string): Program {
  const lineStarts = buildLineStarts(code);

  function offsetToPosition(offset: number): Position {
    // Binary search for the line that contains the offset.
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

  function normalize(node: Record<string, unknown> | null): void {
    if (!node || typeof node !== 'object') return;

    const type = node['type'] as string | undefined;
    if (typeof type !== 'string') return;

    // Add ESTree-standard member expression names.
    if (type === 'StaticMemberExpression' || type === 'ComputedMemberExpression') {
      (node as Record<string, unknown>)['type'] = 'MemberExpression';
    }

    // Normalize oxc's function block body to ESTree BlockStatement
    if (type === 'FunctionBody') {
      (node as Record<string, unknown>)['type'] = 'BlockStatement';
      const statements = node['statements'];
      if (Array.isArray(statements)) {
        (node as Record<string, unknown>)['body'] = statements;
        delete (node as Record<string, unknown>)['statements'];
      }
    }

    // Add computed flag to MemberExpression (ComputedMemberExpression was computed).
    if (type === 'ComputedMemberExpression') {
      (node as Record<string, unknown>)['computed'] = true;
    } else if ((node as Record<string, unknown>)['computed'] === undefined) {
      (node as Record<string, unknown>)['computed'] = false;
    }

    // Compute loc from start/end offsets.
    const start = node['start'] as number | undefined;
    const end = node['end'] as number | undefined;
    if (typeof start === 'number' && typeof end === 'number' && !node['loc']) {
      const loc: SourceLocation = {
        start: offsetToPosition(start),
        end: offsetToPosition(end),
      };
      (node as Record<string, unknown>)['loc'] = loc;
    }

    // Recurse into children.
    for (const key of Object.keys(node)) {
      if (key === 'loc') continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const item of value) normalize(item as Record<string, unknown> | null);
      } else if (value && typeof value === 'object') {
        normalize(value as Record<string, unknown>);
      }
    }
  }

  normalize(program as unknown as Record<string, unknown>);
  return program;
}

function buildLineStarts(code: string): number[] {
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
 * Returns the normalized AST and any parsing errors encountered.
 */
export function parseCode(code: string, filename = 'module.tsx'): ParseResult {
  try {
    const result = parseSync(code, {
      sourceType: 'module',
      sourceFilename: toParsableFilename(filename),
    });

    const errors = (result.errors ?? []).map((e) => new Error(String(e) || 'Parse error'));

    // OXC serializes the AST as a JSON string; hydrate it.
    const raw: Program = JSON.parse(result.program);
    if (!raw || raw.type !== 'Program') {
      return { ast: null, errors: errors.length ? errors : [new Error('Failed to parse code')] };
    }

    const ast = normalizeToEstree(raw, code);
    return { ast, errors };
  } catch (error) {
    return {
      ast: null,
      errors: [new Error((error as Error).message || 'Failed to parse code')],
    };
  }
}
