// Agent loop - runs LLM with tools until completion

import type { Adapter, ModelResponse, RunOptions } from '../lib/types';
import { allTools, executeTools, executeTool, getTool } from './tools';
import type { Tool, ToolCall, ToolResult, AgentMessage } from './tools/types';
import { globSync } from 'glob';
import {
  type PermissionRequest,
  type PermissionResult,
  type PermissionHandler,
  permissionTracker
} from './tools/permissions';

const MAX_ITERATIONS = 20;

// Tools that require read permission
const READ_TOOLS = ['view', 'grep', 'glob'];
// Tools that require write permission
const WRITE_TOOLS = ['write', 'edit'];
// Tools that require execute permission
const EXEC_TOOLS = ['bash'];

// Tool name aliases - maps common LLM naming patterns to our tools
const TOOL_ALIASES: Record<string, string> = {
  'read_file': 'view', 'read': 'view', 'cat': 'view', 'file_read': 'view',
  'find': 'glob', 'find_files': 'glob', 'list_files': 'glob', 'search_files': 'glob',
  'search': 'grep', 'search_content': 'grep', 'find_in_files': 'grep',
  'shell': 'bash', 'run': 'bash', 'execute': 'bash', 'run_command': 'bash',
  'write_file': 'write', 'create_file': 'write', 'file_write': 'write',
  'update': 'edit', 'modify': 'edit', 'replace': 'edit', 'file_edit': 'edit',
};

// Normalize tool name using aliases
function normalizeToolName(name: string): string {
  return TOOL_ALIASES[name] || name;
}

export interface AgentLoopOptions extends RunOptions {
  /** Tools available to the agent (default: all tools) */
  tools?: Tool[];
  /** Working directory for tool execution */
  cwd?: string;
  /** Callback when tool is called (before permission check) */
  onToolCall?: (call: ToolCall) => void;
  /** Callback when tool returns result */
  onToolResult?: (result: ToolResult) => void;
  /** Callback for each iteration */
  onIteration?: (iteration: number, response: string) => void;
  /** Permission handler - called when tool needs permission */
  onPermissionRequest?: PermissionHandler;
  /** Callback when tool starts executing (after permission granted) */
  onToolStart?: (call: ToolCall) => void;
  /** Callback when tool finishes */
  onToolEnd?: (call: ToolCall, result: ToolResult) => void;
}

export interface AgentLoopResult {
  content: string;
  model: string;
  iterations: number;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  tokens?: { input: number; output: number };
  duration?: number;
}

/**
 * Build system prompt based on adapter type
 */
