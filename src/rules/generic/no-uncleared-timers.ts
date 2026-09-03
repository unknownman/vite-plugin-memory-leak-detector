import type { RuleContext, RuleDefinition } from '../../types/rule.js';

export const noUnclearedTimersRule: RuleDefinition = {
  id: 'generic/no-uncleared-timers',
  description: 'Detects setInterval/setTimeout calls without a matching clear call.',
  category: 'generic',
  defaultSeverity: 'warn',

  create(context: RuleContext) {
    const timers: { type: string; node: any }[] = [];
    const clears = new Set<string>();

    return {
      CallExpression(node: any) {
        if (node.callee.type === 'Identifier') {
          const name = node.callee.name;

          // Check Allowlist!
          if (context.isAllowlisted(name, 'function')) return;

          if (name === 'setInterval' || name === 'setTimeout') {
            timers.push({ type: name, node });
          } else if (name === 'clearInterval' || name === 'clearTimeout') {
            clears.add(name);
          }
        } else if (
          node.callee.type === 'MemberExpression' &&
          node.callee.property.type === 'Identifier'
        ) {
          const name = node.callee.property.name;

          // Check Allowlist for method calls (e.g., window.setInterval)
          if (context.isAllowlisted(name, 'method')) return;

          if (name === 'clearInterval' || name === 'clearTimeout') clears.add(name);
        }
      },
      'Program:exit'() {
        for (const timer of timers) {
          const clearName = timer.type === 'setInterval' ? 'clearInterval' : 'clearTimeout';
          if (!clears.has(clearName)) {
            context.report({
              ruleId: 'generic/no-uncleared-timers',
              message: `Timer '${timer.type}' is created but never cleared.`,
              suggestion: `Assign the timer to a variable and clear it using ${clearName}() or wrap it in an auto-cleaning hook.`,
              line: timer.node.loc?.start?.line ?? 1,
              column: timer.node.loc?.start?.column ?? 0,
            });
          }
        }
      },
    };
  },
};
