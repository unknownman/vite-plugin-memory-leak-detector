import type { Diagnostic } from '../types/diagnostic.js';

export function generateHtmlReport(diagnostics: Diagnostic[]): string {
  const errorCount = diagnostics.filter((d) => d.severity === 'error').length;
  const warnCount = diagnostics.filter((d) => d.severity === 'warn').length;

  const rows = diagnostics
    .map(
      (d) => `
      <tr class="row-${d.severity}">
        <td><span class="badge badge-${d.severity}">${d.severity.toUpperCase()}</span></td>
        <td><code>${d.ruleId}</code></td>
        <td><code>${d.file}:${d.line}:${d.column}</code></td>
        <td>
          <div class="msg">${d.message}</div>
          ${d.suggestion ? `<div class="suggestion">💡 <strong>Suggestion:</strong> ${d.suggestion}</div>` : ''}
        </td>
      </tr>
    `
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Memory Leak Detection Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; color: #1e293b; padding: 2rem; margin: 0; }
    .container { max-width: 1200px; margin: 0 auto; }
    .header { background: #fff; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .summary { display: flex; gap: 1rem; margin-top: 1rem; }
    .stat { padding: 0.75rem 1.25rem; border-radius: 6px; font-weight: bold; }
    .stat-err { background: #fee2e2; color: #991b1b; }
    .stat-warn { background: #fef3c7; color: #92400e; }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    th, td { padding: 1rem; text-align: left; border-bottom: 1px solid #e2e8f0; }
    th { background: #f1f5f9; font-weight: 600; }
    .badge { padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: bold; }
    .badge-error { background: #ef4444; color: #fff; }
    .badge-warn { background: #f59e0b; color: #fff; }
    .suggestion { margin-top: 0.5rem; font-size: 0.875rem; color: #059669; }
    code { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 0.875rem; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Memory Leak Analysis Report</h1>
      <div class="summary">
        <div class="stat stat-err">${errorCount} Errors</div>
        <div class="stat stat-warn">${warnCount} Warnings</div>
      </div>
    </div>
    <table>
      <thead>
        <tr>
          <th>Severity</th>
          <th>Rule ID</th>
          <th>Location</th>
          <th>Details</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="4" style="text-align:center;color:#64748b;">No memory leaks detected. 🎉</td></tr>'}
      </tbody>
    </table>
  </div>
</body>
</html>`;
}
