/**
 * Plan builders for different execution modes
 *
 * Each builder creates an ExecutionPlan from user input
 */

import type {
  AgentName,
  ExecutionPlan,
  PlanStep,
  CompareOptions,
  PipelineOptions,
  PipelineStep,
  CorrectionOptions,
  DebateOptions,
  ConsensusOptions
} from './types';

function generatePlanId(): string {
  return `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function generateStepId(index: number): string {
  return `step_${index}`;
}

/**
 * Build a single-agent plan
 *
 * Usage: ai run "task" [--agent claude]
 */
export function buildSingleAgentPlan(
  prompt: string,
  agent: AgentName | 'auto' = 'auto'
): ExecutionPlan {
  return {
    id: generatePlanId(),
    mode: 'single',
    prompt,
    steps: [
      {
        id: generateStepId(0),
        agent,
        action: 'prompt',
        prompt: '{{prompt}}',
        outputAs: 'result'
      }
    ],
    createdAt: Date.now()
  };
}

/**
 * Build a compare plan (parallel or sequential)
 *
 * Usage: ai compare "task" --agents claude,gemini,ollama
 */
export function buildComparePlan(
  prompt: string,
  options: CompareOptions
): ExecutionPlan {
  const { agents, models, sequential = false, pick = false, projectStructure } = options;

  // Build context with project structure if provided
  const context: Record<string, unknown> = {};
  if (projectStructure) {
    context.project_structure = projectStructure;
  }

  const steps: PlanStep[] = agents.map((agent, i) => ({
    id: generateStepId(i),
    agent,
    model: models?.[i],  // Map model by index if provided
    action: 'prompt' as const,
    prompt: projectStructure
      ? `**Task:** {{prompt}}

**Project Structure:**
{{project_structure}}

CRITICAL INSTRUCTIONS:
- You HAVE access to the project structure above - USE IT
- Do NOT say "I don't have access to tools" or "I cannot read files"
- Do NOT apologize for limitations - you have all the context you need
- Give a concrete, actionable response referencing specific files/directories
- Act as if you can see and understand the entire project`
      : '{{prompt}}',
    outputAs: `response_${agent}`,
    // Sequential mode: each step depends on previous
    dependsOn: sequential && i > 0 ? [generateStepId(i - 1)] : undefined
  }));

  // Add a combine step if pick mode
  if (pick) {
    steps.push({
      id: generateStepId(agents.length),
      agent: 'auto',
      action: 'combine',
      prompt: buildPickPrompt(agents),
      dependsOn: agents.map((_, i) => generateStepId(i)),
      outputAs: 'selected'
    });
  }

  return {
    id: generatePlanId(),
    mode: 'compare',
    prompt,
    steps,
    context: Object.keys(context).length > 0 ? context : undefined,
    createdAt: Date.now()
  };
}

function buildPickPrompt(agents: AgentName[]): string {
  const refs = agents.map(a => `**${a}:**\n{{response_${a}}}`).join('\n\n');
  return `Compare these responses and select the best one. Explain why briefly, then output ONLY the selected response.

${refs}

Selected response:`;
}

/**
 * Build a pipeline plan (sequential with dependencies)
 *
 * Usage: ai run "task" --pipeline "gemini:analyze,claude:code,ollama:review"
 */
export function buildPipelinePlan(
  prompt: string,
  options: PipelineOptions
): ExecutionPlan {
  const steps: PlanStep[] = options.steps.map((step, i) => ({
    id: generateStepId(i),
    agent: step.agent,
    action: 'prompt',
    prompt: buildPipelineStepPrompt(step, i),
    dependsOn: i > 0 ? [generateStepId(i - 1)] : undefined,
    outputAs: `step${i}_output`
  }));

  return {
    id: generatePlanId(),
    mode: 'pipeline',
    prompt,
    steps,
    createdAt: Date.now()
  };
}

function buildPipelineStepPrompt(step: PipelineStep, index: number): string {
  if (step.promptTemplate) {
    return step.promptTemplate;
  }

  const prevRef = index > 0 ? `\n\nPrevious step output:\n{{step${index - 1}_output}}` : '';

  switch (step.action) {
    case 'analyze':
      return `Analyze the following task and provide insights:

{{prompt}}${prevRef}`;

    case 'code':
      return `Write code for the following task:

{{prompt}}${prevRef}`;

    case 'review':
      return `Review the following and suggest improvements:

{{prompt}}${prevRef}`;

    case 'fix':
      return `Fix any issues in the following:

{{prompt}}${prevRef}`;

    case 'test':
      return `Write tests for the following:

{{prompt}}${prevRef}`;

    case 'summarize':
      return `Summarize the following concisely:

{{prompt}}${prevRef}`;

    default:
      return `${step.action}:

{{prompt}}${prevRef}`;
  }
}

/**
 * Parse pipeline string into PipelineOptions
 *
 * Format: "agent:action,agent:action,..."
 * Example: "gemini:analyze,claude:code,ollama:review"
 */
export function parsePipelineString(pipeline: string): PipelineOptions {
  const steps: PipelineStep[] = pipeline.split(',').map(part => {
    const [agentStr, action = 'prompt'] = part.trim().split(':');
    const agent = agentStr.trim() as AgentName | 'auto';
    return { agent, action: action.trim() };
  });

  return { steps };
}

/**
 * Parse compare agents string
 *
 * Format: "agent1,agent2,agent3"
 * Example: "claude,gemini,ollama"
 */
export function parseAgentsString(agents: string): AgentName[] {
  return agents.split(',').map(a => a.trim() as AgentName);
}

// --- Multi-Agent Collaboration Plan Builders ---

/**
 * Build a correction plan (producer → reviewer → optional fix)
 *
 * Usage: ai correct "task" --producer claude --reviewer gemini
 */
export function buildCorrectionPlan(
  prompt: string,
  options: CorrectionOptions
): ExecutionPlan {
  const { producer, reviewer, fixAfterReview = false } = options;

  const steps: PlanStep[] = [
    // Step 0: Producer generates initial output
    {
      id: generateStepId(0),
      agent: producer,
      action: 'prompt',
      prompt: '{{prompt}}',
      outputAs: 'production'
    },
    // Step 1: Reviewer critiques the output
    {
      id: generateStepId(1),
      agent: reviewer,
      action: 'prompt',
      prompt: `Review and critique this output. Identify issues, suggest improvements, and rate quality (1-10).

**Original task:** {{prompt}}

**Output to review:**
{{production}}

Provide specific, actionable feedback.`,
      dependsOn: [generateStepId(0)],
      outputAs: 'review'
    }
  ];

  // Optional Step 2: Producer fixes based on review
  if (fixAfterReview) {
    steps.push({
      id: generateStepId(2),
      agent: producer,
      action: 'prompt',
      prompt: `Fix the issues identified in this review.

**Original task:** {{prompt}}

**Your previous output:**
{{production}}

**Review feedback:**
{{review}}

Provide an improved version addressing all feedback.`,
      dependsOn: [generateStepId(1)],
      outputAs: 'fixed'
    });
  }

  return {
    id: generatePlanId(),
    mode: 'correction',
    prompt,
    steps,
    createdAt: Date.now()
  };
}

/**
 * Build a debate plan (multi-round agent discussion)
 *
 * Usage: ai debate "topic" --agents claude,gemini --rounds 2
 */
export function buildDebatePlan(
  prompt: string,
  options: DebateOptions
): ExecutionPlan {
  const { agents, rounds, moderator } = options;

  if (agents.length < 2) {
    throw new Error('Debate requires at least 2 agents');
  }

  const steps: PlanStep[] = [];
  let stepIndex = 0;

  // Round 0: Initial positions (parallel)
  for (const agent of agents) {
    steps.push({
      id: generateStepId(stepIndex),
      agent,
      action: 'prompt',
      prompt: `You are participating in a debate. Present your initial position on this topic.

**Topic:** {{prompt}}

Be clear, concise, and well-reasoned.`,
      outputAs: `${agent}_round0`
    });
    stepIndex++;
  }

  // Subsequent rounds: Agents respond to each other
  for (let round = 1; round < rounds; round++) {
    const prevRound = round - 1;
    const prevResponses = agents
      .map(a => `**${a}:** {{${a}_round${prevRound}}}`)
      .join('\n\n');

    // Track where previous round started for dependencies
    const prevRoundStart = stepIndex - agents.length;

    for (const agent of agents) {
      steps.push({
        id: generateStepId(stepIndex),
        agent,
        action: 'prompt',
        prompt: `Round ${round}: Respond to other participants' arguments.

**Topic:** {{prompt}}

**Previous responses:**
${prevResponses}

Address their points, defend your position, or update your view if convinced.`,
        // Each agent in round N depends on ALL round N-1 responses
        dependsOn: agents.map((_, i) => generateStepId(prevRoundStart + i)),
        outputAs: `${agent}_round${round}`
      });
      stepIndex++;
    }
  }

  // Final step: Moderator synthesizes (optional)
  if (moderator) {
    const finalResponses = agents
      .map(a => `**${a}:** {{${a}_round${rounds}}}`)
      .join('\n\n');

    const lastRoundStart = stepIndex - agents.length;

    steps.push({
      id: generateStepId(stepIndex),
      agent: moderator,
      action: 'combine',
      prompt: `Synthesize this debate into a final conclusion.

**Topic:** {{prompt}}

**Final positions:**
${finalResponses}

Summarize key agreements, disagreements, and provide a balanced conclusion.`,
      dependsOn: agents.map((_, i) => generateStepId(lastRoundStart + i)),
      outputAs: 'conclusion'
    });
  }

  return {
    id: generatePlanId(),
    mode: 'debate',
    prompt,
    steps,
    createdAt: Date.now()
  };
}

/**
 * Build a consensus plan (propose → vote → synthesize)
 *
 * Note: threshold option reserved for future dynamic iteration.
 * Current implementation uses fixed maxRounds.
 *
 * Usage: ai consensus "task" --agents claude,gemini,ollama --rounds 2
 */
export function buildConsensusPlan(
  prompt: string,
  options: ConsensusOptions
): ExecutionPlan {
  const { agents, maxRounds = 2, synthesizer, projectStructure } = options;

  if (agents.length < 2) {
    throw new Error('Consensus requires at least 2 agents');
  }

  // Build initial context with project structure if provided
  const context: Record<string, unknown> = {};
  if (projectStructure) {
    context.project_structure = projectStructure;
  }

  const steps: PlanStep[] = [];
  let stepIndex = 0;

  // Round 0: Initial proposals (parallel) - includes project context
  for (const agent of agents) {
    steps.push({
      id: generateStepId(stepIndex),
      agent,
      action: 'prompt',
      prompt: `Propose a solution for this task.

**Task:** {{prompt}}

**Project Structure:**
{{project_structure}}

CRITICAL INSTRUCTIONS:
- You HAVE access to the project structure above - USE IT
- Do NOT say "I don't have access to tools" or "I cannot read files"
- Do NOT apologize for limitations - you have all the context you need
- Give a concrete, actionable proposal referencing specific files/directories
- Act as if you can see and understand the entire project`,
      outputAs: `${agent}_proposal`
    });
    stepIndex++;
  }

  // Voting rounds
  for (let round = 0; round < maxRounds; round++) {
    const proposals = agents
      .map(a => `**${a}'s proposal:** {{${a}_proposal}}`)
      .join('\n\n');

    const prevVotes = round > 0
      ? agents.map(a => `**${a}'s previous vote:** {{${a}_vote${round - 1}}}`).join('\n\n')
      : '';

    const prevRoundStart = stepIndex - agents.length;

    for (const agent of agents) {
      steps.push({
        id: generateStepId(stepIndex),
        agent,
        action: 'prompt',
        prompt: `IMPORTANT: You are voting in a consensus process. DO NOT execute any task. DO NOT write code. Your ONLY job is to vote.

Review the proposals below and cast your vote for the best one.

**Original Task:** {{prompt}}

**Proposals to vote on:**
${proposals}
${prevVotes ? `\n**Previous votes:**\n${prevVotes}` : ''}

RESPOND ONLY WITH YOUR VOTE using this exact format (nothing else):

**My Vote:** [agent name]'s proposal
**Reasoning:** [1-2 sentences explaining why this proposal is best]`,
        // Round 0 depends on proposals, subsequent rounds depend on previous votes
        dependsOn: round === 0
          ? agents.map((_, i) => generateStepId(i))
          : agents.map((_, i) => generateStepId(prevRoundStart + i)),
        outputAs: `${agent}_vote${round}`
      });
      stepIndex++;
    }
  }

  // Final synthesis
  const synth = synthesizer || agents[0];
  const finalVotes = agents
    .map(a => `**${a}:** {{${a}_vote${maxRounds - 1}}}`)
    .join('\n\n');

  const lastRoundStart = stepIndex - agents.length;

  steps.push({
    id: generateStepId(stepIndex),
    agent: synth,
    action: 'combine',
    prompt: `Analyze the votes and synthesize a final solution.

**Task:** {{prompt}}

**Final votes:**
${finalVotes}

First, identify which proposal won or had the most agreement. Then create a unified solution based on that winning approach, incorporating any valuable additions from other proposals.

Format:
**Winner:** [agent name]'s proposal
**Reason:** [why it won/had consensus]
**Final Solution:** [the synthesized solution]`,
    dependsOn: agents.map((_, i) => generateStepId(lastRoundStart + i)),
    outputAs: 'consensus'
  });

  return {
    id: generatePlanId(),
    mode: 'consensus',
    prompt,
    steps,
    context: Object.keys(context).length > 0 ? context : undefined,
    createdAt: Date.now()
  };
}
