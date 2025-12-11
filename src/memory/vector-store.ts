/**
 * Vector Store (Phase 11)
 *
 * Storage layer for memory items.
 * Primary: SQLite FTS5 (keyword search)
 * Optional: LanceDB (semantic search with embeddings)
 */

import { getDatabase } from './database';
import { getProvider, embed, EMBEDDING_DIMENSION } from './embeddings';

export type MemoryType = 'conversation' | 'code' | 'decision' | 'pattern' | 'context';

export interface MemoryItem {
  id?: number;
  type: MemoryType;
  content: string;
  metadata?: Record<string, unknown>;
  embedding?: number[];
  createdAt?: number;
  updatedAt?: number;
}

export interface SearchResult {
  item: MemoryItem;
  score: number;
}

let initialized = false;
let lanceDb: unknown = null;
let lanceTable: unknown = null;

/**
 * Initialize vector store tables
 */
export async function initVectorStore(): Promise<void> {
  if (initialized) return;

  const db = getDatabase();

  // Create memory table
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      embedding BLOB,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_memory_type ON memory(type);
    CREATE INDEX IF NOT EXISTS idx_memory_created ON memory(created_at DESC);
  `);

  // Create FTS5 virtual table for full-text search
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      content,
      type,
      content='memory',
      content_rowid='id',
      tokenize='porter unicode61'
    );

    -- Triggers to keep FTS in sync
    CREATE TRIGGER IF NOT EXISTS memory_ai AFTER INSERT ON memory BEGIN
      INSERT INTO memory_fts(rowid, content, type) VALUES (new.id, new.content, new.type);
    END;

    CREATE TRIGGER IF NOT EXISTS memory_ad AFTER DELETE ON memory BEGIN
      INSERT INTO memory_fts(memory_fts, rowid, content, type) VALUES('delete', old.id, old.content, old.type);
    END;

    CREATE TRIGGER IF NOT EXISTS memory_au AFTER UPDATE ON memory BEGIN
      INSERT INTO memory_fts(memory_fts, rowid, content, type) VALUES('delete', old.id, old.content, old.type);
      INSERT INTO memory_fts(rowid, content, type) VALUES (new.id, new.content, new.type);
    END;
  `);

  // Try to initialize LanceDB for semantic search
  if (getProvider() === 'ollama') {
    await initLanceDB();
  }

  initialized = true;
}

/**
 * Initialize LanceDB for vector search (optional)
 */
async function initLanceDB(): Promise<void> {
  try {
    const lancedb = await import('@lancedb/lancedb');
    const { homedir } = await import('os');
    const { join } = await import('path');

    const dbPath = join(homedir(), '.puzldai', 'vectors');
    lanceDb = await lancedb.connect(dbPath);

    // Create or open table
    try {
      lanceTable = await (lanceDb as { openTable: (name: string) => Promise<unknown> }).openTable('memory');
    } catch {
      // Table doesn't exist, will create on first insert
      lanceTable = null;
    }
  } catch {
    // LanceDB not available, fall back to FTS5 only
    lanceDb = null;
    lanceTable = null;
  }
}

/**
 * Add a memory item
 */
