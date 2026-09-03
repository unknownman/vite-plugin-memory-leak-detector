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
    const lines = code.split('\n');

    // Matches: // memory-leak-ignore-next-line rule1, rule2
    const singleLinePattern = new RegExp(
      `//\\s*${this.prefix}-(ignore-next-line|ignore-line|ignore)(.*)$`
    );
    // Matches: /* memory-leak-ignore-start rule1 */
    const blockPattern = new RegExp(
      `/\\*\\s*${this.prefix}-(ignore-start|ignore-end)(?:\\s+([^*]+))?\\s*\\*/`,
      'g'
    );

    lines.forEach((lineText, idx) => {
      const lineNum = idx + 1;

      // Single line check
      const singleMatch = lineText.match(singleLinePattern);
      if (singleMatch) {
        const action = singleMatch[1];
        const rawRules = singleMatch[2]?.trim() || '';
        const rules = rawRules ? rawRules.split(/[\s,]+/).map((r) => r.trim()).filter(Boolean) : [];

        if (action === 'ignore-next-line') {
          directives.push({ type: 'ignore-next-line', rules, line: lineNum });
        } else if (action === 'ignore-line') {
          directives.push({ type: 'ignore-line', rules, line: lineNum });
        } else if (action === 'ignore') {
          directives.push({ type: 'ignore-file', rules, line: lineNum });
        }
      }

      // Block comment check
      let blockMatch: RegExpExecArray | null;
      while ((blockMatch = blockPattern.exec(lineText)) !== null) {
        const action = blockMatch[1];
        const rawRules = blockMatch[2]?.trim() || '';
        const rules = rawRules ? rawRules.split(/[\s,]+/).map((r) => r.trim()).filter(Boolean) : [];

        directives.push({
          type: action === 'ignore-start' ? 'ignore-start' : 'ignore-end',
          rules,
          line: lineNum,
        });
      }
    });

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
