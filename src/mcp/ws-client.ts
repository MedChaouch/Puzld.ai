/**
 * MCP WebSocket Client
 *
 * Connects Core to MCP cloud via WebSocket (outbound connection).
 * This reverses the connection direction - Core connects OUT to MCP,
 * solving the localhost unreachable problem.
 *
 * Features:
 * - Automatic reconnection with exponential backoff + jitter
 * - Heartbeat every 30s to keep connection alive
 * - Concurrency protection (one execution at a time)
 * - Message validation before processing
 *
 * Security notes:
 * - All traffic flows through authenticated WebSocket: MCP → DO → WS → Core
 * - No direct HTTP probing of Core (intentional security feature)
 * - See SECURITY.md sections 13-14 for future enhancements
 */

// @ts-ignore - ws types available at runtime via bun
import WebSocket from 'ws';
import { globSync } from 'glob';
import { getConfig, loadConfig, saveConfig } from '../lib/config';
import { adapters } from '../adapters';
import { runAgentLoop } from '../agentic/agent-loop';
import { execute } from '../executor';
import { buildComparePlan } from '../executor/plan-builders';
import { getAgentModelOptions } from '../lib/models';
import type { AgentName } from '../executor/types';
import type { CoreCapabilities, ExecutionPlan } from './types';

import { createHmac, createHash } from 'crypto';

// Execution timeout (10 minutes hard kill)
const EXECUTION_TIMEOUT_MS = 10 * 60 * 1000;

// Timestamp validation window (±30 seconds)
const TIMESTAMP_WINDOW_MS = 30 * 1000;

// Replay protection: track seen executionIds (auto-cleanup after 5 minutes)
const seenExecutionIds = new Map<string, number>();
const REPLAY_WINDOW_MS = 5 * 60 * 1000;

// Connection nonce to prevent zombie socket handling
let connectionNonce = 0;

// Connection state
interface WSClientState {
  ws: WebSocket | null;
  connected: boolean;
  reconnectAttempts: number;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  busy: boolean;  // Concurrency protection - only one execution at a time
  currentExecutionId: string | null;  // Track current execution for debugging
  secret: string | null;  // HMAC secret for verifying execute messages
}

const state: WSClientState = {
  ws: null,
  connected: false,
  reconnectAttempts: 0,
  heartbeatTimer: null,
  busy: false,
  currentExecutionId: null,
  secret: null
};

// Message types from BridgeHub
interface ExecuteMessage {
  type: 'execute';
  executionId: string;
  timestamp: number;
  payload: ExecutionPlan;
  sig?: string;  // HMAC signature for execution authority verification
}

interface HeartbeatAck {
  type: 'heartbeat_ack';
  timestamp: number;
}

interface RegisterAck {
  type: 'register_ack';
  timestamp: number;
  secret?: string;  // HMAC secret for verifying execute messages
}

type IncomingMessage = ExecuteMessage | HeartbeatAck | RegisterAck;

/**
 * Validate incoming message structure
 * Prevents processing malformed or unexpected messages
 */
function isValidExecuteMessage(msg: unknown): msg is ExecuteMessage {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  if (
    m.type !== 'execute' ||
    typeof m.executionId !== 'string' ||
    typeof m.timestamp !== 'number' ||
    typeof m.payload !== 'object' ||
    m.payload === null
  ) {
    return false;
  }

  // Validate payload structure
  const payload = m.payload as Record<string, unknown>;
  if (typeof payload.prompt !== 'string') return false;
  if (payload.agent !== undefined && typeof payload.agent !== 'string') return false;

  return true;
}

/**
 * Verify HMAC signature on execute message
 * Mirrors BridgeHub's signExecuteMessage exactly
 *
 * Signature format: HMAC(secret, "execute|executionId|timestamp|SHA256(payload)")
 */
