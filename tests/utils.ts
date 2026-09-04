import { walk } from 'estree-walker';
import { parseCode } from '../src/core/parser.js';
import type { RuleDefinition, RuleContext } from '../src/types/rule.js';
import type { Diagnostic } from '../src/types/diagnostic.js';

interface RunRuleOptions {
  allowlist?: { functions?: string[]; methods?: string[] };
  filename?: string;
}

/**
 * Runs a single rule against a string of code.
 * Useful for fast, isolated unit testing of rules.
 */
export function runRule(
  rule: RuleDefinition,
  code: string,
  options: RunRuleOptions = {}
): Diagnostic[] {
  const { ast, errors } = parseCode(code, options.filename || 'test.ts');
  if (!ast || errors.length > 0) throw new Error(`Parse error: ${errors[0]?.message}`);

  const diagnostics: Diagnostic[] = [];
  const allowlistFuncs = options.allowlist?.functions || [];
  const allowlistMethods = options.allowlist?.methods || [];

  const context: RuleContext = {
    file: options.filename || 'test.ts',
    code,
    ast,
    isAllowlisted: (name, type) => {
      if (type === 'function') return allowlistFuncs.includes(name);
      return allowlistMethods.includes(name);
    },
    report: (diag) => diagnostics.push(diag as Diagnostic),
  };

  const visitor = rule.create(context);

  walk(ast, {
    enter(node: any, parent: any) {
      if (visitor[node.type]) visitor[node.type](node, parent);
    },
    leave(node: any, parent: any) {
      const exitKey = `${node.type}:exit`;
      if (visitor[exitKey]) visitor[exitKey](node, parent);
    },
  });

  return diagnostics;
}
