import type { ExtractionResult } from '../../types/rule.js';
import { extractGeneric } from './generic.js';
import { extractVue } from './vue.js';
import { extractSvelte } from './svelte.js';

export type ExtractableExtension = 'js' | 'jsx' | 'ts' | 'tsx' | 'vue' | 'svelte';

const VUE_RE = /\.vue$/;
const SVELTE_RE = /\.svelte$/;
const JS_TS_RE = /\.[jt]sx?$/;

export function getExtension(file: string): ExtractableExtension | null {
  const lower = file.toLowerCase();
  if (VUE_RE.test(lower)) return 'vue';
  if (SVELTE_RE.test(lower)) return 'svelte';
  if (JS_TS_RE.test(lower)) return 'tsx';
  return null;
}

/**
 * Dispatches to the appropriate extractor based on the file extension.
 * Returns `null` if the file type is not supported.
 *
 * Vue/Svelte extraction uses the official framework compilers via dynamic
 * imports, so this is async; when the compiler is unavailable an empty
 * extraction is returned rather than throwing.
 */
export async function extractSource(file: string, code: string): Promise<ExtractionResult | null> {
  const ext = getExtension(file);

  switch (ext) {
    case 'vue':
      return extractVue(code);
    case 'svelte':
      return extractSvelte(code);
    case 'tsx':
      return extractGeneric(code);
    default:
      return null;
  }
}