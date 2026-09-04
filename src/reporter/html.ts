import path from 'node:path';
import type { Diagnostic } from '../types/diagnostic.js';

export function generateHtmlReport(diagnostics: Diagnostic[]): string {
  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = diagnostics.filter((d) => d.severity === 'warn').length;
  const total = diagnostics.length;

  const cwd = process.cwd();

  const rowHtml = diagnostics
    .map((d) => {
      const relativeFile = path.relative(cwd, d.file).replace(/\\/g, '/');
      const vscodeLink = `vscode://file/${encodeURIComponent(d.file)}:${d.line}:${d.column}`;

      return `
      <tr class="issue-row severity-${d.severity}" data-severity="${d.severity}" data-rule="${d.ruleId}">
        <td class="px-4 py-3">
          <span class="badge badge-${d.severity}">${d.severity.toUpperCase()}</span>
        </td>
        <td class="px-4 py-3 font-mono text-sm text-gray-700">${d.ruleId}</td>
        <td class="px-4 py-3 font-mono text-sm">
          <a href="${vscodeLink}" class="file-link" title="Open in VS Code">
            ${relativeFile}:${d.line}:${d.column}
          </a>
        </td>
        <td class="px-4 py-3">
          <div class="font-medium text-gray-900">${d.message}</div>
          ${d.suggestion ? `<div class="suggestion-box">💡 <strong>Suggestion:</strong> ${d.suggestion}</div>` : ''}
        </td>
      </tr>
    `;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Memory Leak Report</title>
  <style>
    :root { --error: #ef4444; --error-bg: #fef2f2; --warn: #f59e0b; --warn-bg: #fffbeb; }
    body { font-family: system-ui, -apple-system, sans-serif; background-color: #f3f4f6; margin: 0; padding: 2rem; color: #1f2937; }
    .container { max-width: 1400px; margin: 0 auto; background: white; border-radius: 8px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); overflow: hidden; }
    .header { padding: 1.5rem 2rem; border-bottom: 1px solid #e5e7eb; background: #fff; }
    .header h1 { margin: 0 0 1rem 0; font-size: 1.5rem; color: #111827; }
    .stats { display: flex; gap: 1rem; }
    .stat-card { padding: 1rem; border-radius: 6px; border: 1px solid #e5e7eb; flex: 1; text-align: center; }
    .stat-card.errors { background: var(--error-bg); border-color: #fecaca; }
    .stat-card.warnings { background: var(--warn-bg); border-color: #fde68a; }
    .stat-card.total { background: #f3f4f6; }
    .stat-num { font-size: 1.5rem; font-weight: bold; }
    .filters { padding: 1rem 2rem; background: #f9fafb; border-bottom: 1px solid #e5e7eb; display: flex; gap: 1rem; align-items: center; }
    select, input { padding: 0.5rem; border: 1px solid #d1d5db; border-radius: 4px; font-size: 0.875rem; }
    input[type="text"] { flex: 1; }
    table { width: 100%; border-collapse: collapse; text-align: left; }
    th { padding: 0.75rem 1rem; background: #f9fafb; border-bottom: 1px solid #e5e7eb; font-weight: 600; color: #4b5563; font-size: 0.875rem; text-transform: uppercase; }
    td { padding: 1rem; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
    .badge { padding: 0.25rem 0.5rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; }
    .badge-error { background: var(--error); color: white; }
    .badge-warn { background: var(--warn); color: white; }
    .hidden { display: none !important; }
    .font-mono { font-family: ui-monospace, SFMono-Regular, monospace; }
    .file-link { color: #2563eb; text-decoration: none; word-break: break-all; }
    .file-link:hover { text-decoration: underline; color: #1d4ed8; }
    .suggestion-box { margin-top: 0.5rem; font-size: 0.875rem; color: #166534; background: #f0fdf4; padding: 0.5rem; border-radius: 4px; border: 1px solid #bbf7d0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Memory Leak Detection Report</h1>
      <div class="stats">
        <div class="stat-card total"><div class="stat-num">${total}</div><div class="text-sm">Total Issues</div></div>
        <div class="stat-card errors"><div class="stat-num" style="color: var(--error);">${errors}</div><div class="text-sm">Errors</div></div>
        <div class="stat-card warnings"><div class="stat-num" style="color: var(--warn);">${warnings}</div><div class="text-sm">Warnings</div></div>
      </div>
    </div>
    
    <div class="filters">
      <strong>Filter:</strong>
      <select id="severityFilter">
        <option value="all">All Severities</option>
        <option value="error">Errors Only</option>
        <option value="warn">Warnings Only</option>
      </select>
      <input type="text" id="searchInput" placeholder="Search files, rules, or messages...">
    </div>

    <table>
      <thead>
        <tr>
          <th style="width: 100px;">Severity</th>
          <th style="width: 250px;">Rule</th>
          <th style="width: 350px;">File Location</th>
          <th>Details</th>
        </tr>
      </thead>
      <tbody id="issueTableBody">
        ${rowHtml || `<tr><td colspan="4" style="text-align: center; padding: 3rem; color: #6b7280; font-size: 1.1rem;">No memory leaks detected! 🎉</td></tr>`}
      </tbody>
    </table>
  </div>

  <script>
    const filter = document.getElementById('severityFilter');
    const search = document.getElementById('searchInput');
    const rows = document.querySelectorAll('.issue-row');

    function applyFilters() {
      const severity = filter.value;
      const term = search.value.toLowerCase();

      rows.forEach(row => {
        const rowSeverity = row.getAttribute('data-severity');
        const textContent = row.textContent.toLowerCase();
        
        const matchesSeverity = severity === 'all' || rowSeverity === severity;
        const matchesSearch = textContent.includes(term);

        if (matchesSeverity && matchesSearch) {
          row.classList.remove('hidden');
        } else {
          row.classList.add('hidden');
        }
      });
    }

    filter.addEventListener('change', applyFilters);
    search.addEventListener('keyup', applyFilters);
  </script>
</body>
</html>`;
}
