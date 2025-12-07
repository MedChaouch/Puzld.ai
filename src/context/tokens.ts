/**
 * Token Management Layer
 *
 * Handles token estimation, limits, and truncation per adapter.
 */

export interface TokenConfig {
  maxTokens: number;
  reserveTokens: number;
  chunkSize: number;
}

export const ADAPTER_LIMITS: Record<string, TokenConfig> = {
  claude: { maxTokens: 100000, reserveTokens: 4000, chunkSize: 8000 },
  gemini: { maxTokens: 128000, reserveTokens: 4000, chunkSize: 8000 },
  codex:  { maxTokens: 32000,  reserveTokens: 2000, chunkSize: 4000 },
  ollama: { maxTokens: 8000,   reserveTokens: 1000, chunkSize: 2000 },
};

const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function getTokenConfig(agent: string): TokenConfig {
  return ADAPTER_LIMITS[agent] || ADAPTER_LIMITS.ollama;
}

export function getAvailableTokens(agent: string, usedTokens: number = 0): number {
  const config = getTokenConfig(agent);
  return config.maxTokens - config.reserveTokens - usedTokens;
}

export function fitsInContext(text: string, agent: string, usedTokens: number = 0): boolean {
  const tokens = estimateTokens(text);
  return tokens <= getAvailableTokens(agent, usedTokens);
}

export function truncateForAgent(text: string, agent: string, usedTokens: number = 0): string {
  const available = getAvailableTokens(agent, usedTokens);
  const maxChars = available * CHARS_PER_TOKEN;

  if (text.length <= maxChars) return text;

  let truncated = text.slice(0, maxChars);

  // Try paragraph boundary
  const lastParagraph = truncated.lastIndexOf('\n\n');
  if (lastParagraph > maxChars * 0.7) {
    truncated = truncated.slice(0, lastParagraph);
  } else {
    // Try sentence boundary
    const lastSentence = truncated.lastIndexOf('. ');
    if (lastSentence > maxChars * 0.8) {
      truncated = truncated.slice(0, lastSentence + 1);
    }
  }

  return truncated + '\n\n[...truncated]';
}

export function splitIntoChunks(text: string, agent: string): string[] {
  const config = getTokenConfig(agent);
  const chunkChars = config.chunkSize * CHARS_PER_TOKEN;

  if (text.length <= chunkChars) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= chunkChars) {
      chunks.push(remaining);
      break;
    }

    let breakPoint = chunkChars;
    const paragraphBreak = remaining.lastIndexOf('\n\n', chunkChars);
    if (paragraphBreak > chunkChars * 0.5) {
      breakPoint = paragraphBreak + 2;
    } else {
      const sentenceBreak = remaining.lastIndexOf('. ', chunkChars);
      if (sentenceBreak > chunkChars * 0.5) {
        breakPoint = sentenceBreak + 2;
      }
    }

    chunks.push(remaining.slice(0, breakPoint).trim());
    remaining = remaining.slice(breakPoint).trim();
  }

  return chunks;
}

export function getContextUsage(text: string, agent: string): {
  used: number;
  available: number;
  percentage: number
} {
  const tokens = estimateTokens(text);
  const config = getTokenConfig(agent);
  const available = config.maxTokens - config.reserveTokens;

  return {
    used: tokens,
    available,
    percentage: Math.round((tokens / available) * 100)
  };
}

export function isNearLimit(text: string, agent: string): boolean {
  return getContextUsage(text, agent).percentage >= 80;
}
