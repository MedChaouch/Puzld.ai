import type { Adapter } from '../lib/types';
import { claudeAdapter } from './claude';
import { geminiAdapter } from './gemini';
import { codexAdapter } from './codex';
import { ollamaAdapter } from './ollama';
import { mistralAdapter } from './mistral';

export const adapters: Record<string, Adapter> = {
  claude: claudeAdapter,
  gemini: geminiAdapter,
  codex: codexAdapter,
  ollama: ollamaAdapter,
  mistral: mistralAdapter
};

export async function getAvailableAdapters(): Promise<Adapter[]> {
  const available: Adapter[] = [];
  for (const adapter of Object.values(adapters)) {
    if (await adapter.isAvailable()) {
      available.push(adapter);
    }
  }
  return available;
}

export { claudeAdapter, geminiAdapter, codexAdapter, ollamaAdapter, mistralAdapter };
