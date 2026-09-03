import type { Diagnostic } from '../types/diagnostic.js';

export function generateSarifReport(diagnostics: Diagnostic[]): string {
  const sarif = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'vite-plugin-memory-leak-detector',
            informationUri: 'https://github.com/unknownman/vite-plugin-memory-leak-detector',
            rules: Array.from(new Set(diagnostics.map((d) => d.ruleId))).map((id) => ({
              id,
              shortDescription: { text: `Memory leak rule: ${id}` },
            })),
          },
        },
        results: diagnostics.map((diag) => ({
          ruleId: diag.ruleId,
          level: diag.severity === 'error' ? 'error' : 'warning',
          message: { text: diag.message },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: diag.file },
                region: {
                  startLine: Math.max(1, diag.line),
                  startColumn: Math.max(1, diag.column),
                },
              },
            },
          ],
        })),
      },
    ],
  };

  return JSON.stringify(sarif, null, 2);
}
