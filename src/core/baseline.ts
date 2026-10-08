import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Diagnostic } from '../types/diagnostic.js';

/** Current baseline file format. Version 2 replaced the v1 fingerprint key. */
export const BASELINE_VERSION = '2.0.0';

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

/**
 * Normalizes a source line for fingerprinting so that edits which do not change
 * *what* leaked do not change the diagnostic's identity:
 *
 * - string/template literal contents are emptied (a new URL or message inside
 *   the leaking call is the same leak),
 * - numbers collapse to `0` (a new delay or retry count is the same leak),
 * - whitespace runs collapse to a single space and the result is trimmed, so
 *   reindenting or re-wrapping a line changes nothing.
 *
 * Digit runs adjacent to identifier characters (`id2`, `2fa`) are left alone:
 * they are part of a name, not a numeric literal.
 */
export function normalizeSnippet(line: string): string {
  return line
    .replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, (m) => m[0] + m[0])
    .replace(/(?<![\w$])\d+(?:\.\d+)?(?![\w$])/g, '0')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Builds the version 2 fingerprint: rule, repo-relative file, the normalized
 * source snippet the diagnostic points at, and the occurrence index among
 * diagnostics that share that (rule, file, snippet) triple.
 *
 * Including the snippet distinguishes two leaks of the same variable in the
 * same file that the old `rule|file|message` key collapsed into one entry.
 * Including the occurrence index keeps repeated identical lines distinct.
 * Line numbers are deliberately excluded so a leak stays recognized when code
 * is inserted above it.
 */
export function generateFingerprint(
  diag: Diagnostic,
  cwd: string = process.cwd(),
  occurrenceIndex: number = 0
): string {
  const relativeFile = path.relative(cwd, diag.file).replace(/\\/g, '/');
  const snippet = normalizeSnippet(diag.snippet ?? '');
  const rawKey = `${diag.ruleId}|${relativeFile}|${snippet}|${occurrenceIndex}`;
  return crypto.createHash('sha256').update(rawKey).digest('hex').substring(0, 16);
}

/**
 * The version 1 fingerprint (`rule|file|message`), kept so existing baseline
 * files continue to suppress the leaks they recorded.
 */
export function generateLegacyFingerprint(diag: Diagnostic, cwd: string = process.cwd()): string {
  const relativeFile = path.relative(cwd, diag.file).replace(/\\/g, '/');
  const rawKey = `${diag.ruleId}|${relativeFile}|${diag.message}`;
  return crypto.createHash('sha256').update(rawKey).digest('hex').substring(0, 16);
}

export class BaselineManager {
  private baselinePath: string;
  private root: string;
  /** Fingerprints recorded in the file, in whichever format it was written. */
  private knownFingerprints = new Set<string>();
  /** True when the loaded file used the v1 format, so diagnostics match by legacy key. */
  private usingLegacyFormat = false;
  private warnedAboutLegacy = false;

  constructor(baselinePath: string, root: string = process.cwd()) {
    this.root = root;
    this.baselinePath = path.resolve(root, baselinePath);
    this.load();
  }

  private load(): void {
    if (!fs.existsSync(this.baselinePath)) return;
    try {
      const raw = fs.readFileSync(this.baselinePath, 'utf-8');
      const data = JSON.parse(raw) as BaselineFile;
      // Anything without an explicit version, or with a major version below 2,
      // predates the snippet-based fingerprint. Compare majors numerically —
      // a lexicographic `'10.0.0' < '2.0.0'` would misread future versions.
      const major = Number.parseInt(String(data.version ?? ''), 10);
      this.usingLegacyFormat = !Number.isFinite(major) || major < 2;
      for (const issue of data.issues ?? []) {
        this.knownFingerprints.add(issue.fingerprint);
      }
      if (this.usingLegacyFormat && !this.warnedAboutLegacy) {
        this.warnedAboutLegacy = true;
        console.warn(
          `[MemoryLeakDetector] Baseline at ${this.baselinePath} uses the legacy v1 format. ` +
            `Entries still match, but regenerating with \`baseline: { update: true }\` enables ` +
            `more precise matching (version ${BASELINE_VERSION}).`
        );
      }
    } catch {
      console.warn(`[MemoryLeakDetector] Warning: Could not parse baseline at ${this.baselinePath}`);
    }
  }

  /**
   * Returns true if the diagnostic is already known in the baseline.
   */
  public isKnown(diag: Diagnostic): boolean {
    if (!diag.fingerprint) {
      diag.fingerprint = generateFingerprint(diag, this.root);
    }
    if (this.knownFingerprints.has(diag.fingerprint)) return true;
    return (
      this.usingLegacyFormat && this.knownFingerprints.has(generateLegacyFingerprint(diag, this.root))
    );
  }

  /**
   * Writes current findings to the baseline file.
   */
  public updateBaseline(diagnostics: Diagnostic[]): void {
    const issues: BaselineEntry[] = diagnostics.map((d) => ({
      fingerprint: d.fingerprint || generateFingerprint(d, this.root),
      ruleId: d.ruleId,
      file: path.relative(this.root, d.file).replace(/\\/g, '/'),
      message: d.message,
    }));

    // Deduplicate by fingerprint
    const uniqueIssues = Array.from(new Map(issues.map((item) => [item.fingerprint, item])).values());

    const content: BaselineFile = {
      version: BASELINE_VERSION,
      updatedAt: new Date().toISOString(),
      issues: uniqueIssues,
    };

    const dir = path.dirname(this.baselinePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(this.baselinePath, JSON.stringify(content, null, 2), 'utf-8');
  }
}