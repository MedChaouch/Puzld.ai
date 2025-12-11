/**
 * Observation Logger (Phase 10)
 *
 * Logs all interactions for training data generation.
 * Captures: prompts, responses, review decisions, user edits.
 */

import { getDatabase } from '../memory/database';
import { addMemory } from '../memory/vector-store';

export interface ObservationInput {
  sessionId?: string;
  prompt: string;
  injectedContext?: string;
  agent: string;
  model?: string;
}

export interface ObservationOutput {
  response?: string;
  explanation?: string;
  proposedFiles?: Array<{ path: string; operation: string; content?: string }>;
  durationMs?: number;
  tokensIn?: number;
  tokensOut?: number;
}

export interface ReviewDecision {
  acceptedFiles?: string[];
  rejectedFiles?: string[];
  userEdits?: Record<string, string>; // path -> diff
  finalFiles?: Record<string, string>; // path -> final content
}

export interface Observation {
  id?: number;
  sessionId?: string;
  timestamp: number;
  prompt: string;
  injectedContext?: string;
  agent: string;
  model?: string;
  response?: string;
  explanation?: string;
  proposedFiles?: string; // JSON
  acceptedFiles?: string; // JSON
  rejectedFiles?: string; // JSON
  userEdits?: string; // JSON
  finalFiles?: string; // JSON
  durationMs?: number;
  tokensIn?: number;
  tokensOut?: number;
}

// Helper to map DB row to Observation
function mapRowToObservation(row: {
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
  duration_ms: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
}): Observation {
  return {
    id: row.id,
    sessionId: row.session_id || undefined,
    timestamp: row.timestamp,
    prompt: row.prompt,
    injectedContext: row.injected_context || undefined,
    agent: row.agent,
    model: row.model || undefined,
    response: row.response || undefined,
    explanation: row.explanation || undefined,
    proposedFiles: row.proposed_files || undefined,
    acceptedFiles: row.accepted_files || undefined,
    rejectedFiles: row.rejected_files || undefined,
    userEdits: row.user_edits || undefined,
    finalFiles: row.final_files || undefined,
    durationMs: row.duration_ms || undefined,
    tokensIn: row.tokens_in || undefined,
    tokensOut: row.tokens_out || undefined
  };
}

/**
 * Start a new observation (called when prompt is sent)
 */
export function startObservation(input: ObservationInput): number {
  const db = getDatabase();
  const now = Date.now();

  const result = db.prepare(`
    INSERT INTO observations (
      session_id, timestamp, prompt, injected_context, agent, model
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    input.sessionId || null,
    now,
    input.prompt,
    input.injectedContext || null,
    input.agent,
    input.model || null
  );

  return result.lastInsertRowid as number;
}

/**
 * Update observation with response (called when response received)
 */
export function logResponse(observationId: number, output: ObservationOutput): void {
  const db = getDatabase();

  db.prepare(`
    UPDATE observations SET
      response = ?,
      explanation = ?,
      proposed_files = ?,
      duration_ms = ?,
      tokens_in = ?,
      tokens_out = ?
    WHERE id = ?
  `).run(
    output.response || null,
    output.explanation || null,
    output.proposedFiles ? JSON.stringify(output.proposedFiles) : null,
    output.durationMs || null,
    output.tokensIn || null,
    output.tokensOut || null,
    observationId
  );
}

/**
 * Update observation with review decisions (called after user review)
 */
export function logReviewDecision(observationId: number, decision: ReviewDecision): void {
  const db = getDatabase();

  db.prepare(`
    UPDATE observations SET
      accepted_files = ?,
      rejected_files = ?,
      user_edits = ?,
      final_files = ?
    WHERE id = ?
  `).run(
    decision.acceptedFiles ? JSON.stringify(decision.acceptedFiles) : null,
    decision.rejectedFiles ? JSON.stringify(decision.rejectedFiles) : null,
    decision.userEdits ? JSON.stringify(decision.userEdits) : null,
    decision.finalFiles ? JSON.stringify(decision.finalFiles) : null,
    observationId
  );
}

/**
 * Complete observation and save to memory store
 */
export async function completeObservation(observationId: number): Promise<void> {
  const obs = getObservation(observationId);
  if (!obs) return;

  // Save accepted decisions to memory for future retrieval
  if (obs.acceptedFiles && obs.explanation) {
    const acceptedPaths = JSON.parse(obs.acceptedFiles) as string[];
    if (acceptedPaths.length > 0) {
      await addMemory({
        type: 'decision',
        content: `Task: ${obs.prompt}\nDecision: ${obs.explanation}\nFiles: ${acceptedPaths.join(', ')}`,
        metadata: {
          agent: obs.agent,
          model: obs.model,
          observationId: obs.id,
          timestamp: obs.timestamp
        }
      });
    }
  }

  // Save conversation summary to memory
  if (obs.response) {
    await addMemory({
      type: 'conversation',
      content: `Q: ${obs.prompt.slice(0, 200)}${obs.prompt.length > 200 ? '...' : ''}\nA: ${obs.explanation || obs.response.slice(0, 300)}`,
      metadata: {
        agent: obs.agent,
        model: obs.model,
        observationId: obs.id,
        timestamp: obs.timestamp
      }
    });
  }
}

/**
 * Get a single observation
 */
export function getObservation(id: number): Observation | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM observations WHERE id = ?').get(id);
  if (!row) return null;
  return mapRowToObservation(row as Parameters<typeof mapRowToObservation>[0]);
}

/**
 * Get recent observations
 */
export function getRecentObservations(options: {
  limit?: number;
  agent?: string;
  sessionId?: string;
} = {}): Observation[] {
  const db = getDatabase();
  const { limit = 50, agent, sessionId } = options;

  let sql = 'SELECT * FROM observations WHERE 1=1';
  const params: (string | number)[] = [];

  if (agent) {
    sql += ' AND agent = ?';
    params.push(agent);
  }

  if (sessionId) {
    sql += ' AND session_id = ?';
    params.push(sessionId);
  }

  sql += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(limit);

  const rows = db.prepare(sql).all(...params);
  return rows.map(row => mapRowToObservation(row as Parameters<typeof mapRowToObservation>[0]));
}

/**
 * Get observation stats
 */
export function getObservationStats(): {
  total: number;
  byAgent: Record<string, number>;
  withAccepted: number;
  withRejected: number;
} {
  const db = getDatabase();

  const total = (db.prepare('SELECT COUNT(*) as count FROM observations').get() as { count: number }).count;

  const byAgentRows = db.prepare(`
    SELECT agent, COUNT(*) as count FROM observations GROUP BY agent
  `).all() as Array<{ agent: string; count: number }>;

  const byAgent: Record<string, number> = {};
  for (const row of byAgentRows) {
    byAgent[row.agent] = row.count;
  }

  const withAccepted = (db.prepare(
    "SELECT COUNT(*) as count FROM observations WHERE accepted_files IS NOT NULL AND accepted_files != '[]'"
  ).get() as { count: number }).count;

  const withRejected = (db.prepare(
    "SELECT COUNT(*) as count FROM observations WHERE rejected_files IS NOT NULL AND rejected_files != '[]'"
  ).get() as { count: number }).count;

  return {
    total,
    byAgent,
    withAccepted,
    withRejected
  };
}
