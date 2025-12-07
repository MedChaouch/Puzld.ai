/**
 * Agent Session Manager
 *
 * Persistent conversation storage for TUI chat mode.
 * Handles session CRUD, token tracking, and auto-summarization.
 *
 * Storage: ~/.puzldai/sessions/<session_id>.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { getConfigDir } from '../lib/config';
import { estimateTokens } from '../context/tokens';
import { summarizeIfNeeded, isSummarizerAvailable } from '../context/summarizer';

/**
 * Message in a session
 */
export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  tokens: number;
  timestamp: number;
}

/**
 * Agent session with conversation history
 */
export interface AgentSession {
  id: string;
  agent: string;
  messages: Message[];
  summary: string;           // Running summary of old messages
  summaryTokens: number;
  totalTokens: number;       // Current token count
  messageCount: number;      // Current session message count
  createdAt: number;
  updatedAt: number;
}

/**
 * Session metadata for listing
 */
export interface SessionMeta {
  id: string;
  agent: string;
  messageCount: number;
  totalTokens: number;
  createdAt: number;
  updatedAt: number;
  preview: string;           // First user message or summary
}

/**
 * Session manager configuration
 */
export interface SessionConfig {
  // Max tokens before summarization kicks in
  maxTokens?: number;

  // Keep this many recent messages unsummarized
  keepRecentMessages?: number;

  // Auto-save after each message
  autoSave?: boolean;
}

const DEFAULT_CONFIG: Required<SessionConfig> = {
  maxTokens: 8000,
  keepRecentMessages: 10,
  autoSave: true
};

/**
 * Get sessions directory path
 */
export function getSessionsDir(): string {
  return join(getConfigDir(), 'sessions');
}

/**
 * Ensure sessions directory exists
 */
function ensureSessionsDir(): void {
  const dir = getSessionsDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Get session file path
 */
function getSessionPath(sessionId: string): string {
  return join(getSessionsDir(), `${sessionId}.json`);
}

/**
 * Generate a session ID
 */
function generateSessionId(agent: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 6);
  return `${agent}_${timestamp}_${random}`;
}

/**
 * Create a new session
 */
export function createSession(agent: string): AgentSession {
  ensureSessionsDir();

  const session: AgentSession = {
    id: generateSessionId(agent),
    agent,
    messages: [],
    summary: '',
    summaryTokens: 0,
    totalTokens: 0,
    messageCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  saveSession(session);
  return session;
}

/**
 * Load a session by ID
 */
export function loadSession(sessionId: string): AgentSession | null {
  const path = getSessionPath(sessionId);

  if (!existsSync(path)) {
    return null;
  }

  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as AgentSession;
  } catch {
    return null;
  }
}

/**
 * Save a session
 */
export function saveSession(session: AgentSession): void {
  ensureSessionsDir();
  const path = getSessionPath(session.id);
  writeFileSync(path, JSON.stringify(session, null, 2));
}

/**
 * Delete a session
 */
