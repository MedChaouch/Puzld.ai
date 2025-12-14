/**
 * Prompt Wrapper (Phase 9.2)
 *
 * Wraps user tasks with JSON format instructions and injects context.
 * This makes PuzldAI the execution layer - LLMs propose, we apply.
 */

import { estimateTokens } from '../context/tokens';
import { buildInjectionForAgent } from '../memory/injector';
import { detectProjectConfig, formatInstructions } from '../indexing/config-detector';
import { getTaskContext } from '../indexing/searcher';

export interface PromptWrapperOptions {
  /** Files to inject as context */
  fileContext?: string;
  /** Memory/conversation context */
  memoryContext?: string;
  /** Project root for relative paths */
  projectRoot?: string;
  /** Agent name for agent-specific hints */
  agent?: string;
  /** Max tokens for the prompt (will warn if exceeded) */
  maxTokens?: number;
  /** Auto-retrieve memory context (Phase 11) */
  autoRetrieveMemory?: boolean;
  /** Max tokens for auto-retrieved memory */
  memoryMaxTokens?: number;
  /** Auto-inject project instructions (AGENTS.md) */
  autoInjectInstructions?: boolean;
  /** Auto-search indexed code for relevant context */
  autoSearchCode?: boolean;
  /** Max tokens for code context */
  codeMaxTokens?: number;
}

export interface WrappedPrompt {
  prompt: string;
  tokens: number;
  exceedsLimit: boolean;
}

/**
 * The system prompt that instructs LLMs to return JSON
 */
const SYSTEM_PROMPT = `You are a coding assistant that proposes file changes in JSON format.

CRITICAL: Your ENTIRE response must be a single valid JSON object. Do NOT include any text before or after the JSON. Do NOT use markdown code fences. Do NOT explain what you "would" do - just do it.

You MUST respond with this exact JSON structure:
{"explanation":"your explanation here","files":[]}

For file operations, add objects to the "files" array:
- Create/overwrite: {"path":"file.txt","operation":"create","content":"full content"}
- Edit existing: {"path":"file.txt","operation":"edit","search":"text to find","replace":"replacement"}
- Delete: {"path":"file.txt","operation":"delete"}

Rules:
- ALWAYS return valid JSON, nothing else
- If no changes needed, return: {"explanation":"No changes needed because...","files":[]}
- For edits, "search" must exactly match existing file content
- Put your reasoning in "explanation", not outside the JSON
- Do NOT mention tool limitations, file access, or inability to read files
- Work with the context provided - do NOT ask for more information`;

/**
 * Agent-specific hints to optimize prompts
 */
const AGENT_HINTS: Record<string, string> = {
  claude: '\nNote: Be concise. You handle complex reasoning well.',
  gemini: '\nNote: You can reference multiple files efficiently.',
  ollama: '\nNote: Keep explanations brief due to context limits.',
  codex: '\nNote: Focus on code correctness and best practices.',
  mistral: '\nNote: Be precise with search strings for edits.',
};

/**
 * Wraps a user task with JSON format instructions and context
 */
export function wrapPrompt(task: string, options: PromptWrapperOptions = {}): WrappedPrompt {
  const { fileContext, memoryContext, projectRoot, agent, maxTokens } = options;

  let prompt = SYSTEM_PROMPT;

  // Add agent-specific hint if available
  if (agent && AGENT_HINTS[agent]) {
    prompt += AGENT_HINTS[agent];
  }

  prompt += '\n\n';

  // Add context section if provided
  if (fileContext || memoryContext) {
    prompt += '<context>\n';

    if (fileContext) {
      prompt += `<files>\n${fileContext}\n</files>\n`;
    }

    if (memoryContext) {
      prompt += `<memory>\n${memoryContext}\n</memory>\n`;
    }

    prompt += '</context>\n\n';
  }

  // Add project root hint if provided
  if (projectRoot) {
    prompt += `Project root: ${projectRoot}\n\n`;
  }

  // Add the actual task
  prompt += `<task>\n${task}\n</task>\n\n`;

  prompt += 'Respond with valid JSON only:';

  // Estimate tokens
  const tokens = estimateTokens(prompt);
  const exceedsLimit = maxTokens ? tokens > maxTokens : false;

  return {
    prompt,
    tokens,
    exceedsLimit
  };
}

