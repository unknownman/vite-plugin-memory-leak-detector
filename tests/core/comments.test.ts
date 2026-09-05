import { describe, it, expect } from 'vitest';
import { CommentDirectivesHandler } from '../../src/core/comments.js';

describe('CommentDirectivesHandler', () => {
  const handler = new CommentDirectivesHandler('memory-leak', true);

  it('parses ignore-next-line directive', () => {
    const code = `
// memory-leak-ignore-next-line
const timer = setInterval(() => {}, 1000);
`;
    const directives = handler.parseDirectives(code);
    expect(directives).toHaveLength(1);
    expect(directives[0].type).toBe('ignore-next-line');
    expect(directives[0].line).toBe(2);
    expect(handler.isSuppressed('any-rule', 3, directives)).toBe(true);
  });

  it('ignore-next-line targets the first code line across blank lines', () => {
    const code = `
// memory-leak-ignore-next-line
  
         
const timer = setInterval(() => {}, 1000);
`;
    const directives = handler.parseDirectives(code);
    expect(directives).toHaveLength(1);
    expect(directives[0].type).toBe('ignore-next-line');
    expect(directives[0].line).toBe(2);
    expect(directives[0].targetLine).toBe(5);
    expect(handler.isSuppressed('any-rule', 5, directives)).toBe(true);
    expect(handler.isSuppressed('any-rule', 3, directives)).toBe(false);
  });

  it('parses ignore-line directive', () => {
    const code = `
const a = 1; // memory-leak-ignore-line
const b = 2;
`;
    const directives = handler.parseDirectives(code);
    expect(directives).toHaveLength(1);
    expect(handler.isSuppressed('any-rule', 2, directives)).toBe(true);
    expect(handler.isSuppressed('any-rule', 3, directives)).toBe(false);
  });

  it('parses ignore-file directive', () => {
    const code = `
// memory-leak-ignore
const timer = setInterval(() => {}, 1000);
`;
    const directives = handler.parseDirectives(code);
    expect(directives).toHaveLength(1);
    expect(handler.isSuppressed('any-rule', 100, directives)).toBe(true);
  });

  it('parses block directives targeting specific rules', () => {
    const code = `
/* memory-leak-ignore-start generic/no-uncleared-timers */
setInterval(() => {}, 1000);
/* memory-leak-ignore-end */
`;
    const directives = handler.parseDirectives(code);
    expect(directives).toHaveLength(2);

    expect(handler.isSuppressed('generic/no-uncleared-timers', 3, directives)).toBe(true);
    expect(handler.isSuppressed('other-rule', 3, directives)).toBe(false);
  });

  it('parses multi-line block comments across newlines', () => {
    const code = `
/* memory-leak-ignore-start 
   generic/no-uncleared-timers */
setInterval(() => {}, 1000);
/* memory-leak-ignore-end 
*/
`;
    const directives = handler.parseDirectives(code);
    expect(directives).toHaveLength(2);
    expect(directives[0].type).toBe('ignore-start');
    expect(directives[0].rules).toEqual(['generic/no-uncleared-timers']);
    expect(directives[1].type).toBe('ignore-end');

    expect(handler.isSuppressed('generic/no-uncleared-timers', 4, directives)).toBe(true);
    expect(handler.isSuppressed('other-rule', 4, directives)).toBe(false);
  });

  it('parses multi-line block comment without rules (all rules ignored)', () => {
    const code = `
/* memory-leak-ignore-start 
*/
setInterval(() => {}, 1000);
/* memory-leak-ignore-end */
`;
    const directives = handler.parseDirectives(code);
    expect(directives).toHaveLength(2);
    expect(directives[0].type).toBe('ignore-start');
    expect(directives[0].rules).toEqual([]);
    expect(handler.isSuppressed('any-rule', 4, directives)).toBe(true);
  });

  it('does not suppress when disabled', () => {
    const disabled = new CommentDirectivesHandler('memory-leak', false);
    const code = `
// memory-leak-ignore-next-line
const timer = setInterval(() => {}, 1000);
`;
    const directives = disabled.parseDirectives(code);
    expect(directives).toHaveLength(0);
    expect(disabled.isSuppressed('any-rule', 3, directives)).toBe(false);
  });

  it('returns empty directives when disabled', () => {
    const disabled = new CommentDirectivesHandler('memory-leak', false);
    expect(disabled.parseDirectives(`// memory-leak-ignore`)).toHaveLength(0);
  });
});
