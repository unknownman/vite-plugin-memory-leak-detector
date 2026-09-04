export interface SuppressionDirective {
  type: 'ignore-file' | 'ignore-next-line' | 'ignore-line' | 'ignore-start' | 'ignore-end';
  rules: string[]; // empty array means all rules
  line: number;
}

export class CommentDirectivesHandler {
  private prefix: string;
  private enabled: boolean;

  constructor(prefix = 'memory-leak', enabled = true) {
    this.prefix = prefix;
    this.enabled = enabled;
  }

  public parseDirectives(code: string): SuppressionDirective[] {
    if (!this.enabled) return [];

    const directives: SuppressionDirective[] = [];

    // Precompute line starts for fast, accurate line number lookup from string index
    const lineStarts: number[] = [0];
    for (let i = 0; i < code.length; i++) {
      if (code.charCodeAt(i) === 10 /* \n */) {
        lineStarts.push(i + 1);
      }
    }

    const getLineNumber = (offset: number): number => {
      let low = 0;
      let high = lineStarts.length - 1;
      while (low < high) {
        const mid = (low + high + 1) >> 1;
        if (lineStarts[mid] <= offset) low = mid;
        else high = mid - 1;
      }
      return low + 1;
    };

    // Matches single-line directives AND multi-line block comment directives globally
    const pattern = new RegExp(
      `//\\s*${this.prefix}-(ignore-next-line|ignore-line|ignore)(.*)$|/\\*\\s*${this.prefix}-(ignore-start|ignore-end)(?:\\s+([\\s\\S]*?))?\\s*\\*/`,
      'gm'
    );

    for (const match of code.matchAll(pattern)) {
      const matchIndex = match.index ?? 0;
      const lineNum = getLineNumber(matchIndex);

      if (match[1]) {
        // Single-line comment directive
        const action = match[1];
        const rawRules = match[2]?.trim() || '';
        const rules = rawRules
          ? rawRules.split(/[\s,]+/).map((r) => r.trim()).filter(Boolean)
          : [];

        if (action === 'ignore-next-line') {
          directives.push({ type: 'ignore-next-line', rules, line: lineNum });
        } else if (action === 'ignore-line') {
          directives.push({ type: 'ignore-line', rules, line: lineNum });
        } else if (action === 'ignore') {
          directives.push({ type: 'ignore-file', rules, line: lineNum });
        }
      } else if (match[3]) {
        // Block comment directive (single or multi-line)
        const action = match[3];
        const rawRules = match[4]?.replace(/^\s*\*+/gm, '').trim() || '';
        const rules = rawRules
          ? rawRules.split(/[\s,]+/).map((r) => r.trim()).filter(Boolean)
          : [];

        directives.push({
          type: action === 'ignore-start' ? 'ignore-start' : 'ignore-end',
          rules,
          line: lineNum,
        });
      }
    }

    return directives;
  }

  public isSuppressed(ruleId: string, line: number, directives: SuppressionDirective[]): boolean {
    if (!this.enabled || directives.length === 0) return false;

    let inBlockIgnore = false;
    let blockRules: string[] = [];

    for (const dir of directives) {
      const matchesRule = dir.rules.length === 0 || dir.rules.includes(ruleId);

      if (dir.type === 'ignore-file' && matchesRule) return true;
      if (dir.type === 'ignore-next-line' && dir.line + 1 === line && matchesRule) return true;
      if (dir.type === 'ignore-line' && dir.line === line && matchesRule) return true;

      // Track block start/end line by line
      if (dir.line <= line) {
        if (dir.type === 'ignore-start') {
          inBlockIgnore = true;
          blockRules = dir.rules;
        } else if (dir.type === 'ignore-end') {
          if (dir.rules.length === 0 || dir.rules.includes(ruleId)) {
            inBlockIgnore = false;
          }
        }
      }
    }

    if (inBlockIgnore && (blockRules.length === 0 || blockRules.includes(ruleId))) {
      return true;
    }

    return false;
  }
}
