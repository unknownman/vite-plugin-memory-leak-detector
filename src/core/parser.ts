import { parse as babelParse, type ParserOptions } from '@babel/parser';
import type { Node } from '@babel/types';

const DEFAULT_PARSER_OPTIONS: ParserOptions = {
  sourceType: 'module',
  plugins: [
    'jsx',
    'typescript',
    'decorators-legacy',
    'classProperties',
    'classPrivateProperties',
    'classPrivateMethods',
    'classStaticBlock',
    'exportDefaultFrom',
    'exportNamespaceFrom',
    'optionalChaining',
    'nullishCoalescingOperator',
    'jsonStrings',
    'importMeta',
    'topLevelAwait',
  ],
  errorRecovery: true,
};

export interface ParseResult {
  ast: Node;
  errors: Error[];
}

/**
 * Safely parses code into a Babel AST.
 * Returns the AST and any parsing errors encountered.
 */
export function parseCode(
  code: string,
  options?: Partial<ParserOptions>
): ParseResult {
  const errors: Error[] = [];
  
  try {
    const ast = babelParse(code, {
      ...DEFAULT_PARSER_OPTIONS,
      ...options,
    });
    
    return { ast, errors };
  } catch (error) {
    // If parsing fails, try with more relaxed options
    try {
      const ast = babelParse(code, {
        ...DEFAULT_PARSER_OPTIONS,
        ...options,
        errorRecovery: true,
        strictMode: false,
      });
      
      return { ast, errors };
    } catch (fallbackError) {
      // Return a minimal error result
      return {
        ast: {
          type: 'File',
          start: 0,
          end: code.length,
          loc: {
            start: { line: 1, column: 0, index: 0 },
            end: { line: 1, column: 0, index: 0 },
          } as Node['loc'],
          program: {
            type: 'Program',
            start: 0,
            end: code.length,
            loc: {
              start: { line: 1, column: 0, index: 0 },
              end: { line: 1, column: 0, index: 0 },
            } as Node['loc'],
            body: [],
            directives: [],
            sourceType: 'module',
            interpreter: null,
          },
          comments: [],
        } as Node,
        errors: [fallbackError as Error],
      };
    }
  }
}
