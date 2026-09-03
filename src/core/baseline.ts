import fs from 'node:fs';
import path from 'node:path';
import type { Diagnostic } from '../types/diagnostic.js';

export interface BaselineEntry {
  fingerprint: string;
  ruleId: string;
  file: string;
  line: number;
  message: string;
}

export interface BaselineFile {
  version: string;
  createdAt: string;
  totalLeaks: number;
  entries: BaselineEntry[];
}

export function generateFingerprint(diag: Diagnostic): string {
  // Fingerprint is a robust hash of ruleId + relative file path + core error message
  const rawKey = `${diag.ruleId}:${diag.file}:${diag.message.trim()}`;
  let hash = 0;
  for (let i = 0; i < rawKey.length; i++) {
    hash = (hash << 5) - hash + rawKey.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

export class BaselineManager {
  private baselinePath: string;
  private entriesMap = new Map<string, BaselineEntry>();

  constructor(baselinePath: string) {
    this.baselinePath = path.resolve(process.cwd(), baselinePath);
    this.load();
  }

  private load(): void {
    if (!fs.existsSync(this.baselinePath)) return;
    try {
      const raw = fs.readFileSync(this.baselinePath, 'utf-8');
      const data: BaselineFile = JSON.parse(raw);
      for (const entry of data.entries) {
        this.entriesMap.set(entry.fingerprint, entry);
      }
    } catch {
      console.warn(`[vite-plugin-memory-leak-detector] Could not parse baseline file at ${this.baselinePath}`);
    }
  }

  public isBaseline(diag: Diagnostic): boolean {
    const fp = diag.fingerprint || generateFingerprint(diag);
    return this.entriesMap.has(fp);
  }

  public recordBaseline(diagnostics: Diagnostic[]): void {
    const entries: BaselineEntry[] = diagnostics.map((d) => ({
      fingerprint: d.fingerprint || generateFingerprint(d),
      ruleId: d.ruleId,
      file: d.file,
      line: d.line,
      message: d.message,
    }));

    const content: BaselineFile = {
      version: '1.0',
      createdAt: new Date().toISOString(),
      totalLeaks: entries.length,
      entries,
    };

    const dir = path.dirname(this.baselinePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(this.baselinePath, JSON.stringify(content, null, 2), 'utf-8');
  }
}
