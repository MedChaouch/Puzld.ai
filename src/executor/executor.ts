/**
 * Universal plan executor
 *
 * Executes any ExecutionPlan regardless of mode (single, compare, pipeline, auto)
 */

import type {
  ExecutionPlan,
  ExecutionResult,
  ExecutorConfig,
  PlanStep,
  StepResult,
  StepStatus,
  TimelineEvent,
  AgentName
} from './types';
import {
  createContext,
  addStepResult,
  injectVariables,
  evaluateCondition,
  dependenciesSatisfied,
  anyDependencyFailed,
  type ExecutionContext
} from './context';
import { adapters } from '../adapters';
import { routeTask, isRouterAvailable } from '../router/router';
import { getConfig } from '../lib/config';

const DEFAULT_TIMEOUT = 120000;
const DEFAULT_MAX_CONCURRENCY = 3;

/**
 * Execute a plan and return results
 */
export async function execute(
  plan: ExecutionPlan,
  config: ExecutorConfig = {}
): Promise<ExecutionResult> {
  const startTime = Date.now();
  const timeline: TimelineEvent[] = [];
  const results: StepResult[] = [];

  let ctx = createContext(plan.prompt, plan.context);

  const emit = (event: Omit<TimelineEvent, 'timestamp'>) => {
    const fullEvent = { ...event, timestamp: Date.now() };
    timeline.push(fullEvent);
    config.onEvent?.(fullEvent);
  };

  // Track step status
  const stepStatus: Map<string, StepStatus> = new Map();
  plan.steps.forEach(step => stepStatus.set(step.id, 'pending'));

  // Execute based on mode
  try {
    if (config.signal?.aborted) {
      throw new Error('Aborted');
    }

    if (plan.mode === 'compare' && !hasSequentialDependencies(plan.steps)) {
      // Parallel execution for compare mode without dependencies
      await executeParallel(plan.steps, ctx, config, emit, results, stepStatus);
    } else {
      // Sequential/dependency-based execution
      await executeWithDependencies(plan.steps, ctx, config, emit, results, stepStatus);
    }

    // Update context with all results
    for (const result of results) {
      const step = plan.steps.find(s => s.id === result.stepId);
      ctx = addStepResult(ctx, result, step?.outputAs);
    }

    // Determine final status
    const hasFailures = results.some(r => r.status === 'failed');
    const hasSuccess = results.some(r => r.status === 'completed');
    const status = hasFailures
      ? (hasSuccess ? 'partial' : 'failed')
      : 'completed';

    return {
      planId: plan.id,
      status,
      results,
      timeline,
      finalOutput: getFinalOutput(results, plan),
      duration: Date.now() - startTime
    };
  } catch (err) {
    const error = err as Error;

    if (error.message === 'Aborted') {
      return {
        planId: plan.id,
        status: 'cancelled',
        results,
        timeline,
        duration: Date.now() - startTime
      };
    }

    emit({ stepId: 'plan', type: 'error', message: error.message });

    return {
      planId: plan.id,
      status: 'failed',
      results,
      timeline,
      duration: Date.now() - startTime
    };
  }
}

/**
 * Check if steps have sequential dependencies
 */
function hasSequentialDependencies(steps: PlanStep[]): boolean {
  return steps.some(step => step.dependsOn && step.dependsOn.length > 0);
}

/**
 * Execute steps in parallel (for compare mode)
 */
async function executeParallel(
  steps: PlanStep[],
  ctx: ExecutionContext,
  config: ExecutorConfig,
  emit: (event: Omit<TimelineEvent, 'timestamp'>) => void,
  results: StepResult[],
  stepStatus: Map<string, StepStatus>
): Promise<void> {
  const maxConcurrency = config.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;

  // Batch steps by concurrency limit
  for (let i = 0; i < steps.length; i += maxConcurrency) {
    const batch = steps.slice(i, i + maxConcurrency);

    // Use allSettled to preserve results from successful steps even if some fail
    const batchResults = await Promise.allSettled(
      batch.map((step, batchIdx) => executeStep(step, i + batchIdx, ctx, config, emit, stepStatus))
    );

    // Extract results, converting rejections to error results
    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j];
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        // Create error result for failed step
        const step = batch[j];
        results.push({
          stepId: step.id,
          status: 'failed',
          error: result.reason instanceof Error ? result.reason.message : String(result.reason)
        });
      }
    }

    // Check for abort
    if (config.signal?.aborted) {
      throw new Error('Aborted');
    }
  }
}

/**
 * Execute steps respecting dependencies
 */
