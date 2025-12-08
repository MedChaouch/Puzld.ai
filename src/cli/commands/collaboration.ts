/**
 * Multi-agent collaboration commands
 *
 * Usage:
 *   puzld correct "task" --producer claude --reviewer gemini
 *   puzld debate "topic" --agents claude,gemini --rounds 2
 *   puzld consensus "task" --agents claude,gemini,ollama
 */

import pc from 'picocolors';
import {
  buildCorrectionPlan,
  buildDebatePlan,
  buildConsensusPlan,
  parseAgentsString,
  execute,
  type AgentName,
  type ExecutionResult
} from '../../executor';

// --- Correction Command ---

export interface CorrectionCliOptions {
  producer: string;
  reviewer: string;
  fix?: boolean;
}

export async function correctionCommand(
  prompt: string,
  options: CorrectionCliOptions
): Promise<void> {
  console.log(pc.bold('\nCross-Agent Correction'));
  console.log(pc.dim(`Producer: ${options.producer}`));
  console.log(pc.dim(`Reviewer: ${options.reviewer}`));
  if (options.fix) {
    console.log(pc.dim('Mode: Review + Fix'));
  }
  console.log();

  const plan = buildCorrectionPlan(prompt, {
    producer: options.producer as AgentName | 'auto',
    reviewer: options.reviewer as AgentName | 'auto',
    fixAfterReview: options.fix
  });

  const startTime = Date.now();

  const result = await execute(plan, {
    onEvent: (event) => {
      const stepNames = ['Production', 'Review', 'Fix'];
      const stepIndex = parseInt(event.stepId.replace('step_', ''), 10);
      const stepName = stepNames[stepIndex] || event.stepId;

      switch (event.type) {
        case 'start':
          console.log(pc.yellow(`  ${stepName}: running...`));
          break;
        case 'complete':
          console.log(pc.green(`  ${stepName}: complete`));
          break;
        case 'error':
          console.log(pc.red(`  ${stepName}: failed - ${event.message}`));
          break;
      }
    }
  });

  console.log();
  displayCorrectionResults(result, options.fix);

  const duration = Date.now() - startTime;
  console.log(pc.dim(`\nTotal time: ${(duration / 1000).toFixed(1)}s`));
}

function displayCorrectionResults(result: ExecutionResult, hasFixStep?: boolean): void {
  const production = result.results.find(r => r.stepId === 'step_0');
  const review = result.results.find(r => r.stepId === 'step_1');
  const fix = hasFixStep ? result.results.find(r => r.stepId === 'step_2') : null;

  console.log(pc.bold('--- Production ---'));
  console.log(production?.content || pc.red('Failed'));
  console.log();

  console.log(pc.bold('--- Review ---'));
  console.log(review?.content || pc.red('Failed'));

  if (fix) {
    console.log();
    console.log(pc.bold('--- Fixed Output ---'));
    console.log(fix.content || pc.red('Failed'));
  }
}

// --- Debate Command ---

export interface DebateCliOptions {
  agents: string;
  rounds: string;
  moderator?: string;
}

export async function debateCommand(
  prompt: string,
  options: DebateCliOptions
): Promise<void> {
  const agents = parseAgentsString(options.agents);
  const rounds = parseInt(options.rounds, 10) || 2;

  if (agents.length < 2) {
    console.error(pc.red('Error: Debate requires at least 2 agents'));
    console.log(pc.dim('Usage: puzld debate "topic" --agents claude,gemini --rounds 2'));
    process.exit(1);
  }

  console.log(pc.bold('\nMulti-Agent Debate'));
  console.log(pc.dim(`Agents: ${agents.join(', ')}`));
  console.log(pc.dim(`Rounds: ${rounds}`));
  if (options.moderator) {
    console.log(pc.dim(`Moderator: ${options.moderator}`));
  }
  console.log();

  const plan = buildDebatePlan(prompt, {
    agents: agents as AgentName[],
    rounds,
    moderator: options.moderator as AgentName | undefined
  });

  const startTime = Date.now();

  const result = await execute(plan, {
    onEvent: (event) => {
      switch (event.type) {
        case 'start':
          console.log(pc.yellow(`  ${event.stepId}: running...`));
          break;
        case 'complete':
          console.log(pc.green(`  ${event.stepId}: complete`));
          break;
        case 'error':
          console.log(pc.red(`  ${event.stepId}: failed`));
          break;
      }
    }
  });

  console.log();
  displayDebateResults(result, agents, rounds, !!options.moderator);

  const duration = Date.now() - startTime;
  console.log(pc.dim(`\nTotal time: ${(duration / 1000).toFixed(1)}s`));
}

function displayDebateResults(
  result: ExecutionResult,
  agents: string[],
  rounds: number,
  hasModerator: boolean
): void {
  for (let round = 0; round < rounds; round++) {
    console.log(pc.bold(`--- Round ${round + 1} ---\n`));

    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i];
      const stepIndex = round * agents.length + i;
      const found = result.results[stepIndex];

      console.log(pc.cyan(`[${agent}]`));
      console.log(found?.content || pc.dim('(no response)'));
      console.log();
    }
  }

  if (hasModerator) {
    const conclusionStep = result.results[result.results.length - 1];
    console.log(pc.bold('--- Conclusion ---'));
    console.log(conclusionStep?.content || pc.dim('(no conclusion)'));
  }
}

// --- Consensus Command ---

export interface ConsensusCliOptions {
  agents: string;
  rounds?: string;
  synthesizer?: string;
}

export async function consensusCommand(
  prompt: string,
  options: ConsensusCliOptions
): Promise<void> {
  const agents = parseAgentsString(options.agents);
  const maxRounds = parseInt(options.rounds || '2', 10);

  if (agents.length < 2) {
    console.error(pc.red('Error: Consensus requires at least 2 agents'));
    console.log(pc.dim('Usage: puzld consensus "task" --agents claude,gemini,ollama'));
    process.exit(1);
  }

  console.log(pc.bold('\nConsensus Building'));
  console.log(pc.dim(`Agents: ${agents.join(', ')}`));
  console.log(pc.dim(`Voting rounds: ${maxRounds}`));
  if (options.synthesizer) {
    console.log(pc.dim(`Synthesizer: ${options.synthesizer}`));
  }
  console.log();

  const plan = buildConsensusPlan(prompt, {
    agents: agents as AgentName[],
    maxRounds,
    synthesizer: options.synthesizer as AgentName | undefined
  });

  const startTime = Date.now();

  const result = await execute(plan, {
    onEvent: (event) => {
      switch (event.type) {
        case 'start':
          console.log(pc.yellow(`  ${event.stepId}: running...`));
          break;
        case 'complete':
          console.log(pc.green(`  ${event.stepId}: complete`));
          break;
        case 'error':
          console.log(pc.red(`  ${event.stepId}: failed`));
          break;
      }
    }
  });

  console.log();

  // Show final consensus
  console.log(pc.bold('--- Consensus Result ---'));
  console.log(result.finalOutput || result.results[result.results.length - 1]?.content || pc.dim('(no consensus)'));

  const duration = Date.now() - startTime;
  console.log(pc.dim(`\nTotal time: ${(duration / 1000).toFixed(1)}s`));
}
