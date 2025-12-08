/**
 * Pipeline Memory Layer
 *
 * Enhanced short-term memory for pipeline execution.
 * Auto-summarizes step outputs and respects token limits during injection.
 */

import { summarizeIfNeeded, extractKeyPoints, isSummarizerAvailable } from './summarizer';
import { estimateTokens, truncateForAgent } from './tokens';
import { getScaffolder, type Scaffold } from './scaffolding';
import type { StepResult } from '../executor/types';
import type { ExecutionContext } from '../executor/context';

/**
 * Enhanced step output with memory management
 */
export interface StepOutput {
  raw: string;           // Original output
  summary: string;       // Compressed version
  tokens: number;        // Token count of raw
  summaryTokens: number; // Token count of summary
  keyPoints: string[];   // Extracted key points
  timestamp: number;
  scaffold?: Scaffold;   // Scaffolded chunks for very large outputs
}

/**
 * Memory-enhanced execution context
 */
export interface MemoryContext extends ExecutionContext {
  // Step outputs with memory management
  memory: Record<string, StepOutput>;

  // Configuration
  config: MemoryConfig;
}

/**
 * Memory configuration
 */
export interface MemoryConfig {
  // Target agent for token limits
  targetAgent: string;

  // Auto-summarize outputs above this token count
  summarizeThreshold: number;

  // Scaffold outputs above this token count (very large outputs)
  scaffoldThreshold: number;

  // Max tokens per variable injection
  maxInjectionTokens: number;

  // Prefer summaries over truncation
  preferSummaries: boolean;
}

// Research-backed thresholds (RAG best practices 2024)
const DEFAULT_CONFIG: MemoryConfig = {
  targetAgent: 'claude',
  summarizeThreshold: 5000,   // 5k-15k: single summary
  scaffoldThreshold: 15000,   // >15k: scaffold into 512-token chunks
  maxInjectionTokens: 10000,
  preferSummaries: true
};

/**
 * Create a memory-enhanced context
 */
export function createMemoryContext(
  prompt: string,
  initial: Record<string, unknown> = {},
  config: Partial<MemoryConfig> = {}
): MemoryContext {
  return {
    initial,
    steps: {},
    outputs: {},
    prompt,
    memory: {},
    config: { ...DEFAULT_CONFIG, ...config }
  };
}

/**
 * Process step result and store with memory management
 *
 * Decision framework (RAG best practices 2024):
 * - < 5k tokens: pass as-is
 * - 5k-15k tokens: single abstractive summary
 * - > 15k tokens: scaffold (512-token chunks with summaries)
 */
export async function addStepResultWithMemory(
  ctx: MemoryContext,
  result: StepResult,
  outputAs?: string
): Promise<MemoryContext> {
  const content = result.content ?? '';
  const tokens = estimateTokens(content);

  // Create memory entry
  const output: StepOutput = {
    raw: content,
    summary: content,
    tokens,
    summaryTokens: tokens,
    keyPoints: [],
    timestamp: Date.now()
  };

  const summarizerAvailable = await isSummarizerAvailable();

  // Scaffold very large outputs (> 15k tokens)
  if (tokens > ctx.config.scaffoldThreshold && summarizerAvailable) {
    try {
      const scaffolder = getScaffolder();
      const scaffold = await scaffolder.scaffold(content);

      output.scaffold = scaffold;
      output.summary = scaffold.summary;
      output.summaryTokens = estimateTokens(scaffold.summary);
      output.keyPoints = scaffold.chunks.map(c => c.summary);
    } catch {
      // Fallback to truncation
      output.summary = truncateForAgent(content, ctx.config.targetAgent);
      output.summaryTokens = estimateTokens(output.summary);
    }
  }
  // Summarize medium outputs (5k-15k tokens)
  else if (tokens > ctx.config.summarizeThreshold && summarizerAvailable) {
    // Use allSettled to preserve partial results if one operation fails
    const [summaryResult, keyPointsResult] = await Promise.allSettled([
      summarizeIfNeeded(content, ctx.config.summarizeThreshold),
      extractKeyPoints(content)
    ]);

    output.summary = summaryResult.status === 'fulfilled'
      ? summaryResult.value
      : truncateForAgent(content, ctx.config.targetAgent);
    output.summaryTokens = estimateTokens(output.summary);
    output.keyPoints = keyPointsResult.status === 'fulfilled'
      ? keyPointsResult.value
      : [];
  }

  // Update context
  const steps = { ...ctx.steps, [result.stepId]: result };
  const outputs = outputAs && content
    ? { ...ctx.outputs, [outputAs]: content }
    : ctx.outputs;
  const memory = { ...ctx.memory, [result.stepId]: output };

  return { ...ctx, steps, outputs, memory };
}

/**
 * Inject variables with token-safe limits
 *
 * Respects agent token limits and prefers summaries for large content.
 */
