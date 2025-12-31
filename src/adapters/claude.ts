import { execa } from 'execa';
import type { Adapter, ModelResponse, RunOptions } from '../lib/types';
import { getConfig } from '../lib/config';
import { StreamParser, type ResultEvent } from '../lib/stream-parser';
import { extractProposedEdits, type ProposedEdit } from '../lib/edit-review';

/**
 * Result of a dry-run execution (with permission-mode default)
 */
export interface DryRunResult {
  response: ModelResponse;
  proposedEdits: ProposedEdit[];
  resultEvent: ResultEvent | null;
}

export const claudeAdapter: Adapter & {
  dryRun: (prompt: string, options?: RunOptions) => Promise<DryRunResult>;
} = {
  name: 'claude',

  async isAvailable(): Promise<boolean> {
    const config = getConfig();
    if (!config.adapters.claude.enabled) return false;

    try {
      await execa('which', [config.adapters.claude.path]);
      return true;
    } catch {
      return false;
    }
  },

  async run(prompt: string, options?: RunOptions): Promise<ModelResponse> {
    const config = getConfig();
    const startTime = Date.now();
    const model = options?.model ?? config.adapters.claude.model;
    const disableTools = options?.disableTools ?? true; // Default: disable tools

    try {
      // claude -p "prompt" for non-interactive output
      // --output-format stream-json for faster response (requires --verbose)
      // --no-session-persistence to avoid polluting Claude Code's session list
      const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--no-session-persistence'];

      // Disable native tools for agentic mode (LLM returns JSON, we apply files)
      if (disableTools) {
        args.push('--tools', '');
      }

      if (model) {
        args.push('--model', model);
      }

      const { stdout, stderr } = await execa(
        config.adapters.claude.path,
        args,
        {
          timeout: config.timeout,
          cancelSignal: options?.signal,
          reject: false,
          stdin: 'ignore'
        }
      );

      const modelName = model ? `claude/${model}` : 'claude';

      if (stderr && !stdout) {
        return {
          content: '',
          model: modelName,
          duration: Date.now() - startTime,
          error: stderr
        };
      }

      // Parse stream-json response using StreamParser
      try {
        const parser = new StreamParser();

        // Subscribe to tool events if callback provided
        if (options?.onToolEvent) {
          parser.onEvent(options.onToolEvent);
        }

        // Parse all lines (emits events to subscribers)
        parser.parseAll(stdout);

        // Get final result
        const resultEvent = parser.getResult();
        const result: ResultEvent = resultEvent ?? {
          type: 'result',
          subtype: 'success',
          result: '',
          isError: false
        };

        return {
          content: result.result,
          model: modelName,
          duration: Date.now() - startTime,
          tokens: result.usage ? {
            input: result.usage.input_tokens,
            output: result.usage.output_tokens
          } : undefined,
          error: result.isError ? result.result : undefined
        };
      } catch {
        // Fallback if parsing fails
        return {
          content: stdout || '',
          model: modelName,
          duration: Date.now() - startTime
        };
      }
    } catch (err: unknown) {
      const error = err as Error;
      const modelName = model ? `claude/${model}` : 'claude';
      return {
        content: '',
        model: modelName,
        duration: Date.now() - startTime,
        error: error.message
      };
    }
  },

  /**
   * Dry-run mode: Execute with --permission-mode default to capture
   * proposed edits without applying them
   */
  async dryRun(prompt: string, options?: RunOptions): Promise<DryRunResult> {
    const config = getConfig();
    const startTime = Date.now();
    const model = options?.model ?? config.adapters.claude.model;

    try {
      // Use --permission-mode default to capture Write/Edit attempts
      // WITHOUT --tools "" so Claude can actually try to use tools
      // --no-session-persistence to avoid polluting Claude Code's session list
      const args = [
        '-p', prompt,
        '--output-format', 'stream-json',
        '--verbose',
        '--permission-mode', 'default',
        '--no-session-persistence'
      ];
      if (model) {
        args.push('--model', model);
      }

      const { stdout, stderr } = await execa(
        config.adapters.claude.path,
        args,
        {
          timeout: config.timeout,
          cancelSignal: options?.signal,
          reject: false,
          stdin: 'ignore'
        }
      );

      const modelName = model ? `claude/${model}` : 'claude';

      if (stderr && !stdout) {
        return {
          response: {
            content: '',
            model: modelName,
            duration: Date.now() - startTime,
            error: stderr
          },
          proposedEdits: [],
          resultEvent: null
        };
      }

      // Parse stream-json response
      const parser = new StreamParser();

      if (options?.onToolEvent) {
        parser.onEvent(options.onToolEvent);
      }

      parser.parseAll(stdout);

      const resultEvent = parser.getResult();
      const result: ResultEvent = resultEvent ?? {
        type: 'result',
        subtype: 'success',
        result: '',
        isError: false
      };

      // Extract proposed edits from permission denials
      const proposedEdits = extractProposedEdits(result);

      return {
        response: {
          content: result.result,
          model: modelName,
          duration: Date.now() - startTime,
          tokens: result.usage ? {
            input: result.usage.input_tokens,
            output: result.usage.output_tokens
          } : undefined,
          error: result.isError ? result.result : undefined
        },
        proposedEdits,
        resultEvent
      };
    } catch (err: unknown) {
      const error = err as Error;
      const modelName = model ? `claude/${model}` : 'claude';
      return {
        response: {
          content: '',
          model: modelName,
          duration: Date.now() - startTime,
          error: error.message
        },
        proposedEdits: [],
        resultEvent: null
      };
    }
  }
};