function verifyExecuteSignature(
  secret: string,
  executionId: string,
  timestamp: number,
  payload: object,
  sig: string
): boolean {
  // Hash payload for canonical representation (matches BridgeHub)
  const payloadJson = JSON.stringify(payload);
  const payloadHash = createHash('sha256').update(payloadJson).digest('hex');

  // Create message: type|executionId|timestamp|payloadHash
  const message = `execute|${executionId}|${timestamp}|${payloadHash}`;

  // Compute expected signature
  const expectedSig = createHmac('sha256', secret).update(message).digest('hex');

  // Constant-time comparison to prevent timing attacks
  if (sig.length !== expectedSig.length) return false;
  let result = 0;
  for (let i = 0; i < sig.length; i++) {
    result |= sig.charCodeAt(i) ^ expectedSig.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Validate timestamp is within acceptable window (±30s)
 * Prevents replay of old messages
 */
function isTimestampValid(timestamp: number): boolean {
  const now = Date.now();
  const diff = Math.abs(now - timestamp);
  return diff <= TIMESTAMP_WINDOW_MS;
}

/**
 * Check and record executionId for replay protection
 * Returns true if this is a new (valid) executionId
 */
function checkAndRecordExecutionId(executionId: string): boolean {
  // Cleanup old entries periodically
  const now = Date.now();
  seenExecutionIds.forEach((time, id) => {
    if (now - time > REPLAY_WINDOW_MS) {
      seenExecutionIds.delete(id);
    }
  });

  // Check if we've seen this executionId before
  if (seenExecutionIds.has(executionId)) {
    return false;  // Replay detected
  }

  // Record this executionId
  seenExecutionIds.set(executionId, now);
  return true;
}

/**
 * Verify execute message: signature, timestamp, and replay protection
 * Returns error message if invalid, null if valid
 */
function verifyExecuteMessage(msg: ExecuteMessage): string | null {
  // Check if we have a secret
  if (!state.secret) {
    return 'No secret available - registration incomplete';
  }

  // Require signature
  if (!msg.sig) {
    return 'Missing signature';
  }

  // Verify HMAC signature
  if (!verifyExecuteSignature(state.secret, msg.executionId, msg.timestamp, msg.payload, msg.sig)) {
    return 'Invalid signature';
  }

  // Validate timestamp
  if (!isTimestampValid(msg.timestamp)) {
    return `Timestamp outside valid window (±${TIMESTAMP_WINDOW_MS / 1000}s)`;
  }

  // Check replay protection
  if (!checkAndRecordExecutionId(msg.executionId)) {
    return `Replay detected: executionId ${msg.executionId} already processed`;
  }

  return null;  // Valid
}

/**
 * Get current capabilities
 */
async function getCapabilities(): Promise<CoreCapabilities> {
  const config = getConfig();
  const available: string[] = [];
  const models: Record<string, string> = {};
  const availableModels: Record<string, string[]> = {};

  for (const [name, adapter] of Object.entries(adapters)) {
    try {
      if (await adapter.isAvailable()) {
        available.push(name);
        // Get configured model for this agent
        const adapterConfig = config.adapters[name as keyof typeof config.adapters];
        if (adapterConfig && 'model' in adapterConfig && adapterConfig.model) {
          models[name] = adapterConfig.model;
        }
        // Get available models from KNOWN_MODELS
        const agentModels = getAgentModelOptions(name);
        if (agentModels.length > 0) {
          availableModels[name] = agentModels;
        }
      }
    } catch {
      // Skip unavailable adapters
    }
  }

  return {
    agents: available,
    modes: ['run', 'compare', 'pipeline', 'debate', 'consensus', 'correct'],
    models,
    availableModels,
    // NOTE: npm_package_version may not be set in binary builds
    // Consider using a build-time constant for production binaries
    version: process.env.npm_package_version || '0.2.91'
  };
}

/**
 * Validate machineId format (must match MCP requirements)
 */
function isValidMachineId(machineId: string): boolean {
  return /^[a-zA-Z0-9_-]{1,32}$/.test(machineId);
}

/**
 * Get or generate machine ID
 * Format: m_<base36timestamp>_<4chars> (max 32 chars for MCP validation)
 */
function getMachineId(): string {
  const config = getConfig();

  // Check if existing machineId is valid
  if (config.cloud?.machineId && isValidMachineId(config.cloud.machineId)) {
    return config.cloud.machineId;
  }

  // Generate new machine ID (short format: m_xxxxxxxx_xxxx ~18 chars)
  const machineId = `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

  // Save to config
  const fullConfig = loadConfig();
  fullConfig.cloud = {
    ...fullConfig.cloud,
    machineId,
    endpoint: fullConfig.cloud?.endpoint || 'https://puzld-mcp.med-ch-mu.workers.dev'
  };
  saveConfig(fullConfig);

  console.log(`[ws-client] Generated new machineId: ${machineId}`);
  return machineId;
}

/**
 * Pick best available adapter for auto agent selection
 * Priority: claude > gemini > codex > ollama > mistral
 *
 * NOTE: This throws if no agents are available.
 * The error is caught in handleExecute and returned as a clean MCP error.
 */
/**
 * Generate project file structure for context injection
 * Returns a formatted string of file paths (max 200 files)
 */
function generateProjectStructure(cwd: string): string {
  try {
    const files = globSync('**/*', {
      cwd,
      ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/.*', '**/*.lock', '**/package-lock.json'],
      nodir: true,
      absolute: false,
    });

    // Sort and limit
    files.sort((a, b) => a.localeCompare(b));
    const limited = files.slice(0, 200);

    let output = limited.join('\n');
    if (files.length > 200) {
      output += `\n\n(Showing 200 of ${files.length} files)`;
    }

    return output;
  } catch {
    return '(Unable to read project structure)';
  }
}

async function pickBestAvailableAdapter(): Promise<string> {
  const priority = ['claude', 'gemini', 'codex', 'ollama', 'mistral'];

  for (const name of priority) {
    const adapter = adapters[name];
    if (adapter) {
      try {
        if (await adapter.isAvailable()) {
          return name;
        }
      } catch {
        // Continue to next
      }
    }
  }

  throw new Error('No agents available');
}

/**
 * Handle execute message from MCP
 * Supports: single, compare modes
 *
 * NOTE: state.busy is a Core-wide mutex. Compare mode internally runs
 * agents in parallel via the executor, but only one execution at a time.
 */
async function handleExecute(msg: ExecuteMessage): Promise<void> {
  const { executionId, payload: plan } = msg;

  // Concurrency protection
  if (state.busy) {
    sendResult(executionId, {
      status: 'busy',
      error: `Core is busy with execution ${state.currentExecutionId}`,
      retryAfter: 5
    });
    return;
  }

  state.busy = true;
  state.currentExecutionId = executionId;

  try {
    if (plan.type === 'compare') {
      await handleCompareMode(executionId, plan, Date.now());
    } else if (plan.type === 'single') {
      await handleSingleMode(executionId, plan, Date.now());
    } else {
      throw new Error(`Unsupported plan type: ${plan.type}`);
    }
  } catch (err) {
    const error = err as Error;
    sendResult(executionId, {
      status: 'error',
      error: error.message
    });
  } finally {
    state.busy = false;
    state.currentExecutionId = null;
  }
}

/**
 * Handle single agent execution
 */
async function handleSingleMode(
  executionId: string,
  plan: ExecutionPlan,
  startTime: number
): Promise<void> {
  // Get adapter - handle 'auto' selection
  let agentName = plan.agent || 'auto';
  if (agentName === 'auto') {
    agentName = await pickBestAvailableAdapter();
  }

  const adapter = adapters[agentName];
  if (!adapter) {
    throw new Error(`Unknown agent: ${agentName}`);
  }
  if (!await adapter.isAvailable()) {
    throw new Error(`Agent not available: ${agentName}`);
  }

  // Execute via agent loop with timeout protection
  const executionPromise = runAgentLoop(adapter, plan.prompt, {
    model: plan.options?.model,
    cwd: process.cwd(),
    allowAllEdits: true
  });

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Execution timeout after ${EXECUTION_TIMEOUT_MS / 1000}s`));
    }, EXECUTION_TIMEOUT_MS);
  });

  const result = await Promise.race([executionPromise, timeoutPromise]);
  const tokens = result.tokens ?? { input: 0, output: 0 };

  sendResult(executionId, {
    status: 'completed',
    output: result.content,
    tokens,
    duration: Date.now() - startTime
  });
}

