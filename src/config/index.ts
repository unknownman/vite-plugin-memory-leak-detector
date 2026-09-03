import type { PluginOptions, ResolvedPluginConfig, ReportDestination, ReportFormat } from '../types/config.js';
import { DEFAULT_CONFIG } from './defaults.js';
import { validatePluginOptions } from './validator.js';

export function resolvePluginConfig(userOptions: PluginOptions = {}): ResolvedPluginConfig {
  validatePluginOptions(userOptions);

  const mode = userOptions.mode ?? DEFAULT_CONFIG.mode;

  // Resolve thresholds based on mode defaults
  const thresholds = {
    maxWarnings: userOptions.thresholds?.maxWarnings ?? Number.POSITIVE_INFINITY,
    maxErrors: userOptions.thresholds?.maxErrors ?? (mode === 'error' ? 0 : Number.POSITIVE_INFINITY),
    maxTotal: userOptions.thresholds?.maxTotal ?? Number.POSITIVE_INFINITY,
  };

  // Resolve baseline
  let baseline = { ...DEFAULT_CONFIG.baseline };
  if (typeof userOptions.baseline === 'string') {
    baseline = { enabled: true, path: userOptions.baseline, update: false };
  } else if (userOptions.baseline) {
    baseline = {
      enabled: true,
      path: userOptions.baseline.path ?? DEFAULT_CONFIG.baseline.path,
      update: userOptions.baseline.update ?? false,
    };
  }

  // Resolve report destinations
  const reports: ReportDestination[] = [];
  const rawReports = userOptions.reports ?? userOptions.reporter ?? 'stylish';
  const reportList = Array.isArray(rawReports) ? rawReports : [rawReports];

  for (const item of reportList) {
    if (typeof item === 'string') {
      reports.push({ format: item as ReportFormat });
    } else if (item && typeof item === 'object') {
      reports.push(item);
    }
  }

  return {
    mode,
    frameworks: userOptions.frameworks ?? DEFAULT_CONFIG.frameworks,
    thresholds,
    include: userOptions.include ?? DEFAULT_CONFIG.include,
    exclude: userOptions.exclude ?? DEFAULT_CONFIG.exclude,
    rules: userOptions.rules ?? {},
    customRules: userOptions.customRules ?? [],
    comments: {
      enabled: userOptions.comments?.enabled ?? DEFAULT_CONFIG.comments.enabled,
      prefix: userOptions.comments?.prefix ?? DEFAULT_CONFIG.comments.prefix,
    },
    baseline,
    reports,
    outputDir: userOptions.outputDir ?? DEFAULT_CONFIG.outputDir,
    verbose: userOptions.verbose ?? false,
  };
}
