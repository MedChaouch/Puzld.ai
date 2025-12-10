import { execSync } from 'child_process';

export interface AgentModels {
  aliases: string[];
  models: string[];
}

export const KNOWN_MODELS: Record<string, AgentModels> = {
  claude: {
    aliases: ['sonnet', 'opus', 'haiku'],
    models: [
      'claude-sonnet-4-20250514',
      'claude-sonnet-4-5-20250929',
      'claude-opus-4-20250514',
      'claude-opus-4-5-20251101',
      'claude-haiku-4-5',
      'claude-3-opus-20240229'
      // 'claude-sonnet-3-5-20241022',
      // 'claude-3-5-sonnet-20241022',
      // 'claude-3-sonnet-20240229',
      // 'claude-3-5-haiku-20241022'
    ]
  },
  gemini: {
    aliases: ['auto', 'pro', 'flash', 'flash-lite'],
    models: [
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      'gemini-3-pro-preview'
    ]
  },
  codex: {
    aliases: [],
    models: [
      'gpt-5.1-codex-max',
      'gpt-5.1-codex',
      'gpt-5.1-codex-mini',
      'gpt-5.1'
    ]
  },
  ollama: {
    aliases: [],
    models: []  // Dynamically populated via `ollama list`
  },
  mistral: {
    aliases: ['devstral-2', 'devstral-small', 'local'],
    models: [
      'mistral-vibe-cli-latest',
      'devstral-small-latest'
    ]
  }
};

// Dynamically load Ollama models
export function loadOllamaModels(): string[] {
  try {
    const output = execSync('ollama list', { encoding: 'utf-8', timeout: 5000 });
    return output
      .split('\n')
      .slice(1)  // Skip header
      .map(line => line.split(/\s+/)[0])
      .filter(Boolean);
  } catch {
    return [];
  }
}

// Get all known models and aliases for an agent
export function getAgentModelOptions(agent: string): string[] {
  const agentModels = KNOWN_MODELS[agent];
  if (!agentModels) return [];

  // For ollama, load dynamically
  if (agent === 'ollama') {
    return loadOllamaModels();
  }

  return [...agentModels.aliases, ...agentModels.models];
}

// Check if a model is a known alias
export function isModelAlias(agent: string, model: string): boolean {
  const agentModels = KNOWN_MODELS[agent];
  if (!agentModels) return false;
  return agentModels.aliases.includes(model);
}

// Get all suggestions for autocomplete (aliases first, then full names)
export function getModelSuggestions(agent: string): string[] {
  const agentModels = KNOWN_MODELS[agent];
  if (!agentModels) return [];

  // For ollama, load dynamically
  if (agent === 'ollama') {
    return loadOllamaModels();
  }

  return [...agentModels.aliases, ...agentModels.models];
}
