import pm from 'picomatch';
import type { IgnoreConfig, IgnoreRule } from '../types/config.js';

export class IgnoreManager {
  private globalIgnores: pm.Matcher[] = [];
  private ruleSpecificIgnores: { matcher: pm.Matcher; rules: string[] }[] = [];

  constructor(ignores: IgnoreConfig = []) {
    for (const item of ignores) {
      if (typeof item === 'string') {
        this.globalIgnores.push(pm(item, { dot: true }));
      } else if (item && typeof item === 'object') {
        const patterns = Array.isArray(item.glob) ? item.glob : [item.glob];
        const matcher = pm(patterns, { dot: true });

        if (!item.rules || item.rules.length === 0) {
          this.globalIgnores.push(matcher);
        } else {
          this.ruleSpecificIgnores.push({ matcher, rules: item.rules });
        }
      }
    }
  }

  /**
   * Returns true if the file is globally ignored from ALL leak detection.
   */
  public isFileGloballyIgnored(file: string): boolean {
    return this.globalIgnores.some((matcher) => matcher(file));
  }

  /**
   * Returns true if a specific rule is ignored for this file via glob config.
   */
  public isRuleIgnoredForFile(file: string, ruleId: string): boolean {
    if (this.isFileGloballyIgnored(file)) return true;

    for (const config of this.ruleSpecificIgnores) {
      if (config.rules.includes(ruleId) && config.matcher(file)) {
        return true;
      }
    }

    return false;
  }
}
