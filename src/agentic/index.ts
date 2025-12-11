/**
 * Agentic Execution Layer (Phase 9.2)
 *
 * Main orchestrator that ties together:
 * - prompt-wrapper: Format prompts with JSON instructions
 * - response-parser: Extract JSON from LLM responses
 * - edit-extractor: Convert to ProposedEdit[]
 * - file-executor: Apply changes to filesystem
 *
 * This makes PuzldAI the execution layer - LLMs propose, we apply.
 */

import type { Adapter, ModelResponse, RunOptions } from '../lib/types';
import type { ProposedEdit } from '../lib/edit-review';
import {
  wrapPrompt,
  wrapSimplePrompt,
  wrapPromptWithMemory,
  formatFileContext,
  formatMemoryContext,
  type WrappedPrompt,
  type PromptWrapperOptions
} from './prompt-wrapper';
import {
  parseResponse,
  emptyResponse,
  hasFileOperations,
  getOperationSummary,
  type AgenticResponse,
  type ParseResult
} from './response-parser';
import {
  extractEdits,
  validateOperations,
  getAffectedPaths,
  hasOverwrites,
  type ExtractResult
} from './edit-extractor';
import {
  executeEdit,
  executeEdits,
  executeAccepted,
  validateEdits,
  getOperationCounts,
  type BatchExecuteResult
} from './file-executor';

/**
 * Options for agentic execution
 */
export interface AgenticOptions {
  /** The adapter to use */
  adapter: Adapter;
  /** Files to inject as context */
  files?: Array<{ path: string; content: string }>;
  /** Memory items to inject */
  memory?: Array<{ type: string; content: string }>;
  /** Project root for file paths */
  projectRoot?: string;
  /** Model to use (passed to adapter) */
  model?: string;
  /** Abort signal */
  signal?: AbortSignal;
  /** Max tokens for prompt (warning only) */
  maxTokens?: number;
}

/**
 * Result of agentic execution
 */
export interface AgenticResult {
  /** Whether the execution succeeded */
  success: boolean;
  /** The wrapped prompt that was sent */
  prompt: WrappedPrompt;
  /** Raw response from the LLM */
  rawResponse: ModelResponse;
  /** Parsed agentic response (if successful) */
  agenticResponse?: AgenticResponse;
  /** Proposed edits (if any) */
  proposedEdits?: ProposedEdit[];
  /** Extraction errors (if any) */
  extractionErrors?: Array<{ path: string; error: string }>;
  /** Error message (if failed) */
  error?: string;
}

/**
 * Runs the agentic flow: prompt → LLM → parse → extract
 * Does NOT apply changes - returns ProposedEdit[] for review
 */
export async function runAgentic(
  task: string,
  options: AgenticOptions
): Promise<AgenticResult> {
  const { adapter, files, memory, projectRoot, model, signal, maxTokens } = options;

  // Build context
  const fileContext = files ? formatFileContext(files) : undefined;
  const memoryContext = memory ? formatMemoryContext(memory) : undefined;

  // Wrap prompt with JSON instructions
  const prompt = wrapPrompt(task, {
    fileContext,
    memoryContext,
    projectRoot,
    agent: adapter.name,
    maxTokens
  });

  // Warn if exceeds limit
  if (prompt.exceedsLimit) {
    console.warn(`Warning: Prompt exceeds token limit (${prompt.tokens} tokens)`);
  }

  // Run adapter with tools disabled (critical for agentic mode)
  let rawResponse: ModelResponse;
  try {
    rawResponse = await adapter.run(prompt.prompt, {
      model,
      signal,
      disableTools: true  // Force JSON-only response, no native file tools
    });
  } catch (err) {
    return {
      success: false,
      prompt,
      rawResponse: { content: '', model: model || adapter.name, duration: 0 },
      error: `Adapter error: ${(err as Error).message}`
    };
  }

  // Check for adapter error
  if (rawResponse.error) {
    return {
      success: false,
      prompt,
      rawResponse,
      error: `LLM error: ${rawResponse.error}`
    };
  }

  // Parse response
  const parseResult = parseResponse(rawResponse.content);
  if (!parseResult.success || !parseResult.response) {
    return {
      success: false,
      prompt,
      rawResponse,
      error: parseResult.error || 'Failed to parse response'
    };
  }

  // Extract edits
  const { edits, errors } = extractEdits(parseResult.response, { projectRoot });

  return {
    success: true,
    prompt,
    rawResponse,
    agenticResponse: parseResult.response,
    proposedEdits: edits,
    extractionErrors: errors.length > 0 ? errors : undefined
  };
}

/**
 * Simplified agentic run for simple tasks (no context injection)
 */
export async function runSimpleAgentic(
  task: string,
  adapter: Adapter,
  options?: { model?: string; signal?: AbortSignal; projectRoot?: string }
): Promise<AgenticResult> {
  return runAgentic(task, {
    adapter,
    projectRoot: options?.projectRoot,
    model: options?.model,
    signal: options?.signal
  });
}

/**
 * Checks if a task looks like it needs file operations
 * Used to auto-detect when to use agentic mode
 */
export function looksLikeFileTask(task: string): boolean {
  const fileKeywords = [
    'create',
    'write',
    'edit',
    'modify',
    'update',
    'delete',
    'remove',
    'add file',
    'new file',
    'change file',
    'fix the',
    'implement',
    'refactor'
  ];

  const lower = task.toLowerCase();
  return fileKeywords.some(kw => lower.includes(kw));
}

// Re-export types and utilities
export type {
  WrappedPrompt,
  PromptWrapperOptions,
  AgenticResponse,
  ParseResult,
  ExtractResult,
  BatchExecuteResult
};

export {
  // Prompt wrapper
  wrapPrompt,
  wrapSimplePrompt,
  wrapPromptWithMemory,
  formatFileContext,
  formatMemoryContext,
  // Response parser
  parseResponse,
  emptyResponse,
  hasFileOperations,
  getOperationSummary,
  // Edit extractor
  extractEdits,
  validateOperations,
  getAffectedPaths,
  hasOverwrites,
  // File executor
  executeEdit,
  executeEdits,
  executeAccepted,
  validateEdits,
  getOperationCounts
};