export function injectVariablesTokenSafe(
  template: string,
  ctx: MemoryContext,
  targetAgent?: string
): string {
  const agent = targetAgent ?? ctx.config.targetAgent;
  const maxTokens = ctx.config.maxInjectionTokens;

  return template.replace(/\{\{([^}]+)\}\}/g, (match, path: string) => {
    const trimmed = path.trim();

    // {{prompt}} - original prompt (truncate if needed)
    if (trimmed === 'prompt') {
      return truncateForAgent(ctx.prompt, agent);
    }

    // Check for dot notation (step.property)
    if (trimmed.includes('.')) {
      const [stepId, property] = trimmed.split('.', 2);
      const step = ctx.steps[stepId];
      const mem = ctx.memory[stepId];

      if (!step) {
        return match;
      }

      switch (property) {
        case 'content':
        case 'raw':
          // Use summary if available and content is large
          if (mem && mem.tokens > maxTokens && ctx.config.preferSummaries) {
            return mem.summary;
          }
          return truncateForAgent(step.content ?? '', agent);

        case 'summary':
          return mem?.summary ?? truncateForAgent(step.content ?? '', agent);

        case 'keyPoints':
          return mem?.keyPoints.join('\n- ') ?? '';

        case 'tokens':
          return String(mem?.tokens ?? 0);

        case 'success':
          return String(step.status === 'completed' && !step.error);

        case 'error':
          return step.error ?? '';

        case 'model':
          return step.model ?? '';

        case 'duration':
          return String(step.duration ?? 0);

        default:
          return match;
      }
    }

    // Check named outputs - use memory summary if available
    if (trimmed in ctx.outputs) {
      const value = ctx.outputs[trimmed];
      const tokens = estimateTokens(value);

      // Find matching memory entry
      const memEntry = Object.entries(ctx.memory).find(
        ([_, mem]) => mem.raw === value
      );

      if (memEntry && tokens > maxTokens && ctx.config.preferSummaries) {
        return memEntry[1].summary;
      }

      return truncateForAgent(value, agent);
    }

    // Check initial context
    if (trimmed in ctx.initial) {
      const val = ctx.initial[trimmed];
      const str = typeof val === 'string' ? val : JSON.stringify(val);
      return truncateForAgent(str, agent);
    }

    return match;
  });
}

/**
 * Get memory stats for debugging/display
 */
export function getMemoryStats(ctx: MemoryContext): {
  totalSteps: number;
  totalRawTokens: number;
  totalSummaryTokens: number;
  compressionRatio: number;
  steps: Array<{
    stepId: string;
    rawTokens: number;
    summaryTokens: number;
    keyPointCount: number;
  }>;
} {
  const entries = Object.entries(ctx.memory);

  const totalRawTokens = entries.reduce((sum, [_, m]) => sum + m.tokens, 0);
  const totalSummaryTokens = entries.reduce((sum, [_, m]) => sum + m.summaryTokens, 0);

  return {
    totalSteps: entries.length,
    totalRawTokens,
    totalSummaryTokens,
    compressionRatio: totalRawTokens > 0
      ? Math.round((1 - totalSummaryTokens / totalRawTokens) * 100)
      : 0,
    steps: entries.map(([stepId, m]) => ({
      stepId,
      rawTokens: m.tokens,
      summaryTokens: m.summaryTokens,
      keyPointCount: m.keyPoints.length
    }))
  };
}

/**
 * Get best representation of step output for given token budget
 */
export function getStepOutputForBudget(
  ctx: MemoryContext,
  stepId: string,
  tokenBudget: number
): string {
  const mem = ctx.memory[stepId];
  if (!mem) {
    return ctx.steps[stepId]?.content ?? '';
  }

  // Key points fit - use for very tight budgets
  const keyPointsStr = mem.keyPoints.length > 0
    ? '- ' + mem.keyPoints.join('\n- ')
    : '';
  const keyPointsTokens = estimateTokens(keyPointsStr);

  if (keyPointsTokens > 0 && tokenBudget < mem.summaryTokens * 0.5 && keyPointsTokens <= tokenBudget) {
    return keyPointsStr;
  }

  // Summary fits
  if (mem.summaryTokens <= tokenBudget) {
    return mem.summary;
  }

  // Truncate summary to fit
  const ratio = tokenBudget / mem.summaryTokens;
  const targetChars = Math.floor(mem.summary.length * ratio * 0.9); // 10% buffer

  return mem.summary.slice(0, targetChars) + '\n\n[...truncated]';
}

/**
 * Clear memory for specific steps
 */
export function clearMemory(ctx: MemoryContext, stepIds?: string[]): MemoryContext {
  if (!stepIds) {
    return { ...ctx, memory: {} };
  }

  const memory = { ...ctx.memory };
  for (const id of stepIds) {
    delete memory[id];
  }
  return { ...ctx, memory };
}
