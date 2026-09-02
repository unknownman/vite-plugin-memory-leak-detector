import type { NodePath } from '@babel/traverse';
import type { CallExpression, Identifier } from '@babel/types';
import { isIdentifier, isVariableDeclarator, isAssignmentExpression } from '@babel/types';
import type { RuleContext, RuleDefinition } from '../../types/rule.js';

/**
 * Detects `setInterval` / `setTimeout` calls whose timer handle is not
 * cleared by a corresponding clear call in the same file.
 */
export const noUnclearedTimersRule: RuleDefinition = {
  id: 'generic/no-uncleared-timers',
  description: 'Detects setInterval/setTimeout calls without a matching clear call.',
  category: 'generic',
  defaultSeverity: 'warn',

  create(context: RuleContext) {
    const fileCode = context.code;
    const clearedBindings = new Set<string>();

    // Pre-scan for clearInterval/clearTimeout calls so we know which bindings
    // are already cleaned up.
    for (const clearName of ['clearInterval', 'clearTimeout']) {
      // Heuristic: the clear call must reference an identifier.
      const pattern = new RegExp(`${clearName}[\\s]*\\(\\s*([A-Za-z_$][\\w$]*)\\s*\\)`, 'g');
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(fileCode)) !== null) {
        clearedBindings.add(m[1]);
      }
    }

    function getCallName(node: CallExpression): string | null {
      return isIdentifier(node.callee) ? node.callee.name : null;
    }

    return {
      CallExpression(path: NodePath<CallExpression>) {
        const name = getCallName(path.node);
        if (!name) return;
        if (name !== 'setInterval' && name !== 'setTimeout') return;

        // Determine the variable binding that receives the timer handle.
        const parent = path.parent;
        let bindingName: string | null = null;

        if (isVariableDeclarator(parent) && isIdentifier(parent.id)) {
          bindingName = parent.id.name;
        } else if (isAssignmentExpression(parent) && isIdentifier(parent.left)) {
          bindingName = parent.left.name;
        }

        if (bindingName && clearedBindings.has(bindingName)) return;

        const line = path.node.loc?.start.line ?? 1;
        const column = path.node.loc?.start.column ?? 0;

        context.report({
          ruleId: 'generic/no-uncleared-timers',
          message: `'${name}' is called but its timer handle is never cleared. This can cause a memory leak if the component is unmounted or the scope ends.`,
          suggestion:
            'Store the timer handle in a variable and call clearInterval/clearTimeout in the appropriate cleanup (e.g., unmount or teardown).',
          severity: 'warn',
          line,
          column,
        });
      },
    };
  },
};