/**
 * Handle compare mode - run prompt through multiple agents
 *
 * NOTE: Step → agent mapping relies on executor preserving order.
 * Future improvement: attach agent metadata to steps.
 */
async function handleCompareMode(
  executionId: string,
  plan: ExecutionPlan,
  startTime: number
): Promise<void> {
  const agents = plan.agents as AgentName[];
  const pick = plan.options?.pick ?? false;
  const models = plan.options?.models as string[] | undefined;
  const includeProjectContext = plan.options?.includeProjectContext ?? false;

  if (!agents || agents.length < 2) {
    throw new Error('Compare mode requires at least 2 agents');
  }

  // Verify all agents are available
  for (const agentName of agents) {
    const adapter = adapters[agentName];
    if (!adapter) {
      throw new Error(`Unknown agent: ${agentName}`);
    }
    if (!await adapter.isAvailable()) {
      throw new Error(`Agent not available: ${agentName}`);
    }
  }

  // Generate project structure if requested
  const projectStructure = includeProjectContext
    ? generateProjectStructure(process.cwd())
    : undefined;

  // Build compare plan using executor
  const comparePlan = buildComparePlan(plan.prompt, {
    agents,
    models,
    pick,
    sequential: false,
    projectStructure
  });

  // Execute via executor with timeout
  const executionPromise = execute(comparePlan, {
    adapters,
    cwd: process.cwd()
  });

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Compare timeout after ${EXECUTION_TIMEOUT_MS / 1000}s`));
    }, EXECUTION_TIMEOUT_MS);
  });

  const result = await Promise.race([executionPromise, timeoutPromise]);

  // Format output
  let output: string;
  if (result.finalOutput) {
    output = result.finalOutput;
  } else {
    // Format individual responses (step_0, step_1, etc. map to agents by order)
    const responses = (result.results || [])
      .filter(r => r.stepId.startsWith('step_'))
      .map((r, i) => `## ${agents[i]?.toUpperCase() || 'Agent ' + i}\n\n${r.content}`)
      .join('\n\n---\n\n');
    output = responses || 'No responses received';
  }

  // Sum tokens from all steps
  const totalTokens = (result.results || []).reduce(
    (acc, r) => ({
      input: acc.input + (r.tokens?.input || 0),
      output: acc.output + (r.tokens?.output || 0)
    }),
    { input: 0, output: 0 }
  );

  sendResult(executionId, {
    status: 'completed',
    output,
    tokens: totalTokens,
    duration: Date.now() - startTime
  });
}

