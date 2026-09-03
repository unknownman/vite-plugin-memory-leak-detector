import type { RuleContext, RuleDefinition } from '../../types/rule.js';

export const noUnsubscribedEventsRule: RuleDefinition = {
  id: 'generic/no-unsubscribed-events',
  description: 'Detects reactive subscriptions (.subscribe / .on) without unsubscribe.',
  category: 'generic',
  defaultSeverity: 'warn',

  create(context: RuleContext) {
    const subs: { method: string; node: any }[] = [];
    let hasUnsubscribe = false;

    return {
      CallExpression(node: any) {
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.property.type === 'Identifier'
        ) {
          const name = node.callee.property.name;
          if (name === 'subscribe' || name === 'on') subs.push({ method: name, node });
          if (name === 'unsubscribe' || name === 'off') hasUnsubscribe = true;
        }
      },
      'Program:exit'() {
        if (!hasUnsubscribe && subs.length > 0) {
          for (const sub of subs) {
            context.report({
              ruleId: 'generic/no-unsubscribed-events',
              message: `A subscription using '.${sub.method}()' is created but never unsubscribed.`,
              suggestion: `Store the subscription and call '.unsubscribe()' or '.off()' to clean it up.`,
              line: sub.node.loc?.start?.line ?? 1,
              column: sub.node.loc?.start?.column ?? 0,
            });
          }
        }
      },
    };
  },
};
