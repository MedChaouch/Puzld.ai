import { execa } from 'execa';
import type { Adapter, ModelResponse, RunOptions } from '../lib/types';
import { getConfig } from '../lib/config';

// Extended options for Gemini with approval mode
export interface GeminiRunOptions extends RunOptions {
  /** Gemini CLI approval mode: 'default' (read-only), 'auto_edit', 'yolo' */
  geminiApprovalMode?: 'default' | 'auto_edit' | 'yolo';
}

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

  async run(prompt: string, options?: GeminiRunOptions): Promise<ModelResponse> {
    const config = getConfig();
    const startTime = Date.now();
    const model = options?.model ?? config.adapters.gemini.model;
    const geminiApprovalMode = options?.geminiApprovalMode;

    try {
      // Gemini CLI uses -m for model selection, --output-format json for token usage
      // Note: Gemini CLI auto-reads project context - no reliable way to disable this
      const args: string[] = ['--output-format', 'json'];

      // Add approval mode flag based on option
      if (geminiApprovalMode === 'yolo') {
        args.push('--yolo');
      } else if (geminiApprovalMode === 'auto_edit') {
        args.push('--approval-mode', 'auto_edit');
      }
      // 'default' or undefined = no flag (read-only mode)

      if (model) {
        args.push('-m', model);
      }
      args.push(prompt);

      const { stdout, stderr, exitCode } = await execa(
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

      // Debug logging for compare mode issues
      if (config.logLevel === 'debug') {
        console.log(`[gemini] exitCode=${exitCode} stdout.length=${stdout?.length || 0} stderr.length=${stderr?.length || 0}`);
        if (stderr) console.log(`[gemini] stderr: ${stderr.slice(0, 200)}`);
        if (!stdout) console.log(`[gemini] stdout is empty!`);
      }

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
      } catch (parseErr) {
        // Fallback if JSON parsing fails
        if (config.logLevel === 'debug') {
          console.log(`[gemini] JSON parse failed: ${parseErr}`);
          console.log(`[gemini] Raw stdout: ${stdout?.slice(0, 500)}`);
        }
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
