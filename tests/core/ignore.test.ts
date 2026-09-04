import { describe, it, expect } from 'vitest';
import { IgnoreManager } from '../../src/core/ignore.js';

describe('IgnoreManager', () => {
  it('ignores files globally by glob string', () => {
    const manager = new IgnoreManager(['**/*.test.ts']);
    expect(manager.isFileGloballyIgnored('src/components/button.test.ts')).toBe(true);
    expect(manager.isFileGloballyIgnored('src/components/button.ts')).toBe(false);
  });

  it('ignores files globally by IgnoreRule without rules array', () => {
    const manager = new IgnoreManager([{ glob: 'legacy/**' }]);
    expect(manager.isFileGloballyIgnored('legacy/old.js')).toBe(true);
    expect(manager.isFileGloballyIgnored('src/new.js')).toBe(false);
  });

  it('ignores specific rules for specific globs', () => {
    const manager = new IgnoreManager([{ glob: 'legacy/**/*.js', rules: ['rule-a'] }]);

    expect(manager.isRuleIgnoredForFile('legacy/old.js', 'rule-a')).toBe(true);
    expect(manager.isRuleIgnoredForFile('legacy/old.js', 'rule-b')).toBe(false);
    expect(manager.isRuleIgnoredForFile('src/modern.js', 'rule-a')).toBe(false);
  });

  it('handles empty ignores gracefully', () => {
    const manager = new IgnoreManager([]);
    expect(manager.isFileGloballyIgnored('any/file.ts')).toBe(false);
    expect(manager.isRuleIgnoredForFile('any/file.ts', 'any-rule')).toBe(false);
  });

  it('supports array globs in IgnoreRule', () => {
    const manager = new IgnoreManager([
      { glob: ['dist/**', 'generated/**'], rules: ['rule-x'] },
    ]);
    expect(manager.isRuleIgnoredForFile('dist/bundle.js', 'rule-x')).toBe(true);
    expect(manager.isRuleIgnoredForFile('generated/output.js', 'rule-x')).toBe(true);
    expect(manager.isRuleIgnoredForFile('src/app.js', 'rule-x')).toBe(false);
  });
});
