import { execa } from 'execa';
import { spawn } from 'child_process';
import pc from 'picocolors';
import { resolve } from 'path';
import { getConfig } from '../../lib/config';
import { startServer } from '../../api/server';
import { connectToMCP, disconnectFromMCP, getConnectionState } from '../../mcp/ws-client';

interface ServeOptions {
  port?: number;
  host?: string;
  web?: boolean;
  terminalPort?: number;
  mcp?: boolean;           // Start MCP bridge instead of API server
  mcpPort?: number;        // MCP bridge port (default: 9234)
}

export async function serveCommand(options: ServeOptions): Promise<void> {
  const config = getConfig();

  // MCP Bridge mode (cloud-only)
  if (options.mcp) {
    const hasToken = !!config.cloud?.token;

    if (!hasToken) {
      console.log(pc.red('\n✗ Not logged in.'));
      console.log(pc.dim('  Run "puzld login" to authenticate with PuzldAI cloud.'));
      process.exit(1);
    }

    console.log(pc.bold('\nStarting PuzldAI MCP Bridge\n'));

    try {
      await connectToMCP();

      console.log(pc.green('✓ Connected to MCP cloud via WebSocket'));
      console.log(pc.dim('  Waiting for execution requests from MCP...'));
      console.log(pc.dim('\nPress Ctrl+C to stop'));

      // Handle shutdown
      const shutdown = () => {
        console.log(pc.dim('\nDisconnecting from MCP...'));
        disconnectFromMCP();
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

      // Status check every 30s
      setInterval(() => {
        const state = getConnectionState();
        if (!state.connected) {
          console.log(pc.yellow(`[status] Reconnecting (attempt ${state.reconnectAttempts})...`));
        }
      }, 30000);

      // Keep process alive
      await new Promise(() => {});
    } catch (err: unknown) {
      const error = err as Error;
      console.error(pc.red(`\n✗ Failed to connect to MCP: ${error.message}`));
      console.log(pc.dim('  Check your internet connection and try again.'));
      process.exit(1);
    }
    return;
  }

  // Standard API server mode
  const port = options.port || config.api.port;
  const host = options.host || config.api.host;

  console.log(pc.bold('\nStarting PuzldAI Server\n'));

  try {
    await startServer({ port, host });

    console.log(pc.green(`✓ API server running at http://${host}:${port}`));
    console.log(pc.dim(`  POST /task - Submit a task`));
    console.log(pc.dim(`  GET  /task/:id - Get task result`));
    console.log(pc.dim(`  GET  /task/:id/stream - SSE stream`));
    console.log(pc.dim(`  GET  /agents - List agents`));
    console.log(pc.dim(`  GET  /health - Health check`));

    if (options.web && config.ttyd.enabled) {
      const ttydPort = options.terminalPort || config.ttyd.port;
      try {
        await execa('which', ['ttyd']);

        // Use the current runtime and script to launch agent mode
        const runtime = process.argv[0]; // bun or node
        const script = resolve(process.cwd(), 'src/cli/index.ts');

        // Use native spawn for detached process to avoid execa tracking
        // -W enables writable mode (client can send input)
        const ttyd = spawn('ttyd', ['-W', '-p', String(ttydPort), runtime, script, 'agent'], {
          stdio: 'ignore',
          detached: true
        });
        ttyd.unref();

        console.log(pc.green(`\n✓ Terminal at http://${host}:${ttydPort}`));
      } catch {
        console.log(pc.yellow('\n⚠ ttyd not available (run "ai check" for details)'));
      }
    }

    console.log(pc.dim('\nPress Ctrl+C to stop'));
  } catch (err: unknown) {
    const error = err as Error;
    console.error(pc.red(`Failed to start server: ${error.message}`));
    process.exit(1);
  }
}