/**
 * Creates a minimal prompt for simple tasks (no context injection)
 */
export function wrapSimplePrompt(task: string, agent?: string): WrappedPrompt {
  let prompt = SYSTEM_PROMPT;

  if (agent && AGENT_HINTS[agent]) {
    prompt += AGENT_HINTS[agent];
  }

  prompt += `\n\n<task>\n${task}\n</task>\n\nRespond with valid JSON only:`;

  return {
    prompt,
    tokens: estimateTokens(prompt),
    exceedsLimit: false
  };
}

/**
 * Formats file content for injection into the prompt
 * Escapes content that might interfere with parsing
 */
export function formatFileContext(files: Array<{ path: string; content: string }>): string {
  return files
    .map(f => {
      // Escape triple backticks to prevent breaking out of code blocks
      const escapedContent = f.content.replace(/```/g, '\\`\\`\\`');
      return `--- ${f.path} ---\n${escapedContent}`;
    })
    .join('\n\n');
}

/**
 * Formats memory/conversation context for injection
 */
export function formatMemoryContext(items: Array<{ type: string; content: string }>): string {
  return items
    .map(item => `[${item.type}] ${item.content}`)
    .join('\n');
}

/**
 * Wraps a user task with auto-retrieved memory context
 * This is async because it fetches from the memory store
 */
export async function wrapPromptWithMemory(
  task: string,
  options: PromptWrapperOptions = {}
): Promise<WrappedPrompt> {
  const {
    agent = 'claude',
    memoryMaxTokens = 1000,
    projectRoot = process.cwd(),
    autoInjectInstructions = true,
    autoSearchCode = false,
    codeMaxTokens = 4000,
  } = options;

  // Build memory context from retriever
  let memoryContext = options.memoryContext;
  let fileContext = options.fileContext;

  // Auto-inject project instructions (AGENTS.md, etc.)
  if (autoInjectInstructions) {
    try {
      const projectConfig = detectProjectConfig(projectRoot);
      const instructions = formatInstructions(projectConfig, agent, 'xml');
      if (instructions) {
        memoryContext = memoryContext
          ? `${instructions}\n\n${memoryContext}`
          : instructions;
      }
    } catch {
      // Continue without project instructions
    }
  }

  // Auto-search indexed code for relevant context
  if (autoSearchCode) {
    try {
      const codeContext = await getTaskContext(task, projectRoot, {
        maxFiles: 5,
        maxTotalSize: codeMaxTokens * 4, // ~4 chars per token
      });

      if (codeContext.files.length > 0) {
        const codeFiles = codeContext.files
          .map(f => `--- ${f.path} (${f.reason}) ---\n${f.content}`)
          .join('\n\n');

        fileContext = fileContext
          ? `${fileContext}\n\n${codeFiles}`
          : codeFiles;
      }
    } catch {
      // Continue without code context
    }
  }

  // Retrieve memory from vector store
  if (options.autoRetrieveMemory !== false) {
    try {
      const injection = await buildInjectionForAgent(task, agent, {
        maxTokens: memoryMaxTokens,
        includeConversation: true,
        includeCode: true,
        includeDecisions: true,
        includePatterns: true
      });

      if (injection.content && injection.itemCount > 0) {
        memoryContext = memoryContext
          ? `${memoryContext}\n\n${injection.content}`
          : injection.content;
      }
    } catch {
      // Silently continue without memory if retrieval fails
    }
  }

  return wrapPrompt(task, {
    ...options,
    fileContext,
    memoryContext
  });
}

export { SYSTEM_PROMPT, AGENT_HINTS };
