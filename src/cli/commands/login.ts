/**
 * Login Command
 *
 * Handles authentication with MCP server using email.
 *
 * TODO: Replace with proper OAuth/token-based auth later.
 * Currently uses simple email login for MVP.
 */

import pc from 'picocolors';
import { getConfig, loadConfig, saveConfig } from '../../lib/config';
import { createInterface } from 'readline';

interface LoginOptions {
  email?: string;         // Email for login
  endpoint?: string;      // Override MCP endpoint
}

const DEFAULT_ENDPOINT = 'https://puzld-mcp.med-ch-mu.workers.dev';

/**
 * Login to MCP server with email
 */
export async function loginCommand(options: LoginOptions): Promise<void> {
  const config = loadConfig();
  const endpoint = options.endpoint || config.cloud?.endpoint || DEFAULT_ENDPOINT;

  console.log(pc.bold('\nPuzldAI MCP Login\n'));

  let email = options.email;

  // If no email provided, prompt for it
  if (!email) {
    email = await prompt('Enter your email: ');

    if (!email) {
      console.log(pc.red('No email provided. Aborting.'));
      return;
    }
  }

  // Login with MCP server
  console.log(pc.dim('Logging in...'));

  try {
    const response = await fetch(`${endpoint}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email })
    });

    if (!response.ok) {
      const error = await response.text();
      console.log(pc.red(`✗ Login failed: ${error}`));
      return;
    }

    const data = await response.json() as {
      token: string;
      user: { id: string; email: string; plan: string }
    };

    console.log(pc.green(`✓ Logged in as ${data.user.email}`));
    console.log(pc.dim(`  Plan: ${data.user.plan}`));

    // Save token to config
    config.cloud = {
      ...config.cloud,
      endpoint,
      token: data.token
    };
    saveConfig(config);

    console.log(pc.green('\n✓ Token saved to ~/.puzldai/config.json'));
    console.log(pc.dim('  Run "puzld serve --mcp" to start the bridge.'));

  } catch (err) {
    console.log(pc.red(`✗ Could not connect to MCP server at ${endpoint}`));
    console.log(pc.dim(`  Error: ${err instanceof Error ? err.message : 'Unknown error'}`));
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

  // Clear token
  config.cloud = {
    ...config.cloud,
    token: undefined
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
      headers: {
        'Authorization': `Bearer ${config.cloud.token}`
      }
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

/**
 * Simple prompt helper
 */
function prompt(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}
