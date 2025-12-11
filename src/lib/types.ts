export interface ModelResponse {
  content: string;
  model: string;
  tokens?: {
    input: number;
    output: number;
  };
  duration?: number;
  error?: string;
}

export interface RunOptions {
  signal?: AbortSignal;
  onChunk?: (chunk: string) => void;
  onToolEvent?: (event: import('./stream-parser').StreamEvent) => void;
  model?: string;
}

export interface Adapter {
  name: string;
  run(prompt: string, options?: RunOptions): Promise<ModelResponse>;
  isAvailable(): Promise<boolean>;
}

export interface RouteResult {
  agent: 'claude' | 'gemini' | 'codex' | 'ollama';
  confidence: number;
  reasoning?: string;
  taskType?: string;
}

export interface CheckResult {
  name: string;
  available: boolean;
  version?: string;
  error?: string;
}

export interface TaskRecord {
  id: string;
  prompt: string;
  agent: string;
  response: string;
  timestamp: string;
  duration?: number;
}

export enum ErrorCode {
  ADAPTER_NOT_FOUND = 'ADAPTER_NOT_FOUND',
  ADAPTER_UNAVAILABLE = 'ADAPTER_UNAVAILABLE',
  ADAPTER_TIMEOUT = 'ADAPTER_TIMEOUT',
  ADAPTER_CRASHED = 'ADAPTER_CRASHED',
  ROUTER_FAILED = 'ROUTER_FAILED',
  ROUTER_INVALID_JSON = 'ROUTER_INVALID_JSON',
  OLLAMA_NOT_RUNNING = 'OLLAMA_NOT_RUNNING',
  CONFIG_INVALID = 'CONFIG_INVALID',
  TASK_CANCELLED = 'TASK_CANCELLED',
}

export interface PulzdError {
  code: ErrorCode;
  message: string;
  suggestion?: string;
  recoverable: boolean;
}