function buildSystemPrompt(adapterName: string, projectFiles: string, toolDescriptions: string): string {
  // Base instructions shared by all adapters
  const baseInstructions = `# Project Structure

Here are the files in the current project (file names only - use tools to read contents):

${projectFiles}

# Available Tools

${toolDescriptions}`;

  // Adapter-specific prompts
  if (adapterName === 'mistral') {
    // Mistral needs very explicit instructions about text-based tool invocation
    return `You are a coding assistant. You invoke tools by OUTPUTTING special code blocks.

IMPORTANT: You do NOT have native/built-in tool access. Tools are invoked by writing \`\`\`tool code blocks in your response. The system parses your text output and executes tools for you.

${baseInstructions}

# How to Invoke Tools

Write a code block with the "tool" language tag:

\`\`\`tool
{"name": "view", "arguments": {"path": "README.md"}}
\`\`\`

The system reads your text, finds \`\`\`tool blocks, executes them, and returns results.

RULES:
1. OUTPUT the \`\`\`tool block as text - do not try to call functions
2. You cannot see file contents until you OUTPUT a view tool block
3. One tool per \`\`\`tool block, multiple blocks allowed
4. After outputting tool blocks, wait for results before continuing

Example - to read a file, OUTPUT this text:
\`\`\`tool
{"name": "view", "arguments": {"path": "package.json"}}
\`\`\``;
  }

  if (adapterName === 'gemini') {
    // Gemini may have native context - remind it to use our tools
    return `You are a coding assistant with access to tools via code blocks.

${baseInstructions}

# How to Use Tools

Output a \`\`\`tool code block:

\`\`\`tool
{
  "name": "tool_name",
  "arguments": {"param": "value"}
}
\`\`\`

IMPORTANT:
- Use \`\`\`tool blocks to invoke tools (not native functions)
- You must use 'view' tool to read file contents
- Do not assume or hallucinate file contents
- Multiple tools = multiple \`\`\`tool blocks`;
  }

  // Default prompt for Claude, Codex, Ollama
  return `You are a helpful coding assistant with access to tools. You can explore the codebase and make changes.

IMPORTANT: You MUST use tools to read files. You CANNOT see file contents without using the 'view' tool. Do NOT pretend or hallucinate file contents.

${baseInstructions}

# How to Use Tools

To use a tool, respond with a JSON block in this format:

\`\`\`tool
{
  "name": "tool_name",
  "arguments": {
    "param1": "value1"
  }
}
\`\`\`

CRITICAL:
- Use \`\`\`tool (not \`\`\`json or other formats)
- You CANNOT read files without using the 'view' tool
- Do NOT make up or assume file contents

You can call multiple tools by including multiple \`\`\`tool blocks.

# Guidelines

- Use 'glob' to find files by pattern (e.g., "**/*.ts")
- Use 'grep' to search file contents for patterns
- Use 'view' to read file contents
- Use 'edit' for targeted changes to existing files
- Use 'write' for new files or complete rewrites
- Use 'bash' for running commands`;
}

/**
 * Run an agent loop with tool access
 *
 * The agent can call tools to explore the codebase, then respond.
 * Loop continues until agent responds without tool calls.
 */
export async function runAgentLoop(
  adapter: Adapter,
  userMessage: string,
  options: AgentLoopOptions = {}
): Promise<AgentLoopResult> {
  const tools = options.tools ?? allTools;
  const cwd = options.cwd ?? process.cwd();
  const startTime = Date.now();

  const allToolCalls: ToolCall[] = [];
  const allToolResults: ToolResult[] = [];
  const messages: AgentMessage[] = [];

  // Get project structure overview (file listing - not contents)
  const projectFiles = getProjectStructure(cwd);

  // Build tool descriptions for system prompt
  const toolDescriptions = tools.map(t => {
    const params = Object.entries(t.parameters.properties || {})
      .map(([name, schema]) => `  - ${name}: ${(schema as { description: string }).description}`)
      .join('\n');
    const required = t.parameters.required?.join(', ') || 'none';
    return `## ${t.name}\n${t.description}\n\nParameters:\n${params}\nRequired: ${required}`;
  }).join('\n\n---\n\n');

  // Build adapter-specific system prompt
  const systemPrompt = buildSystemPrompt(adapter.name, projectFiles, toolDescriptions);

  // Initial message
  messages.push({ role: 'user', content: userMessage });

  let lastResponse: ModelResponse | null = null;
  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    // Build prompt with history
    const prompt = buildPrompt(systemPrompt, messages);

    // Call LLM
    const response = await adapter.run(prompt, {
      ...options,
      disableTools: true, // We handle tools ourselves
    });

    lastResponse = response;

    if (response.error) {
      return {
        content: response.error,
        model: response.model,
        iterations,
        toolCalls: allToolCalls,
        toolResults: allToolResults,
        duration: Date.now() - startTime,
      };
    }

    options.onIteration?.(iterations, response.content);

    // Parse tool calls from response
    const toolCalls = parseToolCalls(response.content);

    if (toolCalls.length === 0) {
      // No tool calls - we're done
      return {
        content: response.content,
        model: response.model,
        iterations,
        toolCalls: allToolCalls,
        toolResults: allToolResults,
        tokens: response.tokens,
        duration: Date.now() - startTime,
      };
    }

    // Execute tools
    messages.push({
      role: 'assistant',
      content: response.content,
      toolCalls,
    });

    const results: ToolResult[] = [];
    let cancelled = false;

    for (const call of toolCalls) {
      options.onToolCall?.(call);
      allToolCalls.push(call);

      // Check if permission is needed
      const permissionResult = await checkAndRequestPermission(call, cwd, options.onPermissionRequest);

      if (permissionResult.decision === 'cancel') {
        cancelled = true;
        results.push({
          toolCallId: call.id,
          content: 'Operation cancelled by user',
          isError: true,
        });
        break;
      }

      if (permissionResult.decision === 'deny') {
        results.push({
          toolCallId: call.id,
          content: 'Permission denied by user',
          isError: true,
        });
        allToolResults.push(results[results.length - 1]);
        continue;
      }

      // Permission granted - execute tool
      options.onToolStart?.(call);
      const result = await executeTool(call, cwd);
      options.onToolEnd?.(call, result);

      results.push(result);
      options.onToolResult?.(result);
      allToolResults.push(result);

      // Small delay to ensure UI updates between tool calls
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    // If cancelled, return early
    if (cancelled) {
      return {
        content: 'Operation cancelled by user',
        model: lastResponse?.model || adapter.name,
        iterations,
        toolCalls: allToolCalls,
        toolResults: allToolResults,
        duration: Date.now() - startTime,
      };
    }

    // Add tool results to messages
    messages.push({
      role: 'tool',
      content: '',
      toolResults: results,
    });
  }

  // Max iterations reached
  return {
    content: lastResponse?.content || 'Max iterations reached without final response',
    model: lastResponse?.model || adapter.name,
    iterations,
    toolCalls: allToolCalls,
    toolResults: allToolResults,
    duration: Date.now() - startTime,
  };
}

