import type { ResolvedPluginConfig } from '../types/config.js';

export const DEFAULT_CONFIG: ResolvedPluginConfig = {
  mode: 'warn',
  frameworks: 'auto',
  thresholds: {
    maxWarnings: Number.POSITIVE_INFINITY,
    maxErrors: 0,
    maxTotal: Number.POSITIVE_INFINITY,
  },
  include: /\.[jt]sx?$|\.vue$|\.svelte$/,
  exclude: /node_modules/,
  rules: {},
  customRules: [],
  ignores: [],
  allowlist: {
    functions: [],
    methods: [],
  },
  comments: {
    enabled: true,
    prefix: 'memory-leak',
  },
  baseline: {
    enabled: false,
    path: '.leak-baseline.json',
    update: false,
  },
  reports: [{ format: 'stylish' }],
  outputDir: '.leak-reports',
  verbose: false,
};
