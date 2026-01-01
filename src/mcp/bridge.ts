/**
 * MCP Bridge Server (DEPRECATED)
 *
 * @deprecated This local HTTP bridge is deprecated and should not be used.
 * MCP is cloud-only to enforce auth, quotas, and billing.
 * Use WebSocket connection via ws-client.ts instead.
 *
 * See: SECURITY.md → "Local Bypass Prevention"
 *
 * This file is kept for reference but startBridge() should never be called.
 * All MCP traffic must route through cloud (api.puzld.cc).
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { getConfig, loadConfig } from '../lib/config';
import { adapters } from '../adapters';
import { runAgentLoop } from '../agentic/agent-loop';
import { registerWithMCP, startHeartbeat, stopHeartbeat } from './registration';
import type {
  ExecuteIntent,
  ExecuteResult,
  HealthResponse,
  CapabilitiesResponse,
  CoreCapabilities,
  BridgeState,
  ErrorResponse
} from './types';

// Bridge state
let bridgeState: BridgeState = {
  running: false,
  port: 9234,
  host: '127.0.0.1'
};

// Get current capabilities
async function getCapabilities(): Promise<CoreCapabilities> {
  const available: string[] = [];

  for (const [name, adapter] of Object.entries(adapters)) {
    try {
      if (await adapter.isAvailable()) {
        available.push(name);
      }
    } catch {
      // Skip unavailable adapters
    }
  }

  return {
    agents: available,
    modes: ['run', 'compare', 'pipeline', 'debate', 'consensus', 'correct'],
    version: process.env.npm_package_version || '0.2.91'
  };
}

// Get machine ID (generate if not exists)
function getMachineId(): string {
  const config = getConfig();
  if (config.cloud?.machineId) {
    return config.cloud.machineId;
  }

  // Generate new machine ID
  const machineId = `machine_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  // Save to config
  const fullConfig = loadConfig();
  fullConfig.cloud = { ...fullConfig.cloud, machineId, endpoint: fullConfig.cloud?.endpoint || 'https://api.puzld.cc' };

  // Import saveConfig dynamically to avoid circular deps
  import('../lib/config').then(({ saveConfig }) => {
    saveConfig(fullConfig);
  });

  return machineId;
}

// Create Hono app
export function createBridgeApp(): Hono {
  const app = new Hono();

  // Health check
  app.get('/mcp/health', async (c) => {
    const startTime = bridgeState.registeredAt || new Date();
    const uptime = Math.floor((Date.now() - startTime.getTime()) / 1000);

    const capabilities = await getCapabilities();
    const agentStatus: Record<string, boolean> = {};

    for (const agent of capabilities.agents) {
      agentStatus[agent] = true;
    }

    const response: HealthResponse = {
      status: 'healthy',
      version: capabilities.version,
      uptime,
      agents: agentStatus
    };

    return c.json(response);
  });

  // Capabilities
  app.get('/mcp/capabilities', async (c) => {
    const capabilities = await getCapabilities();

    const response: CapabilitiesResponse = {
      machineId: getMachineId(),
      capabilities,
      connected: !!bridgeState.connectionId,
      connectedAt: bridgeState.registeredAt?.toISOString()
    };

    return c.json(response);
  });

  // Execute intent from MCP
  app.post('/mcp/execute', async (c) => {
    try {
      const intent = await c.req.json<ExecuteIntent>();

      if (!intent.executionId || !intent.plan) {
        const error: ErrorResponse = { error: 'Invalid intent: missing executionId or plan' };
        return c.json(error, 400);
      }

      const { plan } = intent;
      const startTime = Date.now();

      // Get adapter
      const agentName = plan.agent || 'ollama';
      const adapter = adapters[agentName];

      if (!adapter) {
        const error: ErrorResponse = { error: `Unknown agent: ${agentName}` };
        return c.json(error, 400);
      }

      // Check availability
      if (!await adapter.isAvailable()) {
        const error: ErrorResponse = { error: `Agent not available: ${agentName}` };
        return c.json(error, 503);
      }

      // Execute based on plan type
      let output = '';
      let tokens: { input: number; output: number } | undefined;

      if (plan.type === 'single') {
        // Single agent execution via agent loop
        const result = await runAgentLoop(adapter, plan.prompt, {
          model: plan.options?.model,
          timeout: plan.options?.timeout,
          cwd: process.cwd(),
          // No permission handler - MCP executions are trusted
          // No diff preview - MCP executions auto-apply
          allowAllEdits: true
        });

        output = result.content;
        tokens = result.tokens;
      } else {
        // For now, only single mode supported via bridge
        // Compare/pipeline/debate would need orchestrator integration
        const error: ErrorResponse = {
          error: `Plan type '${plan.type}' not yet supported via MCP bridge`,
          code: 'UNSUPPORTED_PLAN_TYPE'
        };
        return c.json(error, 501);
      }

      const result: ExecuteResult = {
        executionId: intent.executionId,
        status: 'completed',
        output,
        tokens,
        duration: Date.now() - startTime
      };

      return c.json(result);

    } catch (err) {
      const error = err as Error;
      const result: ExecuteResult = {
        executionId: 'unknown',
        status: 'failed',
        error: error.message
      };
      return c.json(result, 500);
    }
  });

  // Root endpoint
  app.get('/', (c) => {
    return c.json({
      name: 'PuzldAI MCP Bridge',
      version: process.env.npm_package_version || '0.2.91',
      status: bridgeState.running ? 'running' : 'stopped',
      endpoints: [
        'GET  /mcp/health',
        'GET  /mcp/capabilities',
        'POST /mcp/execute'
      ]
    });
  });

  return app;
}

// Start bridge server
export async function startBridge(options: {
  port?: number;
  host?: string;
  register?: boolean;
}): Promise<void> {
  const config = getConfig();
  const port = options.port || config.mcp?.port || 9234;
  const host = options.host || config.mcp?.host || '127.0.0.1';

  const app = createBridgeApp();

  // Start server
  const server = serve({
    fetch: app.fetch,
    port,
    hostname: host
  });

  bridgeState = {
    running: true,
    port,
    host,
    registeredAt: new Date()
  };

  console.log(`MCP Bridge running on http://${host}:${port}`);
  console.log('Endpoints:');
  console.log('  GET  /mcp/health');
  console.log('  GET  /mcp/capabilities');
  console.log('  POST /mcp/execute');

  // Register with MCP if requested and token exists
  if (options.register !== false && config.cloud?.token) {
    try {
      const capabilities = await getCapabilities();
      const result = await registerWithMCP(getMachineId(), capabilities);
      bridgeState.connectionId = result.connectionId;
      console.log(`Registered with MCP: ${result.connectionId}`);

      // Start heartbeat
      startHeartbeat(getMachineId());
    } catch (err) {
      console.warn('Failed to register with MCP:', (err as Error).message);
      console.warn('Bridge will run in local-only mode');
    }
  } else if (!config.cloud?.token) {
    console.log('No MCP token found. Run "puzld login" to connect to MCP.');
    console.log('Bridge running in local-only mode.');
  }

  // Handle shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down MCP Bridge...');
    stopHeartbeat();
    bridgeState.running = false;
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    stopHeartbeat();
    bridgeState.running = false;
    process.exit(0);
  });
}

// Get bridge state
export function getBridgeState(): BridgeState {
  return { ...bridgeState };
}