async function executeWithDependencies(
  steps: PlanStep[],
  ctx: ExecutionContext,
  config: ExecutorConfig,
  emit: (event: Omit<TimelineEvent, 'timestamp'>) => void,
  results: StepResult[],
  stepStatus: Map<string, StepStatus>
): Promise<void> {
  const pending = new Set(steps.map(s => s.id));

  while (pending.size > 0) {
    // Find steps ready to execute
    const ready = steps.filter(step => {
      if (!pending.has(step.id)) return false;
      if (stepStatus.get(step.id) !== 'pending') return false;

      // Check if dependencies are satisfied
      return dependenciesSatisfied(step.dependsOn, ctx);
    });

    if (ready.length === 0) {
      // No steps ready - check if we're stuck
      const stillPending = steps.filter(s => pending.has(s.id));
      const allFailed = stillPending.every(s =>
        anyDependencyFailed(s.dependsOn, ctx)
      );

      if (allFailed) {
        // Mark remaining as skipped
        for (const step of stillPending) {
          const result: StepResult = {
            stepId: step.id,
            status: 'skipped',
            error: 'Dependency failed'
          };
          results.push(result);
          ctx = addStepResult(ctx, result, step.outputAs);
          pending.delete(step.id);
          emit({ stepId: step.id, type: 'skip', message: 'Dependency failed' });
        }
        break;
      }

      // Wait for running steps
      await new Promise(resolve => setTimeout(resolve, 50));
      continue;
    }

    // Execute ready steps (up to concurrency limit)
    const maxConcurrency = config.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
    const toExecute = ready.slice(0, maxConcurrency);

    // Use allSettled to preserve results from successful steps even if some fail
    const batchResults = await Promise.allSettled(
      toExecute.map(async step => {
        const stepIndex = steps.indexOf(step);
        stepStatus.set(step.id, 'running');
        const result = await executeStep(step, stepIndex, ctx, config, emit, stepStatus);
        pending.delete(step.id);
        return { step, result };
      })
    );

    // Update context with results, handling failures gracefully
    for (let j = 0; j < batchResults.length; j++) {
      const batchResult = batchResults[j];
      const step = toExecute[j];

      if (batchResult.status === 'fulfilled') {
        const { result } = batchResult.value;
        results.push(result);
        ctx = addStepResult(ctx, result, step.outputAs);
      } else {
        // Create error result for failed step
        pending.delete(step.id);
        const errorResult: StepResult = {
          stepId: step.id,
          status: 'failed',
          error: batchResult.reason instanceof Error ? batchResult.reason.message : String(batchResult.reason)
        };
        results.push(errorResult);
        ctx = addStepResult(ctx, errorResult, step.outputAs);
      }
    }

    // Check for abort
    if (config.signal?.aborted) {
      throw new Error('Aborted');
    }
  }
}

/**
 * Execute a single step
 */
async function executeStep(
  step: PlanStep,
  stepIndex: number,
  ctx: ExecutionContext,
  config: ExecutorConfig,
  emit: (event: Omit<TimelineEvent, 'timestamp'>) => void,
  stepStatus: Map<string, StepStatus>
): Promise<StepResult> {
  const startTime = Date.now();

  // Check condition
  if (step.condition && !evaluateCondition(step.condition, ctx)) {
    stepStatus.set(step.id, 'skipped');
    emit({ stepId: step.id, type: 'skip', message: 'Condition not met' });
    return {
      stepId: step.id,
      status: 'skipped',
      duration: 0
    };
  }

  // Inject variables into prompt before showing confirmation
  const injectedPrompt = injectVariables(step.prompt, ctx);
  step = { ...step, prompt: injectedPrompt };

  // Interactive confirmation before step
  if (config.onBeforeStep) {
    const previousResults = Object.values(ctx.steps);
    const result = await config.onBeforeStep(step, stepIndex, previousResults);

    // Handle both boolean and object return types
    const proceed = typeof result === 'boolean' ? result : result.proceed;
    const editedPrompt = typeof result === 'object' ? result.editedPrompt : undefined;

    if (!proceed) {
      stepStatus.set(step.id, 'skipped');
      emit({ stepId: step.id, type: 'skip', message: 'Skipped by user' });
      return {
        stepId: step.id,
        status: 'skipped',
        duration: 0
      };
    }

    // Apply edited prompt if provided
    if (editedPrompt) {
      step = { ...step, prompt: editedPrompt };
    }
  }

  emit({ stepId: step.id, type: 'start' });
  stepStatus.set(step.id, 'running');

  const maxRetries = step.retries ?? config.defaultRetries ?? 0;
  let lastError: string | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      emit({ stepId: step.id, type: 'retry', message: `Attempt ${attempt + 1}` });
    }

    try {
      const result = await executeStepOnce(step, ctx, config, emit);

      if (result.status === 'completed') {
        const duration = Date.now() - startTime;
        stepStatus.set(step.id, 'completed');
        emit({ stepId: step.id, type: 'complete', data: { content: result.content, model: result.model, duration } });
        return {
          ...result,
          duration
        };
      }

      lastError = result.error;
    } catch (err) {
      lastError = (err as Error).message;
    }

    // Try fallback on last attempt
    if (attempt === maxRetries && step.fallback) {
      try {
        // Prompt is already injected, use it directly
        const fallbackResult = await runAdapter(
          step.fallback,
          step.prompt,
          config,
          step.id
        );

        if (!fallbackResult.error) {
          const duration = Date.now() - startTime;
          stepStatus.set(step.id, 'completed');
          emit({ stepId: step.id, type: 'complete', message: 'Used fallback: ' + step.fallback, data: { content: fallbackResult.content, model: fallbackResult.model, duration } });
          return {
            stepId: step.id,
            status: 'completed',
            content: fallbackResult.content,
            model: fallbackResult.model,
            duration
          };
        }
      } catch {
        // Fallback also failed
      }
    }
  }

  stepStatus.set(step.id, 'failed');
  emit({ stepId: step.id, type: 'error', message: lastError });

  return {
    stepId: step.id,
    status: 'failed',
    error: lastError,
    duration: Date.now() - startTime
  };
}

