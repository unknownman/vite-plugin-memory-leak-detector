import type { Diagnostic } from '../types/diagnostic.js';

export function generateMarkdownReport(diagnostics: Diagnostic[]): string {
  const errorCount = diagnostics.filter((d) => d.severity === 'error').length;
  const warnCount = diagnostics.filter((d) => d.severity === 'warn').length;

  let md = `# 🛡️ Memory Leak Detection Report\n\n`;
  md += `**Summary:** 🔴 ${errorCount} Errors | 🟡 ${warnCount} Warnings\n\n`;

  if (diagnostics.length === 0) {
    md += `✅ **No memory leaks detected!**\n`;
    return md;
  }

  md += `| Severity | Rule ID | File:Line | Description |\n`;
  md += `| :--- | :--- | :--- | :--- |\n`;

  for (const d of diagnostics) {
    const icon = d.severity === 'error' ? '🔴 ERROR' : '🟡 WARN';
    const desc = d.suggestion ? `${d.message}<br/>*💡 Suggestion: ${d.suggestion}*` : d.message;
    md += `| ${icon} | \`${d.ruleId}\` | \`${d.file}:${d.line}:${d.column}\` | ${desc.replace(/\n/g, ' ')} |\n`;
  }

  return md;
}
