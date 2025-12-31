/**
 * Login Command
 *
 * Browser-based authentication flow:
 * 1. CLI creates pending session
 * 2. Opens browser for user approval
 * 3. Polls for approval status
 * 4. Saves token on success
 *
 * API keys (pk_xxx) can still be used directly with --token flag.
 */

import { exec } from 'child_process';
import { randomUUID } from 'crypto';
import { hostname } from 'os';
import pc from 'picocolors';
import { getConfig, loadConfig, saveConfig } from '../../lib/config';

interface LoginOptions {
  token?: string;         // Direct API key (pk_xxx) - for headless/CI machines
  endpoint?: string;      // Override MCP endpoint
}

const DEFAULT_ENDPOINT = 'https://api.puzld.cc';
const WEB_APP_URL = 'https://app.puzld.cc';
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 150; // 5 minutes at 2s intervals

/**
 * Build auth headers based on token type
 */
function getAuthHeaders(token: string): Record<string, string> {
  if (token.startsWith('pk_') || token.startsWith('cli_')) {
    return { 'X-PUZLD-API-KEY': token };
  }
  return { 'Authorization': `Bearer ${token}` };
}

/**
 * Open URL in default browser (cross-platform)
 */
function openBrowser(url: string): void {
  const platform = process.platform;
  let command: string;

  if (platform === 'darwin') {
    command = `open "${url}"`;
  } else if (platform === 'win32') {
    command = `start "" "${url}"`;
  } else {
    // Linux and others
    command = `xdg-open "${url}"`;
  }

  exec(command, (err) => {
    if (err) {
      console.log(pc.yellow('\n⚠ Could not open browser automatically.'));
      console.log(pc.dim('  Please open this URL manually:'));
      console.log(pc.cyan(`  ${url}\n`));
    }
  });
}

/**
 * Generate a CLI session ID
 */
function generateSessionId(): string {
  return randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '').slice(0, 8);
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Login to MCP server via browser
 */
