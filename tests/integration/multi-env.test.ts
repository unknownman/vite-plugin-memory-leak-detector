import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createBuilder } from 'vite';
import { memoryLeakDetector } from '../../src/index.js';

const viteVersion = (await import('vite/package.json')).default?.version || (await import('vite/package.json')).version;
const viteMajor = parseInt(viteVersion?.split('.')[0] || '0', 10);

describe.skipIf(viteMajor < 6)('multi-environment builds (Vite 6+)', () => {
  let dir: string;
  let reportPath: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leak-multienv-'));
    reportPath = path.join(dir, 'report.json');
    fs.writeFileSync(path.join(dir, 'client-entry.ts'), 'const id = setInterval(() => {}, 1000);\n');
    fs.writeFileSync(path.join(dir, 'ssr-entry.ts'), 'const id = setInterval(() => {}, 2000);\n');
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reports diagnostics from both the client and ssr environments', async () => {
    const plugin = memoryLeakDetector({
      mode: 'report-only',
      reports: [{ format: 'json', outputFile: reportPath }],
      include: ['**/*.ts'],
    });

    const builder = await createBuilder({
      logLevel: 'silent',
      configFile: false,
      root: dir,
      build: { write: false },
      plugins: [plugin],
      environments: {
        client: {
          build: {
            rollupOptions: { input: path.join(dir, 'client-entry.ts') },
          },
        },
        ssr: {
          build: {
            rollupOptions: { input: path.join(dir, 'ssr-entry.ts') },
          },
        },
      },
    });

    await builder.buildApp();

    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const files = report.map((d: any) => path.basename(d.file));
    expect(files).toContain('client-entry.ts');
    expect(files).toContain('ssr-entry.ts');
  });
});