/**
 * Build full prompt from system message and conversation history
 */
function buildPrompt(systemPrompt: string, messages: AgentMessage[]): string {
  let prompt = systemPrompt + '\n\n---\n\n';

  for (const msg of messages) {
    if (msg.role === 'user') {
      prompt += `User: ${msg.content}\n\n`;
    } else if (msg.role === 'assistant') {
      prompt += `Assistant: ${msg.content}\n\n`;
    } else if (msg.role === 'tool') {
      prompt += 'Tool Results:\n';
      for (const result of msg.toolResults || []) {
        const status = result.isError ? 'ERROR' : 'SUCCESS';
        prompt += `[${status}] ${result.toolCallId}:\n${result.content}\n\n`;
      }
    }
  }

  prompt += 'Assistant: ';
  return prompt;
}

/**
 * Parse tool calls from LLM response
 */
function parseToolCalls(content: string): ToolCall[] {
  const calls: ToolCall[] = [];
  const toolBlockRegex = /```tool\s*([\s\S]*?)```/g;

  let match;

  while ((match = toolBlockRegex.exec(content)) !== null) {
    try {
      const json = match[1].trim();
      const parsed = JSON.parse(json);

      if (parsed.name && typeof parsed.name === 'string') {
        // Use unique ID to avoid collisions across iterations
        const uniqueId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        calls.push({
          id: uniqueId,
          name: parsed.name,
          arguments: parsed.arguments || {},
        });
      }
    } catch {
      // Invalid JSON, skip
    }
  }

  return calls;
}

/**
 * Check if permission is needed and request it
 */
