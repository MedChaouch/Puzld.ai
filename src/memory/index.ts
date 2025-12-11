/**
 * Memory Management
 *
 * Session persistence and storage for TUI chat mode.
 * Uses SQLite for persistent storage (Phase 8).
 * RAG/Vector search for context retrieval (Phase 11).
 */

// SQLite Database Layer
export {
  initDatabase,
  getDatabase,
  closeDatabase,
  getDatabasePath,
  getSchemaVersion,
  runMigration,
  isDatabaseInitialized
} from './database';

// SQLite-backed Sessions (Phase 8 - recommended)
export {
  createSession,
  loadSession,
  saveSession,
  deleteSession,
  listSessions,
  getLatestSession,
  addMessage,
  getConversationHistory,
  searchSessions,
  getSessionStats,
  clearSessionHistory,
  getSessionCount,
  type Message,
  type AgentSession,
  type SessionMeta,
  type SessionConfig
} from './sqlite-sessions';

// Legacy JSON sessions (for migration/fallback)
export {
  getSessionsDir,
  listSessions as listJsonSessions,
  loadSession as loadJsonSession
} from './sessions';

// Embeddings (Phase 11)
export {
  initEmbeddings,
  getProvider,
  getEmbeddingModel,
  isOllamaAvailable,
  embed,
  embedBatch,
  cosineSimilarity,
  type EmbeddingProvider,
  EMBEDDING_DIMENSION
} from './embeddings';

// Vector Store (Phase 11)
export {
  initVectorStore,
  addMemory,
  search,
  searchFTS,
  searchVector,
  getRecent,
  deleteMemory,
  getMemoryStats,
  type MemoryItem,
  type MemoryType,
  type SearchResult
} from './vector-store';

// Retriever (Phase 11)
export {
  retrieve,
  retrieveByType,
  retrieveConversationContext,
  retrieveCodeContext,
  retrieveDecisionContext,
  retrievePatternContext,
  buildContext,
  type SearchMethod,
  type RetrievalOptions,
  type RetrievalResult
} from './retriever';

// Injector (Phase 11)
export {
  buildInjection,
  buildInjectionForAgent,
  formatItem,
  getFormatForAgent,
  type InjectionFormat,
  type InjectionOptions,
  type InjectionResult
} from './injector';