export async function addMemory(item: Omit<MemoryItem, 'id' | 'createdAt' | 'updatedAt'>): Promise<number> {
  await initVectorStore();

  const db = getDatabase();
  const now = Math.floor(Date.now() / 1000);

  // Generate embedding if Ollama is available
  let embeddingBlob: Buffer | null = null;
  if (getProvider() === 'ollama') {
    const embedding = await embed(item.content);
    if (embedding) {
      embeddingBlob = Buffer.from(new Float32Array(embedding).buffer);

      // Also add to LanceDB
      await addToLanceDB(item.content, item.type, embedding);
    }
  }

  const result = db.prepare(`
    INSERT INTO memory (type, content, metadata, embedding, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    item.type,
    item.content,
    item.metadata ? JSON.stringify(item.metadata) : null,
    embeddingBlob,
    now,
    now
  );

  return result.lastInsertRowid as number;
}

/**
 * Add to LanceDB for vector search
 */
async function addToLanceDB(content: string, type: string, embedding: number[]): Promise<void> {
  if (!lanceDb) return;

  try {
    const data = [{
      content,
      type,
      vector: embedding,
      timestamp: Date.now()
    }];

    if (!lanceTable) {
      // Create table with first record
      lanceTable = await (lanceDb as { createTable: (name: string, data: unknown[]) => Promise<unknown> })
        .createTable('memory', data);
    } else {
      // Add to existing table
      await (lanceTable as { add: (data: unknown[]) => Promise<void> }).add(data);
    }
  } catch {
    // Silently fail - FTS5 is still available
  }
}

/**
 * Search memory using FTS5 (keyword search)
 */
export function searchFTS(query: string, options: {
  type?: MemoryType;
  limit?: number;
} = {}): SearchResult[] {
  const db = getDatabase();
  const limit = options.limit || 10;

  // Escape special FTS5 characters
  const escapedQuery = query.replace(/['"*()^]/g, ' ').trim();
  if (!escapedQuery) return [];

  let sql = `
    SELECT m.*, bm25(memory_fts) as score
    FROM memory_fts f
    JOIN memory m ON f.rowid = m.id
    WHERE memory_fts MATCH ?
  `;

  const params: (string | number)[] = [escapedQuery];

  if (options.type) {
    sql += ' AND m.type = ?';
    params.push(options.type);
  }

  sql += ' ORDER BY score LIMIT ?';
  params.push(limit);

  try {
    const rows = db.prepare(sql).all(...params) as Array<{
      id: number;
      type: string;
      content: string;
      metadata: string | null;
      embedding: Buffer | null;
      created_at: number;
      updated_at: number;
      score: number;
    }>;

    return rows.map(row => ({
      item: {
        id: row.id,
        type: row.type as MemoryType,
        content: row.content,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      },
      score: Math.abs(row.score) // BM25 returns negative scores
    }));
  } catch {
    return [];
  }
}

/**
 * Search memory using vector similarity (if available)
 */
export async function searchVector(query: string, options: {
  type?: MemoryType;
  limit?: number;
} = {}): Promise<SearchResult[]> {
  if (!lanceTable || getProvider() !== 'ollama') {
    return searchFTS(query, options);
  }

  const limit = options.limit || 10;

  try {
    // Get query embedding
    const queryEmbedding = await embed(query);
    if (!queryEmbedding) {
      return searchFTS(query, options);
    }

    // Search LanceDB
    const searchQuery = (lanceTable as { search: (v: number[]) => { limit: (n: number) => { toArray: () => Promise<unknown[]> } } })
      .search(queryEmbedding)
      .limit(limit);

    const results = await searchQuery.toArray() as Array<{
      content: string;
      type: string;
      _distance: number;
    }>;

    // Filter by type if specified
    let filtered = results;
    if (options.type) {
      filtered = results.filter(r => r.type === options.type);
    }

    return filtered.map(r => ({
      item: {
        type: r.type as MemoryType,
        content: r.content
      },
      score: 1 - r._distance // Convert distance to similarity
    }));
  } catch {
    return searchFTS(query, options);
  }
}

/**
 * Unified search - picks best available method
 */
export async function search(query: string, options: {
  type?: MemoryType;
  limit?: number;
} = {}): Promise<SearchResult[]> {
  await initVectorStore();

  if (lanceTable && getProvider() === 'ollama') {
    return searchVector(query, options);
  }
  return searchFTS(query, options);
}

/**
 * Get recent memory items
 */
export function getRecent(options: {
  type?: MemoryType;
  limit?: number;
} = {}): MemoryItem[] {
  const db = getDatabase();
  const limit = options.limit || 10;

  let sql = 'SELECT * FROM memory';
  const params: (string | number)[] = [];

  if (options.type) {
    sql += ' WHERE type = ?';
    params.push(options.type);
  }

  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  const rows = db.prepare(sql).all(...params) as Array<{
    id: number;
    type: string;
    content: string;
    metadata: string | null;
    created_at: number;
    updated_at: number;
  }>;

  return rows.map(row => ({
    id: row.id,
    type: row.type as MemoryType,
    content: row.content,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

/**
 * Delete a memory item
 */
export function deleteMemory(id: number): boolean {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM memory WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * Get memory stats
 */
export function getMemoryStats(): {
  total: number;
  byType: Record<MemoryType, number>;
  hasVectorSearch: boolean;
} {
  const db = getDatabase();

  const total = (db.prepare('SELECT COUNT(*) as count FROM memory').get() as { count: number }).count;

  const byTypeRows = db.prepare(`
    SELECT type, COUNT(*) as count FROM memory GROUP BY type
  `).all() as Array<{ type: string; count: number }>;

  const byType: Record<MemoryType, number> = {
    conversation: 0,
    code: 0,
    decision: 0,
    pattern: 0,
    context: 0
  };

  for (const row of byTypeRows) {
    byType[row.type as MemoryType] = row.count;
  }

  return {
    total,
    byType,
    hasVectorSearch: lanceTable !== null
  };
}