export async function loginCommand(options: LoginOptions): Promise<void> {
  const config = loadConfig();
  const endpoint = options.endpoint || config.cloud?.endpoint || DEFAULT_ENDPOINT;

  // Direct API key flow - for headless/CI machines
  if (options.token) {
    if (!options.token.startsWith('pk_')) {
      console.log(pc.red('✗ Invalid token format. API keys must start with pk_'));
      console.log(pc.dim('  Get your API key from https://app.puzld.cc/dashboard/api-keys'));
      return;
    }

    config.cloud = {
      ...config.cloud,
      endpoint,
      token: options.token
    };
    saveConfig(config);

    console.log(pc.green('✓ API key saved'));
    console.log(pc.dim('  Run "puzld serve --mcp" to start the bridge.'));
    return;
  }

  // Browser-based login flow
  console.log(pc.bold('\nPuzld CLI Login\n'));

  const cliSession = generateSessionId();
  const machineName = hostname();

  // Step 1: Create pending session
  console.log(pc.dim('Creating login session...'));

  try {
    const createResponse = await fetch(`${endpoint}/api/cli/session/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cli_session: cliSession,
        machine_name: machineName
      })
    });

    if (!createResponse.ok) {
      const error = await createResponse.text();
      console.log(pc.red(`✗ Failed to create session: ${error}`));
      return;
    }
  } catch (err) {
    console.log(pc.red(`✗ Could not connect to ${endpoint}`));
    console.log(pc.dim(`  Error: ${err instanceof Error ? err.message : 'Unknown error'}`));
    return;
  }

  // Step 2: Open browser
  const authUrl = `${WEB_APP_URL}/cli/authorize?s=${cliSession}`;
  console.log(pc.dim('Opening browser for authorization...'));
  openBrowser(authUrl);

  console.log(pc.cyan('\n→ Waiting for approval in browser...\n'));
  console.log(pc.dim('  Press Ctrl+C to cancel\n'));

  // Handle Ctrl+C - deny the pending session
  const cleanup = async () => {
    process.stdout.write('\n');
    console.log(pc.dim('Cancelling login...'));
    try {
      await fetch(`${endpoint}/api/cli/session/deny`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cli_session: cliSession })
      });
    } catch {}
    process.exit(0);
  };
  process.on('SIGINT', cleanup);

  // Step 3: Poll for approval
  let attempts = 0;
  let approved = false;

  while (attempts < MAX_POLL_ATTEMPTS && !approved) {
    attempts++;

    try {
      const statusResponse = await fetch(
        `${endpoint}/api/cli/session/status?s=${cliSession}`
      );

      if (!statusResponse.ok) {
        const error = await statusResponse.text();
        console.log(pc.red(`✗ Error checking status: ${error}`));
        return;
      }

      const status = await statusResponse.json() as {
        status: 'pending' | 'approved' | 'denied' | 'expired';
        access_token?: string;
        session_id?: string;
        user?: { id: string; email: string; plan: string };
        message?: string;
      };

      if (status.status === 'approved') {
        process.removeListener('SIGINT', cleanup);
        process.stdout.write('\n');
        if (status.access_token && status.user) {
          // First poll after approval - we get the token
          approved = true;

          config.cloud = {
            ...config.cloud,
            endpoint,
            token: status.access_token,
            sessionId: status.session_id
          };
          saveConfig(config);

          console.log(pc.green(`✓ Logged in as ${status.user.email}`));
          console.log(pc.dim(`  Plan: ${status.user.plan}`));
          console.log(pc.green('\n✓ Session saved to ~/.puzldai/config.json'));
          console.log(pc.dim('  Run "puzld serve --mcp" to start the bridge.'));
        } else {
          // Token already retrieved (shouldn't happen in normal flow)
          console.log(pc.yellow('⚠ Session approved but token already retrieved.'));
          console.log(pc.dim('  Run "puzld login" again if needed.'));
        }
        return;
      }

      if (status.status === 'denied') {
        process.removeListener('SIGINT', cleanup);
        process.stdout.write('\n');
        console.log(pc.red('✗ Login request was denied.'));
        return;
      }

      if (status.status === 'expired') {
        process.removeListener('SIGINT', cleanup);
        process.stdout.write('\n');
        console.log(pc.red('✗ Login session expired. Please try again.'));
        return;
      }

      // Still pending - show spinner
      const spinner = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
      process.stdout.write(`\r${pc.dim(spinner[attempts % spinner.length])} Waiting for approval...`);

    } catch (err) {
      // Network error - retry
      process.stdout.write(`\r${pc.yellow('⚠')} Connection issue, retrying...`);
    }

    await sleep(POLL_INTERVAL_MS);
  }

  if (!approved) {
    process.removeListener('SIGINT', cleanup);
    process.stdout.write('\n');
    console.log(pc.red('\n✗ Login timed out. Please try again.'));
  }
}

/**
 * Logout from MCP server
 */
export async function logoutCommand(): Promise<void> {
  const config = loadConfig();

  if (!config.cloud?.token) {
    console.log(pc.yellow('Not logged in.'));
    return;
  }

  // TODO: Call server to revoke session if sessionId exists
  // For now, just clear local config

  config.cloud = {
    ...config.cloud,
    token: undefined,
    sessionId: undefined
  };
  saveConfig(config);

  console.log(pc.green('✓ Logged out successfully'));
}

/**
 * Show current login status
 */
export async function whoamiCommand(): Promise<void> {
  const config = getConfig();

  if (!config.cloud?.token) {
    console.log(pc.yellow('Not logged in.'));
    console.log(pc.dim('Run "puzld login" to authenticate.'));
    return;
  }

  const endpoint = config.cloud.endpoint || DEFAULT_ENDPOINT;

  try {
    const response = await fetch(`${endpoint}/auth/me`, {
      headers: getAuthHeaders(config.cloud.token)
    });

    if (response.ok) {
      const data = await response.json() as {
        id: string;
        email: string;
        plan: string;
        usage?: {
          requests: number;
          tokens: number;
          remaining: { requests: number; tokens: number };
          percentUsed: { requests: number; tokens: number };
        };
      };
      console.log(pc.green(`✓ Logged in as ${data.email}`));
      console.log(pc.dim(`  Plan: ${data.plan}`));
      if (data.usage) {
        console.log(pc.dim(`  Usage: ${data.usage.requests} requests, ${data.usage.tokens} tokens`));
        console.log(pc.dim(`  Remaining: ${data.usage.remaining.requests} requests, ${data.usage.remaining.tokens} tokens`));
      }
    } else {
      console.log(pc.yellow('Token expired or invalid. Run "puzld login" again.'));
    }
  } catch {
    console.log(pc.yellow('Could not reach MCP server.'));
  }

  console.log(pc.dim(`\nEndpoint: ${endpoint}`));
  if (config.cloud.machineId) {
    console.log(pc.dim(`Machine ID: ${config.cloud.machineId}`));
  }
}
