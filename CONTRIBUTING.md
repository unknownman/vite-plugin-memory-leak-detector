# Contributing

Thank you for your interest in improving `vite-plugin-memory-leak-detector`!

## Local Development Setup

1. Fork and clone the repository.
2. Ensure you have Node.js >= 18 installed.
3. Install dependencies: `npm install`
4. Start the bundler in watch mode: `npm run dev`
5. In another terminal, run tests in watch mode: `npm run test:watch`

## Project Structure

```
src/
├── plugin.ts              # Vite plugin hooks (configResolved, configureServer, transform, buildEnd)
├── config/index.ts        # Config resolution and validation
├── core/
│   ├── engine.ts          # Main analysis engine (analyze method)
│   ├── baseline.ts        # SHA-256 fingerprinting for baseline suppression
│   ├── comments.ts        # Comment directive parser (ignore-next-line, etc.)
│   ├── ignore.ts          # Glob-based file ignore manager (picomatch)
│   └── extractors/
│       └── scanner.ts     # State-machine SFC scanner for Vue/Svelte
├── reporter/
│   ├── console.ts         # Grouped stylish terminal reporter
│   ├── html.ts            # Interactive HTML dashboard
│   ├── markdown.ts        # CI-friendly markdown summary
│   ├── sarif.ts           # GitHub SARIF annotations
│   └── rollup.ts          # Reporter dispatcher
├── rules/
│   ├── index.ts           # Registry of all builtin rules
│   ├── utils/tracker.ts   # Shared variable tracking utility
│   ├── generic/           # Framework-agnostic rules
│   ├── react/
│   ├── vue/
│   ├── svelte/
│   └── solid/
├── types/
│   ├── config.ts          # PluginOptions, RuleSeverityConfig, etc.
│   ├── diagnostic.ts      # Diagnostic, SourceLocation, CodeFrame
│   └── rule.ts            # RuleContext, RuleDefinition, RuleVisitor
└── index.ts               # Public API surface
```

## Adding a New Rule

### Step 1: Create the rule file

Add a new file in `src/rules/<category>/your-rule-name.ts`:

```typescript
import type { RuleContext, RuleDefinition } from '../../types/rule.js';

export const myNewRule: RuleDefinition = {
  id: 'category/my-new-rule',
  description: 'Short description of what it detects.',
  category: 'generic', // or 'react', 'vue', 'svelte', 'solid'
  defaultSeverity: 'warn',

  // REQUIRED. A source file is skipped before parsing unless it contains at
  // least one trigger of some enabled rule, so list every identifier this rule
  // can report on. Two rules of caution:
  //
  //  1. List only what a report *cannot exist without*. Rules inspect a
  //     clearance (clearInterval, onUnmounted, off) only after they have seen an
  //     allocation, so those names add no coverage.
  //  2. Keep them specific. A bare 'on' is a substring of `const` and 'off' of
  //     `offset`, which would make the prefilter match nearly every file.
  //
  // Use `triggers: []` if the rule genuinely cannot be described this way; it
  // will then always be parsed.
  triggers: ['setInterval'],

  create(context: RuleContext) {
    return {
      CallExpression(node: any) {
        // Example: detect setInterval calls
        if (node.callee.type === 'Identifier' && node.callee.name === 'setInterval') {
          context.report({
            ruleId: 'category/my-new-rule',
            message: 'Description of the issue.',
            suggestion: 'How to fix it.',
            line: node.loc?.start?.line ?? 1,
            column: node.loc?.start?.column ?? 0,
          });
        }
      },
    };
  },
};
```

### Step 2: Register the rule

Import and add it to the `builtinRules` array in `src/rules/index.ts`:

```typescript
import { myNewRule } from './category/my-new-rule.js';

// Add to builtinRules array:
export const builtinRules: RuleDefinition[] = [
  // ... existing rules
  myNewRule,
];
```

Also export it by name:

```typescript
export { myNewRule as myNewRuleRule } from './category/my-new-rule.js';
```

And add the named export in `src/index.ts`:

```typescript
export { myNewRuleRule } from './rules/index.js';
```

### Step 3: Write tests

Add a test file in `tests/rules/` (or add to an existing test file for that category):

```typescript
import { describe, it, expect } from 'vitest';
import { runRule } from '../utils.js';
import { myNewRule } from '../../src/rules/category/my-new-rule.js';

describe('category/my-new-rule', () => {
  it('detects the pattern', () => {
    const code = `const id = setInterval(() => {}, 1000);`;
    const diagnostics = runRule(myNewRule, code, 'js');
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0].ruleId).toBe('category/my-new-rule');
  });

  it('allows safe usage', () => {
    const code = `
      const id = setInterval(() => {}, 1000);
      clearInterval(id);
    `;
    const diagnostics = runRule(myNewRule, code, 'js');
    expect(diagnostics.length).toBe(0);
  });
});
```

### Step 4: Update documentation

Add your rule to the appropriate table in `README.md` and update `CHANGELOG.md`.

## Pull Requests

- Keep PRs focused on a single feature or bug fix.
- Ensure all tests pass: `npm test`
- Ensure TypeScript compiles: `npm run typecheck`
- Ensure the package builds: `npm run build`
- Add tests for any new behavior or bug fixes.
- Update README and CHANGELOG for user-facing changes.

### Step 5: Check the compatibility surface

`package.json` declares `vite` as a peer dependency across Vite 4–8, and CI runs
the suite against each of them. The plugin also supports two generations of
dev-server hooks, so confirm your change works on both:

| | Vite 4 / 5 | Vite 6 / 7 / 8 |
|---|---|---|
| HMR hook | `handleHotUpdate` | `handleHotUpdate` **and** `hotUpdate` |
| Environment | none | `this.environment.name` |

To reproduce a matrix leg locally:

```bash
npm install --no-save --no-package-lock vite@6
npm run typecheck && npm test && npm run build
```

If you touched the parser, the visitor map or the prefilter, run the benchmark
and include the numbers in your PR description:

```bash
npx tsx benchmarks/phase4.ts
```

Never claim support for a Vite major you have not actually run the suite
against.
