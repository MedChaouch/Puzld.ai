/**
 * Scaffolded Context Windows
 *
 * Handles large outputs by:
 * - Splitting into manageable chunks
 * - Summarizing each chunk
 * - Reconstructing usable context within token limits
 * - Semantic retrieval of relevant chunks
 */

import { Ollama } from 'ollama';
import { getConfig } from '../lib/config';
import { estimateTokens, getTokenConfig } from './tokens';
import { summarize } from './summarizer';

export type ChunkType = 'code' | 'text' | 'data' | 'mixed';

export interface ScaffoldChunk {
  index: number;
  content: string;
  summary: string;
  tokens: number;
  type: ChunkType;
  language?: string;
  metadata?: Record<string, unknown>;
}

export interface Scaffold {
  id: string;
  chunks: ScaffoldChunk[];
  summary: string;
  totalTokens: number;
  originalTokens: number;
  createdAt: number;
}

export interface ScaffoldOptions {
  chunkSize?: number;
  overlap?: number;
  summarizeThreshold?: number;
  preserveContent?: boolean;
  id?: string;
}

export interface ReconstructOptions {
  includeSummaries?: boolean;
  prioritizeCode?: boolean;
  query?: string;
}

// Research-backed defaults (RAG best practices 2024)
const DEFAULT_CHUNK_SIZE = 512;          // Optimal for retrieval accuracy
const DEFAULT_OVERLAP = 50;              // ~10% overlap
const DEFAULT_SUMMARIZE_THRESHOLD = 128; // Summarize chunks > 128 tokens

