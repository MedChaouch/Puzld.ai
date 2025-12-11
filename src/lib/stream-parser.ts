/**
 * Stream Parser for Claude CLI JSONL Output (Phase 9.1)
 *
 * Parses `--output-format stream-json --verbose` output to extract
 * tool calls, results, and streaming text for real-time visibility.
 *
 * JSONL Format:
 * {"type":"system","subtype":"init","session_id":"...","tools":[...]}
 * {"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{...},"id":"toolu_..."}]}}
 * {"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_...","content":"..."}]}}
 * {"type":"result","subtype":"success","result":"...","usage":{...}}
 */

// ============================================================================
// Tool Call Types
// ============================================================================

export type ToolName = 'Read' | 'Write' | 'Edit' | 'Bash' | 'Glob' | 'Grep' | 'WebFetch' | 'WebSearch' | 'Task' | string;

export interface ToolCallInput {
  file_path?: string;
  content?: string;
  old_string?: string;
  new_string?: string;
  command?: string;
  pattern?: string;
  path?: string;
  query?: string;
  url?: string;
  prompt?: string;
  [key: string]: unknown;
}

export interface ToolCall {
  id: string;
  name: ToolName;
  input: ToolCallInput;
  startedAt: number;
}

export interface ToolResult {
  toolUseId: string;
  content: string;
  isError?: boolean;
  duration?: number;
}

// ============================================================================
// Stream Event Types
// ============================================================================

export type StreamEventType =
  | 'init'
  | 'tool_call'
  | 'tool_result'
  | 'text'
  | 'result'
  | 'error';

export interface InitEvent {
  type: 'init';
  sessionId: string;
  tools: string[];
  model?: string;
}

export interface ToolCallEvent {
  type: 'tool_call';
  call: ToolCall;
}

export interface ToolResultEvent {
  type: 'tool_result';
  result: ToolResult;
}

export interface TextEvent {
  type: 'text';
  text: string;
}

export interface ResultEvent {
  type: 'result';
  subtype: 'success' | 'error';
  result: string;
  isError: boolean;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  permissionDenials?: Array<{
    tool_name: string;
    tool_input: Record<string, unknown>;
  }>;
}

export interface ErrorEvent {
  type: 'error';
  message: string;
  raw?: string;
}

export type StreamEvent =
  | InitEvent
  | ToolCallEvent
  | ToolResultEvent
  | TextEvent
  | ResultEvent
  | ErrorEvent;

// ============================================================================
// Raw JSONL Types (Claude CLI output)
// ============================================================================

interface RawSystemMessage {
  type: 'system';
  subtype: 'init';
  session_id: string;
  tools?: string[];
  model?: string;
}

interface RawAssistantMessage {
  type: 'assistant';
  message: {
    content: Array<
      | { type: 'text'; text: string }
      | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
    >;
  };
}

interface RawUserMessage {
  type: 'user';
  message?: {
    content: Array<
      | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
    >;
  };
  tool_use_result?: string;
}

interface RawResultMessage {
  type: 'result';
  subtype?: 'success' | 'error';
  result?: string;
  is_error?: boolean;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  permission_denials?: Array<{
    tool_name: string;
    tool_input: Record<string, unknown>;
  }>;
}

type RawMessage = RawSystemMessage | RawAssistantMessage | RawUserMessage | RawResultMessage;

// ============================================================================
// Stream Parser
// ============================================================================

export interface StreamParserState {
  initialized: boolean;
  sessionId?: string;
  tools: string[];
  activeToolCalls: Map<string, ToolCall>;
  events: StreamEvent[];
}

/**
 * Parse a single JSONL line into StreamEvents (can return multiple)
 */
export function parseLine(line: string, state: StreamParserState): StreamEvent[] {
  if (!line.trim()) return [];

  try {
    const json = JSON.parse(line) as RawMessage;
    return parseMessage(json, state);
  } catch {
    // Return error event for malformed JSON
    return [{
      type: 'error',
      message: 'Failed to parse JSONL line',
      raw: line
    }];
  }
}

/**
 * Parse a raw message into StreamEvents
 */
function parseMessage(msg: RawMessage, state: StreamParserState): StreamEvent[] {
  switch (msg.type) {
    case 'system':
      return [parseSystemMessage(msg, state)];
    case 'assistant':
      return parseAssistantMessage(msg, state);
    case 'user':
      return parseUserMessage(msg, state);
    case 'result':
      return [parseResultMessage(msg)];
    default:
      return [];
  }
}

function parseSystemMessage(msg: RawSystemMessage, state: StreamParserState): InitEvent {
  state.initialized = true;
  state.sessionId = msg.session_id;
  state.tools = msg.tools ?? [];

  return {
    type: 'init',
    sessionId: msg.session_id,
    tools: msg.tools ?? [],
    model: msg.model
  };
}

function parseAssistantMessage(msg: RawAssistantMessage, state: StreamParserState): StreamEvent[] {
  const events: StreamEvent[] = [];

  for (const content of msg.message.content) {
    if (content.type === 'text') {
      events.push({
        type: 'text',
        text: content.text
      });
    }

    if (content.type === 'tool_use') {
      const call: ToolCall = {
        id: content.id,
        name: content.name as ToolName,
        input: content.input as ToolCallInput,
        startedAt: Date.now()
      };

      state.activeToolCalls.set(content.id, call);

      events.push({
        type: 'tool_call',
        call
      });
    }
  }

  return events;
}

