/**
 * Retriever (Phase 11)
 *
 * High-level interface for retrieving relevant memory items.
 * Combines search results with ranking and filtering.
 */

import {
  search,
  getRecent,
  type MemoryItem,
  type MemoryType,
  type SearchResult
} from './vector-store';
import { getProvider } from './embeddings';

export type SearchMethod = 'vector' | 'fts5' | 'recency';

export interface RetrievalOptions {
  /** Maximum items to return */
  limit?: number;
  /** Filter by memory type */
  types?: MemoryType[];
  /** Include recent items even if no query match */
  includeRecent?: boolean;
  /** Minimum relevance score (0-1) */
  minScore?: number;
  /** Maximum total tokens for results */
  maxTokens?: number;
}

export interface RetrievalResult {
  items: MemoryItem[];
  totalTokens: number;
  searchMethod: SearchMethod;
}

// Rough token estimation (4 chars per token)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Retrieve relevant memory items for a query
 */
export async function retrieve(
  query: string,
  options: RetrievalOptions = {}
): Promise<RetrievalResult> {
  const {
    limit = 10,
    types,
    includeRecent = true,
    minScore = 0.1,
    maxTokens = 4000
  } = options;

  const searchMethod: SearchMethod = getProvider() === 'ollama' ? 'vector' : 'fts5';
  const results: SearchResult[] = [];

  // Search by each type if specified, otherwise search all
  if (types && types.length > 0) {
    for (const type of types) {
      const typeResults = await search(query, { type, limit: Math.ceil(limit / types.length) });
      results.push(...typeResults);
    }
  } else {
    const allResults = await search(query, { limit });
    results.push(...allResults);
  }

  // Filter by minimum score
  let filtered = results.filter(r => r.score >= minScore);

  // Sort by score descending
  filtered.sort((a, b) => b.score - a.score);

  // Add recent items if requested and we have room
  if (includeRecent && filtered.length < limit) {
    const recentOptions: { type?: MemoryType; limit: number } = {
      limit: limit - filtered.length
    };

    // Get recent for first type if specified
    if (types && types.length > 0) {
      recentOptions.type = types[0];
    }

    const recentItems = getRecent(recentOptions);

    // Add recent items that aren't already in results
    const existingIds = new Set(filtered.map(r => r.item.id));
    for (const item of recentItems) {
      if (!existingIds.has(item.id)) {
        filtered.push({
          item,
          score: 0.05 // Low score for recency-only items
        });
      }
    }
  }

  // Truncate to limit
  filtered = filtered.slice(0, limit);

  // Respect token limit
  const items: MemoryItem[] = [];
  let totalTokens = 0;

  for (const result of filtered) {
    const itemTokens = estimateTokens(result.item.content);

    if (totalTokens + itemTokens > maxTokens) {
      break;
    }

    items.push(result.item);
    totalTokens += itemTokens;
  }

  return {
    items,
    totalTokens,
    searchMethod
  };
}

/**
 * Retrieve items by type with recency ranking
 */
export function retrieveByType(
  type: MemoryType,
  options: { limit?: number; maxTokens?: number } = {}
): RetrievalResult {
  const { limit = 10, maxTokens = 4000 } = options;

  const recentItems = getRecent({ type, limit });

  const items: MemoryItem[] = [];
  let totalTokens = 0;

  for (const item of recentItems) {
    const itemTokens = estimateTokens(item.content);

    if (totalTokens + itemTokens > maxTokens) {
      break;
    }

    items.push(item);
    totalTokens += itemTokens;
  }

  return {
    items,
    totalTokens,
    searchMethod: 'recency'
  };
}

/**
 * Retrieve conversation context (summaries from past sessions)
 */
export async function retrieveConversationContext(
  query: string,
  options: { limit?: number; maxTokens?: number } = {}
): Promise<RetrievalResult> {
  return retrieve(query, {
    ...options,
    types: ['conversation'],
    includeRecent: true
  });
}

/**
 * Retrieve code context
 */
export async function retrieveCodeContext(
  query: string,
  options: { limit?: number; maxTokens?: number } = {}
): Promise<RetrievalResult> {
  return retrieve(query, {
    ...options,
    types: ['code'],
    includeRecent: false
  });
}

/**
 * Retrieve decision context (past accepted changes)
 */
export async function retrieveDecisionContext(
  query: string,
  options: { limit?: number; maxTokens?: number } = {}
): Promise<RetrievalResult> {
  return retrieve(query, {
    ...options,
    types: ['decision'],
    includeRecent: true
  });
}

/**
 * Retrieve pattern context (user preferences)
 */
export async function retrievePatternContext(
  query: string,
  options: { limit?: number; maxTokens?: number } = {}
): Promise<RetrievalResult> {
  return retrieve(query, {
    ...options,
    types: ['pattern'],
    includeRecent: true,
    minScore: 0 // Always include patterns if they exist
  });
}

/**
 * Build a combined context from multiple retrieval types
 */
export async function buildContext(
  query: string,
  options: {
    maxTokens?: number;
    includeConversation?: boolean;
    includeCode?: boolean;
    includeDecisions?: boolean;
    includePatterns?: boolean;
  } = {}
): Promise<{
  items: MemoryItem[];
  totalTokens: number;
  breakdown: Record<MemoryType, number>;
}> {
  const {
    maxTokens = 4000,
    includeConversation = true,
    includeCode = true,
    includeDecisions = true,
    includePatterns = true
  } = options;

  const types: MemoryType[] = [];
  if (includeConversation) types.push('conversation');
  if (includeCode) types.push('code');
  if (includeDecisions) types.push('decision');
  if (includePatterns) types.push('pattern');

  const result = await retrieve(query, {
    types,
    maxTokens,
    limit: 20
  });

  // Calculate breakdown by type
  const breakdown: Record<MemoryType, number> = {
    conversation: 0,
    code: 0,
    decision: 0,
    pattern: 0,
    context: 0
  };

  for (const item of result.items) {
    breakdown[item.type]++;
  }

  return {
    items: result.items,
    totalTokens: result.totalTokens,
    breakdown
  };
}
