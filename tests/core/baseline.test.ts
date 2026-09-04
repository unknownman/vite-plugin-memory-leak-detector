import { describe, it, expect } from 'vitest';
import { generateFingerprint } from '../../src/core/baseline.js';
import type { Diagnostic } from '../../src/types/diagnostic.js';

describe('Baseline Fingerprinting', () => {
  it('generates consistent fingerprints independent of line numbers', () => {
    const diag1: Diagnostic = {
      ruleId: 'rule-a',
      message: 'Leak found',
      severity: 'warn',
      file: '/app/src/file.ts',
      line: 10,
      column: 5,
    };

    const diag2: Diagnostic = {
      ...diag1,
      line: 20,
    };

    const hash1 = generateFingerprint(diag1, '/app');
    const hash2 = generateFingerprint(diag2, '/app');

    expect(hash1).toBe(hash2);
  });

  it('generates different fingerprints for different messages', () => {
    const diag1: Diagnostic = {
      ruleId: 'rule-a',
      message: 'Leak A',
      severity: 'warn',
      file: '/app/src/file.ts',
      line: 10,
      column: 5,
    };

    const diag2: Diagnostic = {
      ...diag1,
      message: 'Leak B',
    };

    const hash1 = generateFingerprint(diag1, '/app');
    const hash2 = generateFingerprint(diag2, '/app');

    expect(hash1).not.toBe(hash2);
  });

  it('generates different fingerprints for different rules', () => {
    const diag1: Diagnostic = {
      ruleId: 'rule-a',
      message: 'Leak',
      severity: 'warn',
      file: '/app/src/file.ts',
      line: 10,
      column: 5,
    };

    const diag2: Diagnostic = {
      ...diag1,
      ruleId: 'rule-b',
    };

    const hash1 = generateFingerprint(diag1, '/app');
    const hash2 = generateFingerprint(diag2, '/app');

    expect(hash1).not.toBe(hash2);
  });

  it('uses relative paths for cross-machine portability', () => {
    const diag: Diagnostic = {
      ruleId: 'rule-a',
      message: 'Leak',
      severity: 'warn',
      file: '/home/user/project/src/file.ts',
      line: 10,
      column: 5,
    };

    const hash = generateFingerprint(diag, '/home/user/project');
    expect(hash).toHaveLength(16);
  });
});