export function deleteSession(sessionId: string): boolean {
  const path = getSessionPath(sessionId);

  if (!existsSync(path)) {
    return false;
  }

  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * List all sessions
 */
export function listSessions(agent?: string): SessionMeta[] {
  ensureSessionsDir();
  const dir = getSessionsDir();

  try {
    const files = readdirSync(dir).filter(f => f.endsWith('.json'));
    const sessions: SessionMeta[] = [];

    for (const file of files) {
      const session = loadSession(file.replace('.json', ''));
      if (!session) continue;

      // Filter by agent if specified
      if (agent && session.agent !== agent) continue;

      // Get preview from first user message or summary
      const firstUserMsg = session.messages.find(m => m.role === 'user');
      const preview = firstUserMsg?.content.slice(0, 100) || session.summary.slice(0, 100) || '(empty)';

      sessions.push({
        id: session.id,
        agent: session.agent,
        messageCount: session.messageCount,
        totalTokens: session.totalTokens,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        preview: preview.length === 100 ? preview + '...' : preview
      });
    }

    // Sort by most recent first
    return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

/**
 * Get or create the latest session for an agent
 */
export function getLatestSession(agent: string): AgentSession {
  const sessions = listSessions(agent);

  if (sessions.length > 0) {
    const latest = loadSession(sessions[0].id);
    if (latest) return latest;
  }

  return createSession(agent);
}

/**
 * Add a message to a session
 */
export async function addMessage(
  session: AgentSession,
  role: 'user' | 'assistant' | 'system',
  content: string,
  config: SessionConfig = {}
): Promise<AgentSession> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const tokens = estimateTokens(content);

  const message: Message = {
    role,
    content,
    tokens,
    timestamp: Date.now()
  };

  // Add message
  const messages = [...session.messages, message];
  const totalTokens = session.totalTokens + tokens;

  let updatedSession: AgentSession = {
    ...session,
    messages,
    totalTokens,
    messageCount: session.messageCount + 1,
    updatedAt: Date.now()
  };

  // Check if we need to summarize
  if (totalTokens > cfg.maxTokens) {
    updatedSession = await compressSession(updatedSession, cfg);
  }

  // Auto-save
  if (cfg.autoSave) {
    saveSession(updatedSession);
  }

  return updatedSession;
}

/**
 * Compress session by summarizing old messages
 */
async function compressSession(
  session: AgentSession,
  config: Required<SessionConfig>
): Promise<AgentSession> {
  const { keepRecentMessages, maxTokens } = config;

  // Split messages: old (to summarize) and recent (to keep)
  const splitIndex = Math.max(0, session.messages.length - keepRecentMessages);
  const oldMessages = session.messages.slice(0, splitIndex);
  const recentMessages = session.messages.slice(splitIndex);

  if (oldMessages.length === 0) {
    // Nothing to summarize, just truncate recent if needed
    return session;
  }

  // Build text to summarize
  const oldText = oldMessages
    .map(m => `${m.role}: ${m.content}`)
    .join('\n\n');

  // Include existing summary if any
  const textToSummarize = session.summary
    ? `Previous summary:\n${session.summary}\n\nNew messages:\n${oldText}`
    : oldText;

  // Target summary size
  const recentTokens = recentMessages.reduce((sum, m) => sum + m.tokens, 0);
  const targetSummaryTokens = Math.floor((maxTokens - recentTokens) * 0.3);

  let newSummary = session.summary;
  let summaryTokens = session.summaryTokens;

  // Try to summarize if Ollama is available
  if (await isSummarizerAvailable()) {
    try {
      newSummary = await summarizeIfNeeded(textToSummarize, targetSummaryTokens);
      summaryTokens = estimateTokens(newSummary);
    } catch {
      // Fallback: truncate old summary + new content
      newSummary = textToSummarize.slice(0, targetSummaryTokens * 4);
      summaryTokens = estimateTokens(newSummary);
    }
  } else {
    // No summarizer: simple truncation
    newSummary = textToSummarize.slice(0, targetSummaryTokens * 4);
    summaryTokens = estimateTokens(newSummary);
  }

  const newTotalTokens = summaryTokens + recentTokens;

  return {
    ...session,
    messages: recentMessages,
    summary: newSummary,
    summaryTokens,
    totalTokens: newTotalTokens,
    updatedAt: Date.now()
  };
}

/**
 * Get conversation history formatted for agent
 */
export function getConversationHistory(
  session: AgentSession,
  includeSystem: boolean = false
): string {
  const parts: string[] = [];

  // Add summary if exists
  if (session.summary) {
    parts.push(`<conversation_summary>\n${session.summary}\n</conversation_summary>`);
  }

  // Add recent messages
  for (const msg of session.messages) {
    if (msg.role === 'system' && !includeSystem) continue;
    parts.push(`${msg.role}: ${msg.content}`);
  }

  return parts.join('\n\n');
}

/**
 * Search sessions by keyword
 */
export function searchSessions(keyword: string, agent?: string): SessionMeta[] {
  const allSessions = listSessions(agent);
  const lowerKeyword = keyword.toLowerCase();

  return allSessions.filter(meta => {
    // Load full session to search content
    const session = loadSession(meta.id);
    if (!session) return false;

    // Search in messages
    const hasMatch = session.messages.some(m =>
      m.content.toLowerCase().includes(lowerKeyword)
    );

    // Search in summary
    const summaryMatch = session.summary.toLowerCase().includes(lowerKeyword);

    return hasMatch || summaryMatch;
  });
}

/**
 * Get session stats
 */
export function getSessionStats(session: AgentSession): {
  messageCount: number;
  totalTokens: number;
  summaryTokens: number;
  recentTokens: number;
  compressionRatio: number;
  oldestMessage: number | null;
  newestMessage: number | null;
} {
  const recentTokens = session.messages.reduce((sum, m) => sum + m.tokens, 0);
  const timestamps = session.messages.map(m => m.timestamp);

  return {
    messageCount: session.messageCount,
    totalTokens: session.totalTokens,
    summaryTokens: session.summaryTokens,
    recentTokens,
    compressionRatio: session.summaryTokens > 0
      ? Math.round((1 - session.summaryTokens / (session.totalTokens - recentTokens + session.summaryTokens)) * 100)
      : 0,
    oldestMessage: timestamps.length > 0 ? Math.min(...timestamps) : null,
    newestMessage: timestamps.length > 0 ? Math.max(...timestamps) : null
  };
}

/**
 * Clear session history but keep session identity
 */
export function clearSessionHistory(session: AgentSession): AgentSession {
  const cleared: AgentSession = {
    ...session,
    messages: [],
    summary: '',
    summaryTokens: 0,
    totalTokens: 0,
    messageCount: 0,
    updatedAt: Date.now()
  };

  saveSession(cleared);
  return cleared;
}