async function checkAndRequestPermission(
  call: ToolCall,
  cwd: string,
  handler?: PermissionHandler
): Promise<PermissionResult> {
  // Normalize tool name (handle aliases like read_file -> view)
  const toolName = normalizeToolName(call.name);

  // Handle different argument names (file_path -> path, pattern for glob/grep, etc.)
  const filePath = (call.arguments.path || call.arguments.file_path || call.arguments.file) as string | undefined;
  const pattern = call.arguments.pattern as string | undefined;
  const command = (call.arguments.command || call.arguments.cmd) as string | undefined;

  // Determine action type using normalized name
  let action: 'read' | 'write' | 'execute';
  if (READ_TOOLS.includes(toolName)) {
    action = 'read';
  } else if (WRITE_TOOLS.includes(toolName)) {
    action = 'write';
  } else if (EXEC_TOOLS.includes(toolName)) {
    action = 'execute';
  } else {
    // Unknown tool type, allow by default
    return { decision: 'allow' };
  }

  // Build full path (for file operations) or use pattern (for glob/grep)
  let fullPath: string | undefined;
  let displayTarget: string | undefined;

  if (filePath) {
    fullPath = filePath.startsWith('/') ? filePath : `${cwd}/${filePath}`;
    displayTarget = fullPath;
  } else if (pattern) {
    // For glob/grep, use cwd as the base path for auto-approval
    fullPath = cwd;
    displayTarget = pattern;
  }

  // Check if already auto-approved
  if (permissionTracker.isAutoApproved(action, fullPath)) {
    return { decision: 'allow' };
  }

  // No handler = auto-allow (for non-interactive mode)
  if (!handler) {
    return { decision: 'allow' };
  }

  // Request permission (use normalized name)
  const request: PermissionRequest = {
    action,
    tool: toolName,
    path: displayTarget,
    command,
    description: getPermissionDescription(toolName, call.arguments),
  };

  const result = await handler(request);

  // Record approval for future auto-approve
  if (result.decision === 'allow_dir' || result.decision === 'allow_all') {
    permissionTracker.recordApproval(action, result.decision, fullPath);
  }

  return result;
}

/**
 * Get human-readable description for permission request
 */
function getPermissionDescription(toolName: string, args: Record<string, unknown>): string {
  // Handle different argument names
  const path = args.path || args.file_path || args.file;
  const pattern = args.pattern;
  const command = args.command || args.cmd;

  switch (toolName) {
    case 'view':
      return `Read contents of file: ${path}`;
    case 'glob':
      return `Search for files matching: ${pattern}`;
    case 'grep':
      return `Search file contents for: ${pattern}`;
    case 'write':
      return `Create/overwrite file: ${path}`;
    case 'edit':
      return `Edit file: ${path}`;
    case 'bash':
      return `Execute command: ${command}`;
    default:
      return `Execute tool: ${toolName}`;
  }
}

/**
 * Get project structure (file listing) for context
 * Returns a tree-like listing of important files
 */
function getProjectStructure(cwd: string): string {
  try {
    // Get key project files
    const patterns = [
      'README.md',
      'package.json',
      'tsconfig.json',
      'go.mod',
      'Cargo.toml',
      'requirements.txt',
      'src/**/*.{ts,tsx,js,jsx}',
      'lib/**/*.{ts,tsx,js,jsx}',
      'app/**/*.{ts,tsx,js,jsx}',
      'pages/**/*.{ts,tsx,js,jsx}',
      'components/**/*.{ts,tsx,js,jsx}',
      '*.{ts,tsx,js,jsx,go,rs,py}',
    ];

    const files: string[] = [];
    for (const pattern of patterns) {
      const matches = globSync(pattern, {
        cwd,
        ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**'],
        nodir: true,
      });
      files.push(...matches);
    }

    // Dedupe and sort
    const uniqueFiles = [...new Set(files)].sort();

    // Limit to 100 files to avoid huge prompts
    const limited = uniqueFiles.slice(0, 100);

    if (limited.length === 0) {
      return '(No files found - use glob tool to explore)';
    }

    let result = limited.join('\n');
    if (uniqueFiles.length > 100) {
      result += `\n... and ${uniqueFiles.length - 100} more files`;
    }

    return result;
  } catch {
    return '(Unable to list files - use glob tool to explore)';
  }
}

export { allTools, executeTools };
