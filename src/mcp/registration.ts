/**
 * MCP Registration Service
 *
 * Handles Core registration with MCP server and heartbeat.
 */

import { getConfig } from '../lib/config';
import type {
  RegisterRequest,
  RegisterResponse,
  CoreCapabilities
} from './types';

let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Register this Core instance with MCP server
 */
export async function registerWithMCP(
  machineId: string,
  capabilities: CoreCapabilities
): Promise<RegisterResponse> {
  const config = getConfig();
  const endpoint = config.cloud?.endpoint || 'https://puzld-mcp.med-ch-mu.workers.dev';
  const token = config.cloud?.token;

  if (!token) {
    throw new Error('No MCP token. Run "puzld login" first.');
  }

  const request: RegisterRequest = {
    machineId,
    capabilities
  };

  const response = await fetch(`${endpoint}/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(request)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Registration failed: ${response.status} - ${error}`);
  }

  return await response.json() as RegisterResponse;
}

/**
 * Send heartbeat to MCP server
 */
export async function sendHeartbeat(machineId: string): Promise<boolean> {
  const config = getConfig();
  const endpoint = config.cloud?.endpoint || 'https://puzld-mcp.med-ch-mu.workers.dev';
  const token = config.cloud?.token;

  if (!token) {
    return false;
  }

  try {
    const response = await fetch(`${endpoint}/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ machineId })
    });

    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Start heartbeat interval
 */
export function startHeartbeat(machineId: string, intervalMs = 30000): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }

  heartbeatInterval = setInterval(async () => {
    const success = await sendHeartbeat(machineId);
    if (!success) {
      console.warn('MCP heartbeat failed');
    }
  }, intervalMs);
}

/**
 * Stop heartbeat interval
 */
export function stopHeartbeat(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

/**
 * Unregister from MCP server
 */
export async function unregisterFromMCP(machineId: string): Promise<boolean> {
  const config = getConfig();
  const endpoint = config.cloud?.endpoint || 'https://puzld-mcp.med-ch-mu.workers.dev';
  const token = config.cloud?.token;

  if (!token) {
    return false;
  }

  try {
    const response = await fetch(`${endpoint}/unregister`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ machineId })
    });

    return response.ok;
  } catch {
    return false;
  }
}
