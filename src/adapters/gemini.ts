import { execa } from 'execa';
import type { Adapter, ModelResponse, RunOptions } from '../lib/types';
import { getConfig } from '../lib/config';

export const geminiAdapter: Adapter = {
  name: 'gemini',

  async isAvailable(): Promise<boolean> {
    const config = getConfig();
    if (!config.adapters.gemini.enabled) return false;

    try {
      await execa('which', [config.adapters.gemini.path]);
      return true;
    } catch {
      return false;
    }
  },

  async run(prompt: string, options?: RunOptions): Promise<ModelResponse> {
    const config = getConfig();
    const startTime = Date.now();
    const model = options?.model ?? config.adapters.gemini.model;

    try {
      // Gemini CLI uses -m for model selection, --output-format json for token usage
      // Note: Gemini CLI auto-reads project context - no reliable way to disable this
      // The --sandbox flag causes broken responses, so we accept Gemini's native behavior
      const args: string[] = ['--output-format', 'json'];

      if (model) {
        args.push('-m', model);
      }
      args.push(prompt);

      const { stdout, stderr } = await execa(
        config.adapters.gemini.path,
        args,
        {
          timeout: config.timeout,
          cancelSignal: options?.signal,
          reject: false,
          stdin: 'ignore'
        }
      );

      const modelName = model ? `gemini/${model}` : 'gemini';

      if (stderr && !stdout) {
        return {
          content: '',
          model: modelName,
          duration: Date.now() - startTime,
          error: stderr
        };
      }

      // Parse JSON response to extract content and tokens
      try {
        const json = JSON.parse(stdout);

        // Sum tokens from all models used
        let inputTokens = 0;
        let outputTokens = 0;
        if (json.stats?.models) {
          for (const modelStats of Object.values(json.stats.models) as Array<{ tokens?: { prompt?: number; candidates?: number } }>) {
            inputTokens += modelStats.tokens?.prompt || 0;
            outputTokens += modelStats.tokens?.candidates || 0;
          }
        }

        return {
          content: json.response || '',
          model: modelName,
          duration: Date.now() - startTime,
          tokens: (inputTokens || outputTokens) ? {
            input: inputTokens,
            output: outputTokens
          } : undefined
        };
      } catch {
        // Fallback if JSON parsing fails
        return {
          content: stdout || '',
          model: modelName,
          duration: Date.now() - startTime
        };
      }
    } catch (err: unknown) {
      const error = err as Error;
      const modelName = model ? `gemini/${model}` : 'gemini';
      return {
        content: '',
        model: modelName,
        duration: Date.now() - startTime,
        error: error.message
      };
    }
  }
};