function generateId(): string {
  return `scaffold_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function detectChunkType(content: string): { type: ChunkType; language?: string } {
  const codeBlockMatch = content.match(/```(\w+)?/);
  const hasCodeBlock = codeBlockMatch !== null;

  const looksLikeJson = /^\s*[\[{]/.test(content) && /[\]}]\s*$/.test(content);
  const looksLikeData = looksLikeJson ||
    (content.includes('|') && content.includes('---')) ||
    /^\s*\d+[,\t]/.test(content);

  if (looksLikeData && !hasCodeBlock) {
    return { type: 'data' };
  }

  if (hasCodeBlock) {
    const textLength = content.replace(/```[\s\S]*?```/g, '').trim().length;
    const codeRatio = 1 - (textLength / content.length);

    if (codeRatio > 0.7) {
      return { type: 'code', language: codeBlockMatch?.[1] || undefined };
    }
    return { type: 'mixed', language: codeBlockMatch?.[1] || undefined };
  }

  const inlineCodeCount = (content.match(/`[^`]+`/g) || []).length;
  if (inlineCodeCount > 5 && inlineCodeCount * 10 > content.length / 100) {
    return { type: 'mixed' };
  }

  return { type: 'text' };
}

function splitIntoChunks(content: string, targetTokens: number, overlapTokens: number = 0): string[] {
  const targetChars = targetTokens * 4;
  const overlapChars = overlapTokens * 4;

  if (content.length <= targetChars) {
    return [content];
  }

  const chunks: string[] = [];
  let position = 0;

  while (position < content.length) {
    const remaining = content.slice(position);

    if (remaining.length <= targetChars) {
      chunks.push(remaining.trim());
      break;
    }

    let breakPoint = targetChars;

    // Try code block boundary (keep code blocks intact)
    const codeBlockEnd = remaining.lastIndexOf('```\n', targetChars);
    if (codeBlockEnd > targetChars * 0.3) {
      const nextNewline = remaining.indexOf('\n', codeBlockEnd + 3);
      if (nextNewline > 0 && nextNewline < targetChars * 1.2) {
        breakPoint = nextNewline + 1;
      }
    }

    // Try function/class boundary for code
    if (breakPoint === targetChars) {
      const funcMatch = remaining.slice(0, targetChars).match(/\n(function |class |def |const |export )/g);
      if (funcMatch) {
        const lastFunc = remaining.lastIndexOf(funcMatch[funcMatch.length - 1], targetChars);
        if (lastFunc > targetChars * 0.5) {
          breakPoint = lastFunc;
        }
      }
    }

    // Try heading boundary
    if (breakPoint === targetChars) {
      const headingMatch = remaining.slice(0, targetChars).match(/\n(#{2,3} )/g);
      if (headingMatch) {
        const lastHeading = remaining.lastIndexOf(headingMatch[headingMatch.length - 1], targetChars);
        if (lastHeading > targetChars * 0.5) {
          breakPoint = lastHeading;
        }
      }
    }

    // Try paragraph boundary
    if (breakPoint === targetChars) {
      const paragraphBreak = remaining.lastIndexOf('\n\n', targetChars);
      if (paragraphBreak > targetChars * 0.5) {
        breakPoint = paragraphBreak + 2;
      }
    }

    // Try sentence boundary
    if (breakPoint === targetChars) {
      const sentenceBreak = remaining.lastIndexOf('. ', targetChars);
      if (sentenceBreak > targetChars * 0.7) {
        breakPoint = sentenceBreak + 2;
      }
    }

    chunks.push(remaining.slice(0, breakPoint).trim());

    // Move position forward, accounting for overlap (always advance at least 1)
    position += Math.max(breakPoint - overlapChars, 1);
  }

  return chunks;
}

function getOllama(): Ollama {
  const config = getConfig();
  return new Ollama({ host: config.adapters.ollama.host });
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

export class ContextScaffolder {
  private scaffolds: Map<string, Scaffold> = new Map();

  async scaffold(content: string, options: ScaffoldOptions = {}): Promise<Scaffold> {
    const {
      chunkSize = DEFAULT_CHUNK_SIZE,
      overlap = DEFAULT_OVERLAP,
      summarizeThreshold = DEFAULT_SUMMARIZE_THRESHOLD,
      preserveContent = true,
      id = generateId()
    } = options;

    const originalTokens = estimateTokens(content);
    const rawChunks = splitIntoChunks(content, chunkSize, overlap);

    // Pre-compute non-failing metadata for each chunk
    const chunkMeta = rawChunks.map((chunkContent, index) => {
      const tokens = estimateTokens(chunkContent);
      const { type, language } = detectChunkType(chunkContent);
      const firstLine = chunkContent.split('\n')[0];
      const fallbackSummary = firstLine.length > 100 ? firstLine.slice(0, 100) + '...' : firstLine;
      return { index, chunkContent, tokens, type, language, fallbackSummary };
    });

    // Use allSettled to handle individual chunk summarization failures gracefully
    const summaryResults = await Promise.allSettled(
      chunkMeta.map(async (meta) => {
        if (meta.tokens > summarizeThreshold) {
          const result = await summarize(meta.chunkContent, {
            maxLength: Math.min(200, Math.floor(meta.tokens * 0.2)),
            preserveCode: meta.type === 'code' || meta.type === 'mixed'
          });
          return result.summary;
        }
        return meta.fallbackSummary;
      })
    );

    // Combine metadata with summaries, using fallback for failed summarizations
    const chunks: ScaffoldChunk[] = chunkMeta.map((meta, i) => {
      const summaryResult = summaryResults[i];
      const summary = summaryResult.status === 'fulfilled'
        ? summaryResult.value
        : meta.fallbackSummary;

      return {
        index: meta.index,
        content: preserveContent ? meta.chunkContent : '',
        summary,
        tokens: meta.tokens,
        type: meta.type,
        language: meta.language
      };
    });

    const overallSummary = await this.generateOverallSummary(chunks);

    const scaffold: Scaffold = {
      id,
      chunks,
      summary: overallSummary,
      totalTokens: chunks.reduce((sum, c) => sum + c.tokens, 0),
      originalTokens,
      createdAt: Date.now()
    };

    this.scaffolds.set(id, scaffold);
    return scaffold;
  }

  private async generateOverallSummary(chunks: ScaffoldChunk[]): Promise<string> {
    if (chunks.length === 0) return '';
    if (chunks.length === 1) return chunks[0].summary;

    const combinedSummaries = chunks.map((c, i) => `[${i + 1}] ${c.summary}`).join('\n');

    const result = await summarize(combinedSummaries, {
      maxLength: 300,
      preserveCode: false,
      format: 'paragraph'
    });

    return result.summary;
  }

  async reconstruct(
    scaffold: Scaffold,
    tokenLimit: number,
    options: ReconstructOptions = {}
  ): Promise<string> {
    const { includeSummaries = true, prioritizeCode = true, query } = options;

    if (scaffold.totalTokens <= tokenLimit) {
      return scaffold.chunks.map(c => c.content).join('\n\n');
    }

    const scoredChunks = await this.scoreChunks(scaffold.chunks, query, prioritizeCode);

    const parts: string[] = [];
    let usedTokens = 0;

    const summaryTokens = estimateTokens(scaffold.summary);
    if (summaryTokens < tokenLimit * 0.2) {
      parts.push(`<context_summary>\n${scaffold.summary}\n</context_summary>`);
      usedTokens += summaryTokens + 50;
    }

    for (const { chunk } of scoredChunks) {
      const chunkTokens = chunk.tokens + 20;

      if (usedTokens + chunkTokens <= tokenLimit) {
        parts.push(this.formatChunk(chunk, 'full'));
        usedTokens += chunkTokens;
      } else if (includeSummaries && usedTokens + estimateTokens(chunk.summary) + 30 <= tokenLimit) {
        parts.push(this.formatChunk(chunk, 'summary'));
        usedTokens += estimateTokens(chunk.summary) + 30;
      }

      if (usedTokens >= tokenLimit * 0.95) break;
    }

    return parts.join('\n\n');
  }

  private async scoreChunks(
    chunks: ScaffoldChunk[],
    query?: string,
    prioritizeCode: boolean = true
  ): Promise<Array<{ chunk: ScaffoldChunk; score: number }>> {
    let scores: number[];

    if (query) {
      scores = await this.getSemanticScores(chunks, query);
    } else {
      scores = chunks.map((chunk, i) => {
        let score = 1 - (i / chunks.length) * 0.3;
        if (prioritizeCode) {
          if (chunk.type === 'code') score += 0.3;
          else if (chunk.type === 'mixed') score += 0.15;
        }
        return score;
      });
    }

    return chunks
      .map((chunk, i) => ({ chunk, score: scores[i] }))
      .sort((a, b) => b.score - a.score);
  }

  private async getSemanticScores(chunks: ScaffoldChunk[], query: string): Promise<number[]> {
    try {
      const ollama = getOllama();
      const texts = [query, ...chunks.map(c => c.content || c.summary)];

      const response = await ollama.embed({
        model: 'nomic-embed-text',
        input: texts
      });

      const queryEmbedding = response.embeddings[0];
      return response.embeddings.slice(1).map(emb => cosineSimilarity(queryEmbedding, emb));
    } catch {
      const queryWords = new Set(query.toLowerCase().split(/\W+/));
      return chunks.map(chunk => {
        const chunkWords = new Set((chunk.content || chunk.summary).toLowerCase().split(/\W+/));
        let overlap = 0;
        for (const word of queryWords) {
          if (chunkWords.has(word)) overlap++;
        }
        return overlap / queryWords.size;
      });
    }
  }

  private formatChunk(chunk: ScaffoldChunk, mode: 'full' | 'summary'): string {
    const typeLabel = chunk.type === 'code' && chunk.language
      ? `${chunk.type}:${chunk.language}`
      : chunk.type;

    if (mode === 'summary') {
      return `<chunk index="${chunk.index}" type="${typeLabel}" mode="summary">\n${chunk.summary}\n</chunk>`;
    }

    return `<chunk index="${chunk.index}" type="${typeLabel}">\n${chunk.content}\n</chunk>`;
  }

  async getRelevantChunks(scaffold: Scaffold, query: string, limit: number = 3): Promise<ScaffoldChunk[]> {
    const scored = await this.scoreChunks(scaffold.chunks, query, false);
    return scored.slice(0, limit).map(s => s.chunk);
  }

  getScaffold(id: string): Scaffold | undefined {
    return this.scaffolds.get(id);
  }

  clearScaffolds(): void {
    this.scaffolds.clear();
  }

  getStats(): { count: number; totalChunks: number; totalTokens: number } {
    let totalChunks = 0;
    let totalTokens = 0;

    for (const scaffold of this.scaffolds.values()) {
      totalChunks += scaffold.chunks.length;
      totalTokens += scaffold.totalTokens;
    }

    return { count: this.scaffolds.size, totalChunks, totalTokens };
  }
}

let scaffolderInstance: ContextScaffolder | null = null;

export function getScaffolder(): ContextScaffolder {
  if (!scaffolderInstance) {
    scaffolderInstance = new ContextScaffolder();
  }
  return scaffolderInstance;
}

export async function scaffoldIfNeeded(
  content: string,
  tokenLimit: number,
  options: ScaffoldOptions = {}
): Promise<Scaffold | null> {
  const tokens = estimateTokens(content);
  if (tokens <= tokenLimit) return null;

  const scaffolder = getScaffolder();
  return scaffolder.scaffold(content, options);
}

export async function getContentWithinLimit(
  content: string,
  agent: string,
  query?: string
): Promise<string> {
  const config = getTokenConfig(agent);
  const available = config.maxTokens - config.reserveTokens;
  const tokens = estimateTokens(content);

  if (tokens <= available) return content;

  const scaffolder = getScaffolder();
  const scaffold = await scaffolder.scaffold(content);

  return scaffolder.reconstruct(scaffold, available, { query });
}
