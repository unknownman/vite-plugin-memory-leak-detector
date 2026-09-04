import path from 'node:path';
import type { Diagnostic } from '../types/diagnostic.js';

export function generateSarifReport(diagnostics: Diagnostic[]): string {
  const cwd = process.cwd();

  // Extract unique rules for the SARIF definitions
  const uniqueRules = Array.from(new Set(diagnostics.map((d) => d.ruleId))).map((id) => ({
    id,
    shortDescription: { text: `Memory Leak: ${id}` },
    helpUri: `https://github.com/vite-plugin-memory-leak-detector/docs/rules/${id.replace('/', '-')}.md`,
  }));

  const results = diagnostics.map((diag) => {
    // SARIF Levels: error, warning, note, none
    const level = diag.severity === 'error' ? 'error' : 'warning';
    const relativeUri = path.relative(cwd, diag.file).replace(/\\/g, '/');

    return {
      ruleId: diag.ruleId,
      level,
      message: {
        text: diag.message + (diag.suggestion ? `\n\nSuggestion: ${diag.suggestion}` : ''),
      },
      locations: [
        {
          physicalLocation: {
            artifactLocation: {
              uri: relativeUri,
              uriBaseId: '%SRCROOT%',
            },
            region: {
              startLine: Math.max(1, diag.line),
              startColumn: Math.max(1, diag.column),
              endLine: diag.endLine || Math.max(1, diag.line),
              endColumn: diag.endColumn || Math.max(1, diag.column),
            },
          },
        },
      ],
      fingerprints: {
        default: diag.fingerprint || '',
      },
    };
  });

  const sarif = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'vite-plugin-memory-leak-detector',
            informationUri: 'https://github.com/vite-plugin-memory-leak-detector',
            semanticVersion: '1.0.0',
            rules: uniqueRules,
          },
        },
        results,
      },
    ],
  };

  return JSON.stringify(sarif, null, 2);
}
