/**
 * Observation Exporter (Phase 10)
 *
 * Export observations and preference pairs in various formats:
 * - JSON Lines (.jsonl) - Standard format for ML training
 * - JSON (.json) - Human readable, for analysis
 * - CSV (.csv) - For spreadsheet analysis
 */

import { writeFileSync } from 'fs';
import { getRecentObservations, type Observation } from './logger';
import { extractPreferencePairs, type PreferencePair } from './preference-extractor';

export interface ExportOptions {
  /** Output file path */
  outputPath: string;
  /** Format to export */
  format: 'jsonl' | 'json' | 'csv';
  /** Filter by agent */
  agent?: string;
  /** Maximum records to export */
  limit?: number;
  /** Include full content or just metadata */
  includeContent?: boolean;
}

/**
 * Export observations to file
 */
export function exportObservations(options: ExportOptions): {
  success: boolean;
  count: number;
  path: string;
  error?: string;
} {
  const { outputPath, format, agent, limit = 10000, includeContent = true } = options;

  try {
    const observations = getRecentObservations({ limit, agent });

    if (observations.length === 0) {
      return { success: true, count: 0, path: outputPath };
    }

    const data = observations.map(obs => formatObservation(obs, includeContent));

    switch (format) {
      case 'jsonl':
        writeFileSync(outputPath, data.map(d => JSON.stringify(d)).join('\n'));
        break;
      case 'json':
        writeFileSync(outputPath, JSON.stringify(data, null, 2));
        break;
      case 'csv':
        writeFileSync(outputPath, toCsv(data));
        break;
    }

    return { success: true, count: observations.length, path: outputPath };
  } catch (err) {
    return {
      success: false,
      count: 0,
      path: outputPath,
      error: (err as Error).message
    };
  }
}

/**
 * Export preference pairs for DPO training
 */
export function exportPreferencePairs(options: ExportOptions): {
  success: boolean;
  count: number;
  path: string;
  error?: string;
} {
  const { outputPath, format, agent, limit = 10000 } = options;

  try {
    const pairs = extractPreferencePairs({ limit, agent });

    if (pairs.length === 0) {
      return { success: true, count: 0, path: outputPath };
    }

    const data = pairs.map(formatPreferencePair);

    switch (format) {
      case 'jsonl':
        writeFileSync(outputPath, data.map(d => JSON.stringify(d)).join('\n'));
        break;
      case 'json':
        writeFileSync(outputPath, JSON.stringify(data, null, 2));
        break;
      case 'csv':
        writeFileSync(outputPath, toCsv(data));
        break;
    }

    return { success: true, count: pairs.length, path: outputPath };
  } catch (err) {
    return {
      success: false,
      count: 0,
      path: outputPath,
      error: (err as Error).message
    };
  }
}

/**
 * Format observation for export
 */
function formatObservation(obs: Observation, includeContent: boolean): Record<string, unknown> {
  const base = {
    id: obs.id,
    sessionId: obs.sessionId,
    timestamp: obs.timestamp,
    agent: obs.agent,
    model: obs.model,
    durationMs: obs.durationMs,
    tokensIn: obs.tokensIn,
    tokensOut: obs.tokensOut
  };

  if (!includeContent) {
    return {
      ...base,
      hasPrompt: !!obs.prompt,
      hasResponse: !!obs.response,
      hasProposedFiles: !!obs.proposedFiles,
      hasAcceptedFiles: !!obs.acceptedFiles,
      hasRejectedFiles: !!obs.rejectedFiles,
      hasUserEdits: !!obs.userEdits
    };
  }

  return {
    ...base,
    prompt: obs.prompt,
    injectedContext: obs.injectedContext,
    response: obs.response,
    explanation: obs.explanation,
    proposedFiles: obs.proposedFiles ? JSON.parse(obs.proposedFiles) : null,
    acceptedFiles: obs.acceptedFiles ? JSON.parse(obs.acceptedFiles) : null,
    rejectedFiles: obs.rejectedFiles ? JSON.parse(obs.rejectedFiles) : null,
    userEdits: obs.userEdits ? JSON.parse(obs.userEdits) : null,
    finalFiles: obs.finalFiles ? JSON.parse(obs.finalFiles) : null
  };
}

/**
 * Format preference pair for export (DPO format)
 */
function formatPreferencePair(pair: PreferencePair): Record<string, unknown> {
  return {
    prompt: pair.prompt,
    chosen: pair.chosen,
    rejected: pair.rejected,
    agent: pair.agent,
    model: pair.model,
    timestamp: pair.timestamp,
    signal_type: pair.signalType
  };
}

/**
 * Convert array of objects to CSV
 */
function toCsv(data: Record<string, unknown>[]): string {
  if (data.length === 0) return '';

  const headers = Object.keys(data[0]);
  const rows = data.map(row =>
    headers.map(h => {
      const val = row[h];
      if (val === null || val === undefined) return '';
      if (typeof val === 'object') return `"${JSON.stringify(val).replace(/"/g, '""')}"`;
      if (typeof val === 'string' && (val.includes(',') || val.includes('"') || val.includes('\n'))) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return String(val);
    }).join(',')
  );

  return [headers.join(','), ...rows].join('\n');
}

/**
 * Get export summary without writing file
 */
export function getExportSummary(options: { agent?: string } = {}): {
  observations: number;
  preferencePairs: number;
  bySignalType: Record<string, number>;
} {
  const observations = getRecentObservations({ limit: 100000, agent: options.agent });
  const pairs = extractPreferencePairs({ limit: 100000, agent: options.agent });

  const bySignalType: Record<string, number> = {};
  for (const pair of pairs) {
    bySignalType[pair.signalType] = (bySignalType[pair.signalType] || 0) + 1;
  }

  return {
    observations: observations.length,
    preferencePairs: pairs.length,
    bySignalType
  };
}