function parseUserMessage(msg: RawUserMessage, state: StreamParserState): StreamEvent[] {
  const events: StreamEvent[] = [];

  // Handle tool_use_result (permission denied, etc.)
  if (msg.tool_use_result) {
    // Find the most recent active tool call
    const entries = Array.from(state.activeToolCalls.entries());
    if (entries.length > 0) {
      const [toolId, call] = entries[entries.length - 1];
      state.activeToolCalls.delete(toolId);

      // Check for explicit error patterns (permission denied, etc.)
      const content = msg.tool_use_result;
      const isError = content.startsWith('Error:') ||
                      content.includes('permission') ||
                      content.includes('denied') ||
                      content.includes('failed');

      events.push({
        type: 'tool_result',
        result: {
          toolUseId: toolId,
          content,
          isError,
          duration: Date.now() - call.startedAt
        }
      });
    }
  }

  // Handle structured tool results (multiple possible)
  if (msg.message?.content) {
    for (const content of msg.message.content) {
      if (content.type === 'tool_result') {
        const call = state.activeToolCalls.get(content.tool_use_id);
        state.activeToolCalls.delete(content.tool_use_id);

        events.push({
          type: 'tool_result',
          result: {
            toolUseId: content.tool_use_id,
            content: content.content,
            isError: content.is_error,
            duration: call ? Date.now() - call.startedAt : undefined
          }
        });
      }
    }
  }

  return events;
}

function parseResultMessage(msg: RawResultMessage): ResultEvent {
  return {
    type: 'result',
    subtype: msg.subtype ?? (msg.is_error ? 'error' : 'success'),
    result: msg.result ?? '',
    isError: msg.is_error ?? false,
    usage: msg.usage,
    permissionDenials: msg.permission_denials
  };
}

// ============================================================================
// Stream Parser Class
// ============================================================================

export type StreamEventHandler = (event: StreamEvent) => void;

export class StreamParser {
  private state: StreamParserState;
  private handlers: Set<StreamEventHandler> = new Set();

  constructor() {
    this.state = {
      initialized: false,
      tools: [],
      activeToolCalls: new Map(),
      events: []
    };
  }

  /**
   * Subscribe to stream events
   */
  onEvent(handler: StreamEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /**
   * Parse a single line and emit events
   */
  parseLine(line: string): StreamEvent[] {
    const events = parseLine(line, this.state);
    for (const event of events) {
      this.state.events.push(event);
      this.handlers.forEach(h => h(event));
    }
    return events;
  }

  /**
   * Parse multiple lines (full output)
   */
  parseAll(output: string): StreamEvent[] {
    const allEvents: StreamEvent[] = [];
    const lines = output.split('\n');

    for (const line of lines) {
      const events = this.parseLine(line);
      allEvents.push(...events);
    }

    return allEvents;
  }

  /**
   * Get current state
   */
  getState(): Readonly<StreamParserState> {
    return this.state;
  }

  /**
   * Get all collected events
   */
  getEvents(): StreamEvent[] {
    return [...this.state.events];
  }

  /**
   * Get tool calls only
   */
  getToolCalls(): ToolCallEvent[] {
    return this.state.events.filter(
      (e): e is ToolCallEvent => e.type === 'tool_call'
    );
  }

  /**
   * Get final result
   */
  getResult(): ResultEvent | null {
    return this.state.events.find(
      (e): e is ResultEvent => e.type === 'result'
    ) ?? null;
  }

  /**
   * Reset state for reuse
   */
  reset(): void {
    this.state = {
      initialized: false,
      tools: [],
      activeToolCalls: new Map(),
      events: []
    };
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format a tool call for display
 */
export function formatToolCall(call: ToolCall): string {
  const { name, input } = call;

  switch (name) {
    case 'Read':
      return `Read: ${input.file_path}`;
    case 'Write':
      return `Write: ${input.file_path} (${(input.content as string)?.length ?? 0} chars)`;
    case 'Edit':
      return `Edit: ${input.file_path}`;
    case 'Bash':
      return `Bash: ${truncate(input.command as string, 50)}`;
    case 'Glob':
      return `Glob: ${input.pattern}${input.path ? ` in ${input.path}` : ''}`;
    case 'Grep':
      return `Grep: ${truncate(input.pattern as string, 30)}${input.path ? ` in ${input.path}` : ''}`;
    case 'WebFetch':
      return `WebFetch: ${input.url}`;
    case 'WebSearch':
      return `WebSearch: ${truncate(input.query as string, 40)}`;
    case 'Task':
      return `Task: ${truncate(input.prompt as string, 40)}`;
    default:
      return `${name}: ${JSON.stringify(input).slice(0, 50)}...`;
  }
}

/**
 * Get icon for tool
 */
export function getToolIcon(name: ToolName): string {
  const icons: Record<string, string> = {
    Read: '\u{1F4D6}',      // book
    Write: '\u{1F4DD}',     // memo
    Edit: '\u{270F}',       // pencil
    Bash: '\u{1F4BB}',      // computer
    Glob: '\u{1F50D}',      // magnifying glass
    Grep: '\u{1F50E}',      // magnifying glass tilted right
    WebFetch: '\u{1F310}',  // globe with meridians
    WebSearch: '\u{1F50D}', // magnifying glass
    Task: '\u{1F916}'       // robot
  };

  return icons[name] ?? '\u{1F527}'; // wrench for unknown
}

/**
 * Truncate string with ellipsis
 */
function truncate(str: string | undefined, maxLen: number): string {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen - 3) + '...' : str;
}
