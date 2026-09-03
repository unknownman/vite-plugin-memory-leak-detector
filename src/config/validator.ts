import type { PluginOptions, PluginMode, Severity, FrameworkType, ReportFormat } from '../types/config.js';

const VALID_MODES = new Set<PluginMode>(['warn', 'error', 'report-only']);
const VALID_SEVERITIES = new Set<Severity>(['error', 'warn', 'info', 'off']);
const VALID_FRAMEWORKS = new Set<FrameworkType>(['react', 'vue', 'svelte', 'solid']);
const VALID_REPORTS = new Set<ReportFormat>(['stylish', 'default', 'json', 'sarif', 'html', 'markdown']);

export function validatePluginOptions(options: PluginOptions): void {
  if (options.mode && !VALID_MODES.has(options.mode)) {
    throw new Error(`[vite-plugin-memory-leak-detector] Invalid mode "${options.mode}". Allowed values: 'warn' | 'error' | 'report-only'.`);
  }

  if (options.frameworks && options.frameworks !== 'auto') {
    if (!Array.isArray(options.frameworks)) {
      throw new Error(`[vite-plugin-memory-leak-detector] "frameworks" must be 'auto' or an array of ('react' | 'vue' | 'svelte' | 'solid').`);
    }
    for (const fw of options.frameworks) {
      if (!VALID_FRAMEWORKS.has(fw)) {
        throw new Error(`[vite-plugin-memory-leak-detector] Unsupported framework "${fw}". Valid options: ${[...VALID_FRAMEWORKS].join(', ')}.`);
      }
    }
  }

  if (options.reports) {
    const reportList = Array.isArray(options.reports) ? options.reports : [options.reports];
    for (const item of reportList) {
      const format = typeof item === 'string' ? item : item?.format;
      if (format && !VALID_REPORTS.has(format as ReportFormat)) {
        throw new Error(`[vite-plugin-memory-leak-detector] Unsupported report format "${format}". Valid options: ${[...VALID_REPORTS].join(', ')}.`);
      }
    }
  }

  if (options.rules) {
    for (const [ruleId, config] of Object.entries(options.rules)) {
      const severity = typeof config === 'string' ? config : config?.severity;
      if (severity && !VALID_SEVERITIES.has(severity)) {
        throw new Error(`[vite-plugin-memory-leak-detector] Invalid severity "${severity}" for rule "${ruleId}". Allowed: 'error' | 'warn' | 'info' | 'off'.`);
      }
    }
  }

  if (options.thresholds) {
    const { maxWarnings, maxErrors, maxTotal } = options.thresholds;
    if (maxWarnings !== undefined && (typeof maxWarnings !== 'number' || maxWarnings < 0)) {
      throw new Error(`[vite-plugin-memory-leak-detector] thresholds.maxWarnings must be a non-negative number.`);
    }
    if (maxErrors !== undefined && (typeof maxErrors !== 'number' || maxErrors < 0)) {
      throw new Error(`[vite-plugin-memory-leak-detector] thresholds.maxErrors must be a non-negative number.`);
    }
    if (maxTotal !== undefined && (typeof maxTotal !== 'number' || maxTotal < 0)) {
      throw new Error(`[vite-plugin-memory-leak-detector] thresholds.maxTotal must be a non-negative number.`);
    }
  }
}