/**
 * Execute a step once (no retries)
 */
async function executeStepOnce(
  step: PlanStep,
  ctx: ExecutionContext,
  config: ExecutorConfig,
  _emit: (event: Omit<TimelineEvent, 'timestamp'>) => void
): Promise<StepResult> {
  // Prompt is already injected before onBeforeStep, use it directly
  const prompt = step.prompt;

  // Resolve agent (auto-route if needed)
  let agent = step.agent;
  if (agent === 'auto') {
    if (await isRouterAvailable()) {
      const route = await routeTask(prompt);
      agent = route.agent as AgentName;
    } else {
      const cfg = getConfig();
      agent = cfg.fallbackAgent as AgentName;
    }
  }

  const result = await runAdapter(agent, prompt, config, step.id);

  return {
    stepId: step.id,
    status: result.error ? 'failed' : 'completed',
    content: result.content,
    error: result.error,
    model: result.model
  };
}

/**
 * Run an adapter with timeout and streaming
 */
async function runAdapter(
  agent: AgentName,
  prompt: string,
  config: ExecutorConfig,
  stepId: string
): Promise<{ content: string; model: string; error?: string }> {
  const adapter = adapters[agent];

  if (!adapter) {
    return { content: '', model: agent, error: `Unknown agent: ${agent}` };
  }

  if (!(await adapter.isAvailable())) {
    return { content: '', model: agent, error: `Agent ${agent} not available` };
  }

  const timeout = config.defaultTimeout ?? DEFAULT_TIMEOUT;

  // Create timeout promise
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Timeout')), timeout);
  });

  try {
    const result = await Promise.race([
      adapter.run(prompt, {
        signal: config.signal,
        onChunk: config.onChunk
          ? (chunk: string) => config.onChunk?.(stepId, chunk)
          : undefined
      }),
      timeoutPromise
    ]);

    return {
      content: result.content,
      model: result.model,
      error: result.error
    };
  } catch (err) {
    return {
      content: '',
      model: agent,
      error: (err as Error).message
    };
  }
}

/**
 * Get final output from results
 */
function getFinalOutput(results: StepResult[], plan: ExecutionPlan): string | undefined {
  // For single mode, return the only result
  if (plan.mode === 'single' && results.length === 1) {
    return results[0].content;
  }

  // For compare mode with pick, find step with outputAs='selected'
  const selectStep = plan.steps.find(s => s.outputAs === 'selected');
  if (selectStep) {
    const selected = results.find(r => r.stepId === selectStep.id);
    if (selected?.content) {
      return selected.content;
    }
  }

  // For pipeline, return last step's content
  if (plan.mode === 'pipeline' && results.length > 0) {
    const lastStep = plan.steps[plan.steps.length - 1];
    const lastResult = results.find(r => r.stepId === lastStep.id);
    return lastResult?.content;
  }

  // Default: return last completed result
  const completed = results.filter(r => r.status === 'completed');
  return completed[completed.length - 1]?.content;
}
