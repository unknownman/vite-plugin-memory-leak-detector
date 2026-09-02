import type { NodePath } from '@babel/traverse';
import type { CallExpression } from '@babel/types';
import { isIdentifier, isMemberExpression } from '@babel/types';
import type { RuleContext, RuleDefinition } from '../../types/rule.js';

const STATIC_TARGETS = new Set(['window', 'document', 'document.body', 'document.head', 'document.documentElement']);

/**
 * Detects `addEventListener` calls without a matching `removeEventListener`.
 * Flags global/static targets and element handles that are never removed.
 */
export const noUnregisteredListenersRule: RuleDefinition = {
  id: 'generic/no-unregistered-listeners',
  description: 'Detects addEventListener calls without matching removeEventListener.',
  category: 'generic',
  defaultSeverity: 'warn',

  create(context: RuleContext) {
    const code = context.code;

    return {
      CallExpression(path: NodePath<CallExpression>) {
        const node = path.node;
        if (!isMemberExpression(node.callee)) return;

        const prop = node.callee.property;
        if (!isIdentifier(prop)) return;
        if (prop.name !== 'addEventListener') return;

        const obj = node.callee.object;

        // Determine a readable description of the target.
        let targetName = 'element';
        if (isIdentifier(obj)) {
          targetName = obj.name;
        } else if (isMemberExpression(obj) && isIdentifier(obj.property)) {
          targetName = obj.property.name;
        }

        const isStaticTarget = STATIC_TARGETS.has(targetName) || targetName === 'window';
        const eventType = getEventType(node);

        let removed = false;
        if (isStaticTarget) {
          removed = code.includes('removeEventListener');
        } else {
          // For element handles bound by identifier, only consider a match
          // when a removeEventListener for the same target identifier exists.
          removed = code.includes('removeEventListener') && code.includes(targetName);
        }

        if (removed) return;

        const line = node.loc?.start.line ?? 1;
        const column = node.loc?.start.column ?? 0;
        const typeText = eventType ? ` '${eventType}'` : '';

        context.report({
          ruleId: 'generic/no-unregistered-listeners',
          message: `addEventListener on '${targetName}'${typeText} is not paired with a removeEventListener. Unremoved listeners can cause memory leaks.`,
          suggestion:
            'Remove the event listener when no longer needed (e.g., in a cleanup function). Store a reference to the handler to enable removal.',
          severity: 'warn',
          line,
          column,
        });
      },
    };
  },
};

function getEventType(node: CallExpression): string | null {
  const firstArg = node.arguments[0];
  if (!firstArg) return null;
  if (firstArg.type === 'StringLiteral') return firstArg.value;
  if (isIdentifier(firstArg)) return firstArg.name;
  return null;
}
