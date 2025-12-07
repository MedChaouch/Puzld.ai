/**
 * Summarization Layer
 *
 * Zero-cost compression using local Ollama.
 * Preserves code blocks, key decisions, and action items.
 */

import { Ollama } from 'ollama';
import { getConfig } from '../lib/config';
import { estimateTokens } from './tokens';

export interface SummaryOptions {
  maxLength?: number;
  preserveCode?: boolean;
  format?: 'bullet' | 'paragraph' | 'structured';
}

interface SummaryResult {
  summary: string;
  originalTokens: number;
  summaryTokens: number;
  compressionRatio: number;
}

const DEFAULT_MAX_LENGTH = 500;

const SUMMARIZE_PROMPT = `Summarize this content concisely. Preserve:
- Key decisions and conclusions
- Code snippets (if relevant)
- Action items
- Error messages

Keep it under {{maxLength}} words.

Content:
{{content}}`;

const EXTRACT_PROMPT = `Extract the key points from this content as a bullet list.
Focus on:
- Main ideas
- Decisions made
- Action items
- Important details

Content:
{{content}}`;

/**
 * Get Ollama client
 */
function getOllama(): Ollama {
  const config = getConfig();
  return new Ollama({ host: config.adapters.ollama.host });
}

/**
 * Get summarization model from config
 */
function getSummaryModel(): string {
  const config = getConfig();
  return config.routerModel || 'llama3.2';
}

/**
 * Extract code blocks from text
 */
function extractCodeBlocks(text: string): { code: string[]; textWithoutCode: string } {
  const codeBlockRegex = /```[\s\S]*?```/g;
  const code: string[] = [];

  const textWithoutCode = text.replace(codeBlockRegex, (match) => {
    code.push(match);
    return '[CODE_BLOCK_' + (code.length - 1) + ']';
  });

  return { code, textWithoutCode };
}

/**
 * Restore code blocks to summarized text
 */
function restoreCodeBlocks(summary: string, code: string[]): string {
  let result = summary;
  code.forEach((block, i) => {
    result = result.replace('[CODE_BLOCK_' + i + ']', block);
  });
  return result;
}

/**
 * Summarize text using local Ollama
 */
export async function summarize(
  text: string,
  options: SummaryOptions = {}
): Promise<SummaryResult> {
  const maxLength = options.maxLength || DEFAULT_MAX_LENGTH;
  const preserveCode = options.preserveCode ?? true;
  const originalTokens = estimateTokens(text);

  // Skip if already short enough
  if (originalTokens <= maxLength) {
    return {
      summary: text,
      originalTokens,
      summaryTokens: originalTokens,
      compressionRatio: 1
    };
  }

  let textToSummarize = text;
  let codeBlocks: string[] = [];

  // Extract code blocks if preserving
  if (preserveCode) {
    const extracted = extractCodeBlocks(text);
    textToSummarize = extracted.textWithoutCode;
    codeBlocks = extracted.code;
  }

  const prompt = SUMMARIZE_PROMPT
    .replace('{{maxLength}}', String(maxLength))
    .replace('{{content}}', textToSummarize);

  try {
    const ollama = getOllama();
    const response = await ollama.generate({
      model: getSummaryModel(),
      prompt,
      stream: false
    });

    let summary = response.response.trim();

    // Restore code blocks
    if (preserveCode && codeBlocks.length > 0) {
      summary = restoreCodeBlocks(summary, codeBlocks);
    }

    const summaryTokens = estimateTokens(summary);

    return {
      summary,
      originalTokens,
      summaryTokens,
      compressionRatio: originalTokens / summaryTokens
    };
  } catch (error) {
    // Fallback: simple truncation if Ollama fails
    const truncated = text.slice(0, maxLength * 4) + '\n\n[...summarization failed, truncated]';
    return {
      summary: truncated,
      originalTokens,
      summaryTokens: estimateTokens(truncated),
      compressionRatio: 1
    };
  }
}

/**
 * Summarize only if text exceeds token limit
 */
export async function summarizeIfNeeded(
  text: string,
  tokenLimit: number,
  options: SummaryOptions = {}
): Promise<string> {
  const tokens = estimateTokens(text);

  if (tokens <= tokenLimit) {
    return text;
  }

  const result = await summarize(text, {
    ...options,
    maxLength: Math.floor(tokenLimit * 0.8) // Leave some buffer
  });

  return result.summary;
}

/**
 * Extract key points as bullet list
 */
export async function extractKeyPoints(text: string): Promise<string[]> {
  const tokens = estimateTokens(text);

  // Skip if too short
  if (tokens < 100) {
    return [text.trim()];
  }

  const prompt = EXTRACT_PROMPT.replace('{{content}}', text);

  try {
    const ollama = getOllama();
    const response = await ollama.generate({
      model: getSummaryModel(),
      prompt,
      stream: false
    });

    // Parse bullet points
    const lines = response.response.trim().split('\n');
    return lines
      .map(line => line.replace(/^[-*•]\s*/, '').trim())
      .filter(line => line.length > 0);
  } catch {
    // Fallback
    return [text.slice(0, 200) + '...'];
  }
}

/**
 * Check if summarizer (Ollama) is available
 */
export async function isSummarizerAvailable(): Promise<boolean> {
  const config = getConfig();
  if (!config.adapters.ollama.enabled) return false;

  try {
    const response = await fetch(
      `${config.adapters.ollama.host}/api/tags`,
      { signal: AbortSignal.timeout(2000) }
    );
    return response.ok;
  } catch {
    return false;
  }
}
