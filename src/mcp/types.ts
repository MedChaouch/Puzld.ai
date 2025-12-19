/**
 * MCP Types - Shared types for Core ↔ MCP communication
 */

// Agent capabilities that Core reports to MCP
export interface CoreCapabilities {
  agents: string[];           // Available agents: ['claude', 'gemini', 'ollama', ...]
  modes: string[];            // Available modes: ['run', 'compare', 'pipeline', ...]
  models: Record<string, string>;  // Configured model per agent from config
  availableModels: Record<string, string[]>;  // All available models per agent
  version: string;            // PuzldAI version
}

// Registration request from Core to MCP
export interface RegisterRequest {
  machineId: string;
  capabilities: CoreCapabilities;
}

// Registration response from MCP to Core
export interface RegisterResponse {
  connectionId: string;
  expiresAt: string;          // ISO timestamp
}

// Execute intent from MCP to Core
export interface ExecuteIntent {
  executionId: string;
  plan: ExecutionPlan;
}

// Execution plan (what MCP wants Core to do)
export interface ExecutionPlan {
  type: 'single' | 'compare' | 'pipeline' | 'debate';
  agent?: string;             // For single mode
  agents?: string[];          // For compare/debate
  prompt: string;
  options?: {
    model?: string;
    timeout?: number;
  };
}

// Execute result from Core to MCP
export interface ExecuteResult {
  executionId: string;
  status: 'completed' | 'failed' | 'cancelled';
  output?: string;
  error?: string;
  tokens?: {
    input: number;
    output: number;
  };
  duration?: number;          // ms
}

// Health check response
export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  uptime: number;             // seconds
  agents: Record<string, boolean>;  // agent availability
}

// Capabilities response
export interface CapabilitiesResponse {
  machineId: string;
  capabilities: CoreCapabilities;
  connected: boolean;
  connectedAt?: string;
}

// Error response
export interface ErrorResponse {
  error: string;
  code?: string;
  details?: unknown;
}

// Bridge server state
export interface BridgeState {
  running: boolean;
  port: number;
  host: string;
  connectionId?: string;
  registeredAt?: Date;
  lastHeartbeat?: Date;
}