/**
 * Send result back to MCP
 */
function sendResult(executionId: string, result: {
  status: 'completed' | 'error' | 'busy';
  output?: string;
  error?: string;
  tokens?: { input: number; output: number };
  duration?: number;
  retryAfter?: number;
}): void {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    console.error('[ws-client] Cannot send result - WebSocket not connected');
    return;
  }

  state.ws.send(JSON.stringify({
    type: 'result',
    executionId,
    ...result
  }));
}

/**
 * Send heartbeat
 */
function sendHeartbeat(): void {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    return;
  }

  state.ws.send(JSON.stringify({
    type: 'heartbeat',
    timestamp: Date.now()
  }));
}

/**
 * Start heartbeat timer
 */
function startHeartbeat(): void {
  if (state.heartbeatTimer) {
    clearInterval(state.heartbeatTimer);
  }

  state.heartbeatTimer = setInterval(sendHeartbeat, 30000);
}

/**
 * Stop heartbeat timer
 */
function stopHeartbeat(): void {
  if (state.heartbeatTimer) {
    clearInterval(state.heartbeatTimer);
    state.heartbeatTimer = null;
  }
}

/**
 * Connect to MCP WebSocket bridge
 */
export async function connectToMCP(): Promise<void> {
  // Prevent overlapping connections
  if (state.ws && state.connected) {
    console.log('[ws-client] Already connected, skipping');
    return;
  }

  const config = getConfig();
  const token = config.cloud?.token;

  if (!token) {
    throw new Error('No MCP token. Run "puzld login" first.');
  }

  const endpoint = config.cloud?.endpoint || 'https://puzld-mcp.med-ch-mu.workers.dev';
  const machineId = getMachineId();

  // Convert https:// to wss:// for WebSocket
  const wsEndpoint = endpoint.replace(/^https?:\/\//, 'wss://');
  const wsUrl = `${wsEndpoint}/bridge?machineId=${encodeURIComponent(machineId)}`;

  // Increment connection nonce to invalidate zombie handlers
  const thisConnectionNonce = ++connectionNonce;

  console.log(`[ws-client] Connecting to ${wsUrl} (nonce=${thisConnectionNonce})`);

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    ws.on('open', async () => {
      // Check if this connection is still valid
      if (thisConnectionNonce !== connectionNonce) {
        console.log('[ws-client] Stale connection opened, closing');
        ws.close();
        return;
      }

      console.log('[ws-client] Connected to MCP bridge');
      state.ws = ws;
      state.connected = true;
      state.reconnectAttempts = 0;

      // Send registration with capabilities
      const capabilities = await getCapabilities();
      ws.send(JSON.stringify({
        type: 'register',
        machineId,
        capabilities
      }));

      // Start heartbeat
      startHeartbeat();

      resolve();
    });

    ws.on('message', async (data: Buffer) => {
      // Ignore messages from zombie connections
      if (thisConnectionNonce !== connectionNonce) return;

      try {
        const msg = JSON.parse(data.toString()) as IncomingMessage;

        switch (msg.type) {
          case 'execute':
            // Validate message structure before processing
            if (!isValidExecuteMessage(msg)) {
              console.warn('[ws-client] Invalid execute message structure');
              return;
            }

            // Verify signature, timestamp, and replay protection
            const verifyError = verifyExecuteMessage(msg);
            if (verifyError) {
              console.error(`[ws-client] Execute verification failed: ${verifyError}`);
              // Send error result back to MCP
              sendResult(msg.executionId, {
                status: 'error',
                error: `Verification failed: ${verifyError}`
              });
              // Close connection on verification failure (forces re-registration)
              // This is aggressive but safer against MITM attempts
              state.ws?.close(1008, 'Invalid execute signature');
              return;
            }

            await handleExecute(msg);
            break;

          case 'register_ack':
            // Store secret for HMAC verification
            if (msg.secret) {
              state.secret = msg.secret;
              console.log('[ws-client] Registration acknowledged, secret received');
            } else {
              console.log('[ws-client] Registration acknowledged (no secret - legacy hub?)');
            }
            break;

          case 'heartbeat_ack':
            // Connection is alive
            break;

          default:
            console.warn(`[ws-client] Unknown message type: ${(msg as { type: string }).type}`);
        }
      } catch (err) {
        console.error('[ws-client] Failed to parse message:', err);
      }
    });

    ws.on('close', (code: number, reason: Buffer) => {
      // Ignore close events from zombie connections
      if (thisConnectionNonce !== connectionNonce) return;

      console.log(`[ws-client] Connection closed: ${code} - ${reason.toString()}`);
      state.connected = false;
      state.secret = null;  // Clear secret on disconnect (will get new one on reconnect)
      seenExecutionIds.clear();  // Clear replay map to avoid false positives on reconnect
      stopHeartbeat();

      // Auto-reconnect with exponential backoff + jitter
      if (state.reconnectAttempts < 10) {
        const baseDelay = Math.min(1000 * Math.pow(2, state.reconnectAttempts), 30000);
        const jitter = Math.random() * 1000;
        const delay = baseDelay + jitter;

        state.reconnectAttempts++;
        console.log(`[ws-client] Reconnecting in ${Math.round(delay)}ms (attempt ${state.reconnectAttempts})`);

        setTimeout(() => {
          connectToMCP().catch(reconnectErr => {
            console.error('[ws-client] Reconnection failed:', reconnectErr);
          });
        }, delay);
      } else {
        console.error('[ws-client] Max reconnection attempts reached');
      }
    });

    ws.on('error', (wsError: Error) => {
      // Ignore errors from zombie connections
      if (thisConnectionNonce !== connectionNonce) return;

      console.error('[ws-client] WebSocket error:', wsError);
      state.connected = false;

      // Terminate on error to trigger reconnect via close handler
      // Using terminate() instead of close() for immediate cleanup
      ws.terminate();

      // Only reject if this is the initial connection
      if (state.reconnectAttempts === 0) {
        reject(wsError);
      }
    });
  });
}

/**
 * Disconnect from MCP
 */
export function disconnectFromMCP(): void {
  stopHeartbeat();

  if (state.ws) {
    state.ws.close(1000, 'Client disconnect');
    state.ws = null;
  }

  state.connected = false;
  state.reconnectAttempts = 0;
  state.secret = null;
  seenExecutionIds.clear();
}

/**
 * Check if connected
 */
export function isConnected(): boolean {
  return state.connected && state.ws?.readyState === WebSocket.OPEN;
}

/**
 * Get connection state
 */
export function getConnectionState(): {
  connected: boolean;
  busy: boolean;
  currentExecutionId: string | null;
  reconnectAttempts: number;
} {
  return {
    connected: state.connected,
    busy: state.busy,
    currentExecutionId: state.currentExecutionId,
    reconnectAttempts: state.reconnectAttempts
  };
}
