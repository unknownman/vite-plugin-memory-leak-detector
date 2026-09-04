import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Diagnostic } from '../types/diagnostic.js';

export interface BaselineEntry {
  fingerprint: string;
  ruleId: string;
  file: string;
  message: string;
}

export interface BaselineFile {
  version: string;
  updatedAt: string;
  issues: BaselineEntry[];
}

export function generateFingerprint(diag: Diagnostic, cwd: string = process.cwd()): string {
  // Use relative paths so baselines work across different machines/CI environments
  const relativeFile = path.relative(cwd, diag.file).replace(/\\/g, '/');

  // Hash the combination of rule, file, and message (ignoring line numbers which shift easily)
  const rawKey = `${diag.ruleId}|${relativeFile}|${diag.message}`;
  return crypto.createHash('sha256').update(rawKey).digest('hex').substring(0, 16);
}

export class BaselineManager {
  private baselinePath: string;
  private knownFingerprints = new Set<string>();

  constructor(baselinePath: string) {
    this.baselinePath = path.resolve(process.cwd(), baselinePath);
    this.load();
  }

  private load(): void {
    if (!fs.existsSync(this.baselinePath)) return;
    try {
      const raw = fs.readFileSync(this.baselinePath, 'utf-8');
      const data: BaselineFile = JSON.parse(raw);
      for (const issue of data.issues) {
        this.knownFingerprints.add(issue.fingerprint);
      }
    } catch (err) {
      console.warn(`[MemoryLeakDetector] Warning: Could not parse baseline at ${this.baselinePath}`);
    }
  }

  /**
   * Returns true if the diagnostic is already known in the baseline.
   */
  public isKnown(diag: Diagnostic): boolean {
    if (!diag.fingerprint) {
      diag.fingerprint = generateFingerprint(diag);
    }
    return this.knownFingerprints.has(diag.fingerprint);
  }

  /**
   * Writes current findings to the baseline file.
   */
  public updateBaseline(diagnostics: Diagnostic[]): void {
    const issues: BaselineEntry[] = diagnostics.map((d) => ({
      fingerprint: d.fingerprint || generateFingerprint(d),
      ruleId: d.ruleId,
      file: path.relative(process.cwd(), d.file).replace(/\\/g, '/'),
      message: d.message,
    }));

    // Deduplicate by fingerprint
    const uniqueIssues = Array.from(new Map(issues.map((item) => [item.fingerprint, item])).values());

    const content: BaselineFile = {
      version: '1.0.0',
      updatedAt: new Date().toISOString(),
      issues: uniqueIssues,
    };

    const dir = path.dirname(this.baselinePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(this.baselinePath, JSON.stringify(content, null, 2), 'utf-8');
  }
}
