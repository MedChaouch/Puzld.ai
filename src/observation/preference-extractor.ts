/**
 * Preference Extractor (Phase 10)
 *
 * Generates DPO (Direct Preference Optimization) training pairs from observations.
 * When user accepts some files and rejects others, or edits content,
 * we can create preference pairs for fine-tuning.
 */

import { getDatabase } from '../memory/database';
import type { Observation } from './logger';

/**
 * A DPO training pair: chosen (preferred) vs rejected response
 */
export interface PreferencePair {
  /** The input prompt */
  prompt: string;
  /** Context that was injected */
  context?: string;
  /** The preferred response (accepted or user-edited) */
  chosen: string;
  /** The rejected response (original if edited, or rejected proposal) */
  rejected: string;
  /** Agent that generated the response */
  agent: string;
  /** Model used */
  model?: string;
  /** Timestamp */
  timestamp: number;
  /** Source observation ID */
  observationId: number;
  /** Type of preference signal */
  signalType: 'accept_reject' | 'user_edit' | 'full_reject';
}

/**
 * Extract preference pairs from observations
 */
export function extractPreferencePairs(options: {
  limit?: number;
  agent?: string;
  minEdits?: number;
} = {}): PreferencePair[] {
  const { limit = 1000, agent, minEdits = 1 } = options;
  const db = getDatabase();

  let sql = `
    SELECT * FROM observations
    WHERE (
      (accepted_files IS NOT NULL AND rejected_files IS NOT NULL)
      OR user_edits IS NOT NULL
    )
  `;
  const params: (string | number)[] = [];

  if (agent) {
    sql += ' AND agent = ?';
    params.push(agent);
  }

  sql += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(limit);

  const rows = db.prepare(sql).all(...params) as Array<{
    id: number;
    session_id: string | null;
    timestamp: number;
    prompt: string;
    injected_context: string | null;
    agent: string;
    model: string | null;
    response: string | null;
    explanation: string | null;
    proposed_files: string | null;
    accepted_files: string | null;
    rejected_files: string | null;
    user_edits: string | null;
    final_files: string | null;
  }>;

  const pairs: PreferencePair[] = [];

  for (const row of rows) {
    const observationPairs = extractFromObservation(row, minEdits);
    pairs.push(...observationPairs);
  }

  return pairs;
}

/**
 * Extract preference pairs from a single observation
 */
function extractFromObservation(
  row: {
    id: number;
    timestamp: number;
    prompt: string;
    injected_context: string | null;
    agent: string;
    model: string | null;
    response: string | null;
    proposed_files: string | null;
    accepted_files: string | null;
    rejected_files: string | null;
    user_edits: string | null;
    final_files: string | null;
  },
  minEdits: number
): PreferencePair[] {
  const pairs: PreferencePair[] = [];

  const proposed = row.proposed_files ? JSON.parse(row.proposed_files) as Array<{
    path: string;
    operation: string;
    content?: string;
  }> : [];
  const accepted = row.accepted_files ? JSON.parse(row.accepted_files) as string[] : [];
  const rejected = row.rejected_files ? JSON.parse(row.rejected_files) as string[] : [];
  const userEdits = row.user_edits ? JSON.parse(row.user_edits) as Record<string, string> : {};
  const finalFiles = row.final_files ? JSON.parse(row.final_files) as Record<string, string> : {};

  // Type 1: Accept/Reject pairs - same prompt, different files
  if (accepted.length > 0 && rejected.length > 0) {
    const acceptedContent = proposed
      .filter(p => accepted.includes(p.path) && p.content)
      .map(p => `// ${p.path}\n${p.content}`)
      .join('\n\n');

    const rejectedContent = proposed
      .filter(p => rejected.includes(p.path) && p.content)
      .map(p => `// ${p.path}\n${p.content}`)
      .join('\n\n');

    if (acceptedContent && rejectedContent) {
      pairs.push({
        prompt: row.prompt,
        context: row.injected_context || undefined,
        chosen: acceptedContent,
        rejected: rejectedContent,
        agent: row.agent,
        model: row.model || undefined,
        timestamp: row.timestamp,
        observationId: row.id,
        signalType: 'accept_reject'
      });
    }
  }

  // Type 2: User edit pairs - original vs edited
  const editedPaths = Object.keys(userEdits);
  if (editedPaths.length >= minEdits) {
    for (const path of editedPaths) {
      const original = proposed.find(p => p.path === path)?.content;
      const final = finalFiles[path];

      if (original && final && original !== final) {
        pairs.push({
          prompt: row.prompt,
          context: row.injected_context || undefined,
          chosen: `// ${path}\n${final}`,
          rejected: `// ${path}\n${original}`,
          agent: row.agent,
          model: row.model || undefined,
          timestamp: row.timestamp,
          observationId: row.id,
          signalType: 'user_edit'
        });
      }
    }
  }

  // Type 3: Full rejection (all files rejected)
  if (rejected.length > 0 && accepted.length === 0 && row.response) {
    pairs.push({
      prompt: row.prompt,
      context: row.injected_context || undefined,
      chosen: '[USER_REJECTED_ALL]', // Placeholder - needs human labeling
      rejected: row.response,
      agent: row.agent,
      model: row.model || undefined,
      timestamp: row.timestamp,
      observationId: row.id,
      signalType: 'full_reject'
    });
  }

  return pairs;
}

/**
 * Get statistics about available preference data
 */
export function getPreferenceStats(): {
  totalObservations: number;
  withAcceptReject: number;
  withUserEdits: number;
  withFullReject: number;
  byAgent: Record<string, number>;
} {
  const db = getDatabase();

  const total = (db.prepare('SELECT COUNT(*) as count FROM observations').get() as { count: number }).count;

  const withAcceptReject = (db.prepare(`
    SELECT COUNT(*) as count FROM observations
    WHERE accepted_files IS NOT NULL AND accepted_files != '[]'
    AND rejected_files IS NOT NULL AND rejected_files != '[]'
  `).get() as { count: number }).count;

  const withUserEdits = (db.prepare(`
    SELECT COUNT(*) as count FROM observations
    WHERE user_edits IS NOT NULL AND user_edits != '{}'
  `).get() as { count: number }).count;

  const withFullReject = (db.prepare(`
    SELECT COUNT(*) as count FROM observations
    WHERE rejected_files IS NOT NULL AND rejected_files != '[]'
    AND (accepted_files IS NULL OR accepted_files = '[]')
  `).get() as { count: number }).count;

  const byAgentRows = db.prepare(`
    SELECT agent, COUNT(*) as count FROM observations
    WHERE accepted_files IS NOT NULL OR rejected_files IS NOT NULL OR user_edits IS NOT NULL
    GROUP BY agent
  `).all() as Array<{ agent: string; count: number }>;

  const byAgent: Record<string, number> = {};
  for (const row of byAgentRows) {
    byAgent[row.agent] = row.count;
  }

  return {
    totalObservations: total,
    withAcceptReject,
    withUserEdits,
    withFullReject,
    byAgent
  };
}
