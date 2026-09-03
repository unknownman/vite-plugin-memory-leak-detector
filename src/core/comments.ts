export interface SuppressionDirective {
  type: 'disable-file' | 'disable-next-line' | 'disable-line' | 'block-disable' | 'block-enable';
  rules: string[]; // empty array means all rules
  line: number;
}

export class CommentDirectivesHandler {
  private prefix: string;
  private enabled: boolean;

  constructor(prefix = 'vite-leak', enabled = true) {
    this.prefix = prefix;
    this.enabled = enabled;
  }

  public parseDirectives(code: string): SuppressionDirective[] {
    if (!this.enabled) return [];

    const directives: SuppressionDirective[] = [];
    const lines = code.split('\n');

    const singleLinePattern = new RegExp(
      `//\\s*${this.prefix}-(disable-next-line|disable-line|disable)(.*)$`
    );
    const blockPattern = new RegExp(
      `/\\*\\s*${this.prefix}-(disable|enable)(?:\\s+([^*]+))?\\s*\\*/`,
      'g'
    );

    lines.forEach((lineText, idx) => {
      const lineNum = idx + 1;

      // Check single line comments
      const singleMatch = lineText.match(singleLinePattern);
      if (singleMatch) {
        const action = singleMatch[1];
        const rawRules = singleMatch[2]?.trim() || '';
        const rules = rawRules ? rawRules.split(/[\s,]+/).map((r) => r.trim()).filter(Boolean) : [];

        if (action === 'disable-next-line') {
          directives.push({ type: 'disable-next-line', rules, line: lineNum });
        } else if (action === 'disable-line') {
          directives.push({ type: 'disable-line', rules, line: lineNum });
        } else if (action === 'disable') {
          directives.push({ type: 'disable-file', rules, line: lineNum });
        }
      }

      // Check block comments
      let blockMatch: RegExpExecArray | null;
      while ((blockMatch = blockPattern.exec(lineText)) !== null) {
        const action = blockMatch[1];
        const rawRules = blockMatch[2]?.trim() || '';
        const rules = rawRules ? rawRules.split(/[\s,]+/).map((r) => r.trim()).filter(Boolean) : [];

        directives.push({
          type: action === 'disable' ? 'block-disable' : 'block-enable',
          rules,
          line: lineNum,
        });
      }
    });

    return directives;
  }

  public isSuppressed(ruleId: string, line: number, directives: SuppressionDirective[]): boolean {
    if (!this.enabled || directives.length === 0) return false;

    let inBlockDisable = false;
    let blockRules: string[] = [];

    for (const dir of directives) {
      const matchesRule = dir.rules.length === 0 || dir.rules.includes(ruleId);

      // Whole file suppression
      if (dir.type === 'disable-file' && matchesRule) {
        return true;
      }

      // Next line suppression
      if (dir.type === 'disable-next-line' && dir.line + 1 === line && matchesRule) {
        return true;
      }

      // Current line suppression
      if (dir.type === 'disable-line' && dir.line === line && matchesRule) {
        return true;
      }

      // Block-range tracking
      if (dir.line <= line) {
        if (dir.type === 'block-disable') {
          inBlockDisable = true;
          blockRules = dir.rules;
        } else if (dir.type === 'block-enable') {
          if (dir.rules.length === 0 || dir.rules.includes(ruleId)) {
            inBlockDisable = false;
          }
        }
      }
    }

    if (inBlockDisable && (blockRules.length === 0 || blockRules.includes(ruleId))) {
      return true;
    }

    return false;
  }
}
