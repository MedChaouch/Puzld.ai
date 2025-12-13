import { execa } from 'execa';
import type { Adapter, ModelResponse, RunOptions } from '../lib/types';
import { getConfig } from '../lib/config';

export const mistralAdapter: Adapter = {
  name: 'mistral',

  async isAvailable(): Promise<boolean> {
    const config = getConfig();
    if (!config.adapters.mistral?.enabled) return false;

    try {
      await execa('which', [config.adapters.mistral.path || 'vibe']);
      return true;
    } catch {
      return false;
    }
  },

  async run(prompt: string, options?: RunOptions): Promise<ModelResponse> {
    const config = getConfig();
    const startTime = Date.now();
    const model = options?.model ?? config.adapters.mistral?.model;
    const disableTools = options?.disableTools ?? true; // Default: disable native tools

    try {
      // vibe -p "prompt" for programmatic mode
      // --output streaming for fastest response (newline-delimited JSON)
      // Note: vibe doesn't have a CLI flag for model selection - it uses active_model in config
      const args = ['-p', prompt, '--output', 'streaming'];

      // Disable native tools for agentic mode (LLM uses our tool system instead)
      // --enabled-tools with non-existent tool disables all tools in -p mode
      if (disableTools) {
        args.push('--enabled-tools', 'none');
      } else {
        args.push('--auto-approve'); // Only auto-approve if tools are enabled
      }

      const { stdout, stderr } = await execa(
        config.adapters.mistral?.path || 'vibe',
        args,
        {
          timeout: config.timeout,
          cancelSignal: options?.signal,
          reject: false,
          stdin: 'ignore'
        }
      );

      const modelName = model ? `mistral/${model}` : 'mistral';

      if (stderr && !stdout) {
        return {
          content: '',
          model: modelName,
          duration: Date.now() - startTime,
          error: stderr
        };
      }

      // Parse streaming JSON response (newline-delimited JSON)
      try {
        // Split by newlines and parse each line
        const lines = stdout.trim().split('\n');
        let content = '';
        let inputTokens = 0;
        let outputTokens = 0;

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.role === 'assistant' && msg.content) {
              content = msg.content;
            }
            // Look for usage info
            if (msg.usage) {
              inputTokens += msg.usage.prompt_tokens || msg.usage.input_tokens || 0;
              outputTokens += msg.usage.completion_tokens || msg.usage.output_tokens || 0;
            }
          } catch {
            // Skip malformed lines
          }
        }

        return {
          content,
          model: modelName,
          duration: Date.now() - startTime,
          tokens: (inputTokens || outputTokens) ? {
            input: inputTokens,
            output: outputTokens
          } : undefined
        };
      } catch {
        // Fallback if parsing fails - return raw output
        return {
          content: stdout || '',
          model: modelName,
          duration: Date.now() - startTime
        };
      }
    } catch (err: unknown) {
      const error = err as Error;
      const modelName = model ? `mistral/${model}` : 'mistral';
      return {
        content: '',
        model: modelName,
        duration: Date.now() - startTime,
        error: error.message
      };
    }
  }
};
