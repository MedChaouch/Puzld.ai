/**
 * Embeddings (Phase 11)
 *
 * Generate embeddings for semantic search.
 * Primary: SQLite FTS5 (keyword search, zero deps)
 * Optional: Ollama (semantic search if available)
 */

import { getConfig } from '../lib/config';

export type EmbeddingProvider = 'ollama' | 'fts5';

// Embedding dimension for nomic-embed-text (only used with Ollama)
export const EMBEDDING_DIMENSION = 768;

// Supported embedding models (in order of preference)
const EMBEDDING_MODELS = ['nomic-embed-text', 'mxbai-embed', 'all-minilm'];

let currentProvider: EmbeddingProvider = 'fts5';
let ollamaAvailable: boolean | null = null;
let detectedModel: string | null = null;

/**
 * Get current provider
 */
export function getProvider(): EmbeddingProvider {
  return currentProvider;
}

/**
 * Get detected embedding model name
 */
export function getEmbeddingModel(): string | null {
  return detectedModel;
}

/**
 * Check if Ollama is available for semantic search
 */
export async function isOllamaAvailable(): Promise<boolean> {
  if (ollamaAvailable !== null) return ollamaAvailable;

  try {
    const { Ollama } = await import('ollama');
    const config = getConfig();
    const ollama = new Ollama({ host: config.adapters.ollama.host });
    const models = await ollama.list();

    // Find first available embedding model
    const found = models.models.find(m =>
      EMBEDDING_MODELS.some(em => m.name.startsWith(em))
    );

    if (found) {
      detectedModel = found.name;
      ollamaAvailable = true;
    } else {
      ollamaAvailable = false;
    }

    return ollamaAvailable;
  } catch {
    ollamaAvailable = false;
    return false;
  }
}

/**
 * Initialize embeddings - detect best provider
 */
export async function initEmbeddings(): Promise<EmbeddingProvider> {
  if (await isOllamaAvailable()) {
    currentProvider = 'ollama';
  } else {
    currentProvider = 'fts5';
  }
  return currentProvider;
}

/**
 * Generate embedding using Ollama (only if available)
 */
export async function embed(text: string): Promise<number[] | null> {
  if (currentProvider !== 'ollama' || !detectedModel) {
    return null; // FTS5 doesn't use embeddings
  }

  try {
    const { Ollama } = await import('ollama');
    const config = getConfig();
    const ollama = new Ollama({ host: config.adapters.ollama.host });

    const response = await ollama.embed({
      model: detectedModel,
      input: text
    });

    return response.embeddings[0];
  } catch {
    return null;
  }
}

/**
 * Generate embeddings for multiple texts
 */
export async function embedBatch(texts: string[]): Promise<(number[] | null)[]> {
  if (currentProvider !== 'ollama' || !detectedModel) {
    return texts.map(() => null);
  }

  try {
    const { Ollama } = await import('ollama');
    const config = getConfig();
    const ollama = new Ollama({ host: config.adapters.ollama.host });

    const response = await ollama.embed({
      model: detectedModel,
      input: texts
    });

    return response.embeddings;
  } catch {
    return texts.map(() => null);
  }
}

/**
 * Cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have same length');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);

  if (magnitude === 0) return 0;

  return dotProduct / magnitude;
}
