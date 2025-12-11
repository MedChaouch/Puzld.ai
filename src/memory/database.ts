/**
 * SQLite Database Layer (Phase 8)
 *
 * Persistent storage for sessions, messages, and tasks.
 * Uses better-sqlite3 for synchronous, fast SQLite operations.
 *
 * Timestamps are Unix epoch milliseconds (Date.now()).
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { getConfigDir } from '../lib/config';

// Database instance (singleton)
let db: Database.Database | null = null;

/**
 * Get database file path
 */
export function getDatabasePath(): string {
  return join(getConfigDir(), 'puzldai.db');
}

/**
 * Initialize database connection and schema
 */
export function initDatabase(): Database.Database {
  if (db) return db;

  // Ensure config directory exists
  const configDir = getConfigDir();
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  const dbPath = getDatabasePath();
  db = new Database(dbPath);

  // Enable WAL mode for better concurrency
  db.pragma('journal_mode = WAL');

  // Create schema
  createSchema(db);

  return db;
}

/**
 * Get database instance (initializes if needed)
 */
export function getDatabase(): Database.Database {
  if (!db) {
    return initDatabase();
  }
  return db;
}

/**
 * Close database connection
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Create database schema
 */
function createSchema(database: Database.Database): void {
  // Metadata table (for schema versioning)
  database.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  // Sessions table
  database.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      agent TEXT NOT NULL,
      summary TEXT DEFAULT '',
      summary_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      message_count INTEGER DEFAULT 0,
      template_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // Messages table
  database.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      tokens INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      metadata TEXT,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);

  // Tasks table (for logging executed tasks)
  database.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      prompt TEXT NOT NULL,
      agent TEXT NOT NULL,
      model TEXT,
      response TEXT,
      error TEXT,
      tokens_in INTEGER,
      tokens_out INTEGER,
      duration_ms INTEGER,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
    )
  `);

  // Create indexes for common queries
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent);
    CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(agent);
    CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at DESC);
  `);

  // Set initial schema version
  database.prepare(
    "INSERT OR IGNORE INTO metadata (key, value) VALUES ('schema_version', '1')"
  ).run();

  // Run migrations
  runMigrations(database);
}

/**
 * Run all migrations
 */
function runMigrations(database: Database.Database): void {
  const currentVersion = parseInt(
    (database.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get() as { value: string })?.value || '1',
    10
  );

  // Migration 2: Add observations table (Phase 10)
  if (currentVersion < 2) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        timestamp INTEGER NOT NULL,

        -- Input
        prompt TEXT NOT NULL,
        injected_context TEXT,
        agent TEXT NOT NULL,
        model TEXT,

        -- Output
        response TEXT,
        explanation TEXT,
        proposed_files TEXT,

        -- Review decisions
        accepted_files TEXT,
        rejected_files TEXT,

        -- User modifications
        user_edits TEXT,
        final_files TEXT,

        -- Metadata
        duration_ms INTEGER,
        tokens_in INTEGER,
        tokens_out INTEGER,

        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_observations_session ON observations(session_id);
      CREATE INDEX IF NOT EXISTS idx_observations_agent ON observations(agent);
      CREATE INDEX IF NOT EXISTS idx_observations_timestamp ON observations(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_observations_model ON observations(model);
    `);

    database.prepare("UPDATE metadata SET value = '2' WHERE key = 'schema_version'").run();
  }
}

/**
 * Get current schema version
 */
export function getSchemaVersion(): number {
  const database = getDatabase();
  const row = database.prepare(
    "SELECT value FROM metadata WHERE key = 'schema_version'"
  ).get() as { value: string } | undefined;

  return row ? parseInt(row.value, 10) : 0;
}

/**
 * Run a migration (for future schema changes)
 */
export function runMigration(version: number, sql: string): void {
  const database = getDatabase();
  const currentVersion = getSchemaVersion();

  if (currentVersion < version) {
    database.exec(sql);
    database.prepare(
      "INSERT OR REPLACE INTO metadata (key, value) VALUES ('schema_version', ?)"
    ).run(version.toString());
  }
}

/**
 * Check if database is initialized
 */
export function isDatabaseInitialized(): boolean {
  return db !== null;
}
