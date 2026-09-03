import fs from 'node:fs';
import path from 'node:path';
import type { Diagnostic } from '../types/diagnostic.js';
import type { ReportDestination } from '../types/config.js';
import { consoleReporter, jsonReporter, sourceForFile } from './console.js';
import { generateSarifReport } from './sarif.js';
import { generateHtmlReport } from './html.js';
import { generateMarkdownReport } from './markdown.js';

export function dispatchReports(
  diagnostics: Diagnostic[],
  destinations: ReportDestination[],
  outputDir: string,
  sourceContext?: { file: string; code: string; verbose?: boolean }
): void {
  for (const dest of destinations) {
    switch (dest.format) {
      case 'json':
        if (dest.outputFile) {
          writeToFile(outputDir, dest.outputFile, JSON.stringify(diagnostics, null, 2));
        } else {
          jsonReporter(diagnostics);
        }
        break;

      case 'sarif': {
        const sarif = generateSarifReport(diagnostics);
        writeToFile(outputDir, dest.outputFile || 'leak-report.sarif', sarif);
        break;
      }

      case 'html': {
        const html = generateHtmlReport(diagnostics);
        writeToFile(outputDir, dest.outputFile || 'leak-report.html', html);
        break;
      }

      case 'markdown': {
        const md = generateMarkdownReport(diagnostics);
        writeToFile(outputDir, dest.outputFile || 'leak-report.md', md);
        break;
      }

      case 'stylish':
      case 'default':
      default:
        if (sourceContext) {
          const source = sourceForFile(sourceContext.file, sourceContext.code);
          consoleReporter(diagnostics, source, { verbose: sourceContext.verbose });
        }
        break;
    }
  }
}

function writeToFile(dir: string, file: string, content: string): void {
  const targetPath = path.isAbsolute(file) ? file : path.join(dir, file);
  const targetDir = path.dirname(targetPath);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  fs.writeFileSync(targetPath, content, 'utf-8');
}
