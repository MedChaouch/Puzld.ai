import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface PulzdConfig {
  defaultAgent: 'auto' | 'claude' | 'gemini' | 'codex' | 'ollama' | 'mistral';
  routerModel: string;
  timeout: number;
  fallbackAgent: string;
  confidenceThreshold: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  adapters: {
    claude: { enabled: boolean; path: string; model?: string };
    gemini: { enabled: boolean; path: string; model?: string };
    codex: { enabled: boolean; path: string; model?: string };
    ollama: { enabled: boolean; model: string; host: string; maxTokens?: number };
    mistral?: { enabled: boolean; path: string; model?: string };
  };
  api: { port: number; host: string };
  ttyd: { port: number; enabled: boolean };
}

const CONFIG_DIR = join(homedir(), '.puzldai');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
const OLD_CONFIG_DIR = join(homedir(), '.pulzdai');
const OLD_CONFIG_PATH = join(OLD_CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG: PulzdConfig = {
  defaultAgent: 'auto',
  routerModel: 'llama3.2',
  timeout: 120000,
  fallbackAgent: 'claude',
  confidenceThreshold: 0.6,
  logLevel: 'info',
  adapters: {
    claude: { enabled: true, path: 'claude' },
    gemini: { enabled: true, path: 'gemini' },
    codex: { enabled: false, path: 'codex' },
    ollama: { enabled: true, model: 'llama3.2', host: 'http://localhost:11434' },
    mistral: { enabled: true, path: 'vibe' }
  },
  api: { port: 3000, host: '0.0.0.0' },
  ttyd: { port: 3001, enabled: true }
};

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}

export function loadConfig(): PulzdConfig {
  // Migrate from old config path if new one doesn't exist
  if (!existsSync(CONFIG_PATH) && existsSync(OLD_CONFIG_PATH)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
    const oldConfig = readFileSync(OLD_CONFIG_PATH, 'utf-8');
    writeFileSync(CONFIG_PATH, oldConfig);
    console.log('Migrated config from ~/.pulzdai to ~/.puzldai');
  }

  if (!existsSync(CONFIG_PATH)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return DEFAULT_CONFIG;
  }

  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    console.warn('Invalid config file, using defaults');
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(config: PulzdConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

let configInstance: PulzdConfig | null = null;

export function getConfig(): PulzdConfig {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}
