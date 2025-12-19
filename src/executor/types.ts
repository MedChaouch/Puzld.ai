/**
 * Core types for the ExecutionPlan system
 *
 * ExecutionPlan for everything. One universal executor, multiple plan builders.
 */

// Agent types
export type AgentName = 'claude' | 'gemini' | 'codex' | 'ollama';

// Step action types
export type StepAction =
  | 'prompt'      // Send prompt to agent
  | 'analyze'     // Analyze previous results
  | 'combine'     // Combine multiple results
  | 'transform'   // Transform data
  | 'validate'    // Validate output
  | 'route';      // Dynamic routing decision

// Step execution status
export type StepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'cancelled';

// Result from a single step
export interface StepResult {
  stepId: string;
  status: StepStatus;
  content?: string;
  error?: string;
  model?: string;
  duration?: number;       // ms
  metadata?: Record<string, unknown>;
}

// Single step in a plan
export interface PlanStep {
  id: string;
  agent: AgentName | 'auto';
  action: StepAction;
  prompt: string;                  // Can contain {{variables}}
  model?: string;                  // Specific model to use (optional)
  dependsOn?: string[];            // Step IDs this depends on
  fallback?: AgentName;            // Fallback agent if primary fails
  retries?: number;                // Max retry attempts (default: 0)
  timeout?: number;                // Step-specific timeout (ms)
  condition?: string;              // Expression to evaluate (e.g., "{{step1.success}}")
  outputAs?: string;               // Variable name to store result
  injectionRules?: InjectionRule[]; // Custom context injection rules (Phase 7)
  role?: StepRole;                 // Semantic role for default injection rules
}

// Semantic role for default injection rules
export type StepRole =
  | 'code'       // Code generation - needs full requirements, code context
  | 'review'     // Code review - needs code output, background summary
  | 'analyze'    // Analysis - needs task, context key points
  | 'fix'        // Bug fix - needs review feedback, original code
  | 'plan'       // Planning - needs user input, constraints
  | 'summarize'; // Summarization - needs full previous output

// Execution plan - the universal unit
export interface ExecutionPlan {
  id: string;
  mode: PlanMode;
  prompt: string;                  // Original user prompt
  steps: PlanStep[];
  createdAt: number;               // Unix timestamp
  context?: Record<string, unknown>; // Initial context variables
}

// Plan mode determines execution behavior
export type PlanMode =
  | 'single'      // Single agent, single step
  | 'compare'     // Parallel execution, compare results
  | 'pipeline'    // Sequential with dependencies
  | 'auto'        // LLM-generated plan
  | 'debate'      // Multi-round agent debate with moderator
  | 'consensus'   // Propose → vote → iterate until agreement
  | 'correction'; // Producer → reviewer → optional fix

// Execution timeline event for UI/logging
export interface TimelineEvent {
  timestamp: number;
  stepId: string;
  type: 'start' | 'progress' | 'complete' | 'error' | 'retry' | 'skip';
  message?: string;
  data?: unknown;
}

// Full execution result
export interface ExecutionResult {
  planId: string;
  status: 'completed' | 'failed' | 'partial' | 'cancelled';
  results: StepResult[];
  timeline: TimelineEvent[];
  finalOutput?: string;
  duration: number;                // Total duration in ms
}

// Executor configuration
export interface ExecutorConfig {
  maxConcurrency?: number;         // Max parallel steps (default: 3)
  defaultTimeout?: number;         // Default step timeout (default: 120000)
  defaultRetries?: number;         // Default retries (default: 0)
  onEvent?: (event: TimelineEvent) => void;
  onChunk?: (stepId: string, chunk: string) => void;
  onBeforeStep?: (step: PlanStep, index: number, previousResults: StepResult[]) => Promise<{ proceed: boolean; editedPrompt?: string } | boolean>; // Return false/{ proceed: false } to skip
  signal?: AbortSignal;
}

// Compare mode options
export interface CompareOptions {
  agents: AgentName[];
  models?: string[];               // Optional models for each agent (maps by index)
  sequential?: boolean;            // Run one at a time
  pick?: boolean;                  // Select best response
  pickCriteria?: string;           // How to pick (e.g., "longest", "llm")
  projectStructure?: string;       // Optional project file listing for context
}

// Pipeline mode options
export interface PipelineOptions {
  steps: PipelineStep[];
  interactive?: boolean;           // Confirm between steps
}

// Pipeline step definition (user-friendly format)
export interface PipelineStep {
  agent: AgentName | 'auto';
  action: string;                  // e.g., "analyze", "code", "review"
  promptTemplate?: string;         // Override default prompt
}

// Template for saved pipelines
export interface PipelineTemplate {
  name: string;
  description?: string;
  steps: PipelineStep[];
  createdAt: number;
  updatedAt: number;
}

// --- Multi-Agent Collaboration Options ---

// Cross-correction: one agent produces, another reviews
export interface CorrectionOptions {
  producer: AgentName | 'auto';
  reviewer: AgentName | 'auto';
  fixAfterReview?: boolean;  // Producer fixes based on review
}

// Debate: multiple rounds of agent discussion
export interface DebateOptions {
  agents: AgentName[];       // Min 2 agents required
  rounds: number;            // Number of debate rounds
  moderator?: AgentName;     // Agent that synthesizes final result
}

// Consensus: agents propose and vote until agreement
export interface ConsensusOptions {
  agents: AgentName[];       // Min 2 agents required
  threshold?: number;        // Agreement threshold 0-1 (default: 0.7)
  maxRounds?: number;        // Max voting rounds (default: 3)
  synthesizer?: AgentName;   // Agent that creates final output
  projectStructure?: string; // Optional project file listing for context
}

// --- Dynamic Memory Injection (Phase 7) ---

// Context source types for injection
export type ContextSource =
  | 'previous_output'  // Output from previous step(s)
  | 'step_output'      // Output from a specific step
  | 'plan'             // Original plan/task description
  | 'user_input'       // Original user prompt
  | 'file_context';    // File/code context (future)

// How to include the context
export type IncludeMode =
  | 'full'             // Include full content
  | 'summary'          // Use summarized version
  | 'keyPoints'        // Only key points extracted
  | 'truncated'        // Truncate to fit
  | 'none';            // Exclude entirely

// Priority levels (1 = critical, 4 = low)
export type ContextPriority = 1 | 2 | 3 | 4;

// Injection rule for a single context source
export interface InjectionRule {
  source: ContextSource;
  stepId?: string;              // Specific step ID, or undefined = all previous
  include: IncludeMode;
  maxTokens?: number;           // Max tokens for this source
  priority: ContextPriority;    // 1=critical (always), 4=low (drop first)
  tag?: string;                 // XML tag name, e.g. 'previous_analysis'
  condition?: string;           // Condition expression, e.g. "{{step1.success}}"
}

// Configuration for context assembly
export interface InjectionConfig {
  rules: InjectionRule[];
  tokenBudget: number;          // Total token budget for context
  format: 'xml' | 'markdown';   // Output format (xml for Claude, markdown for others)
  reserveForPrompt?: number;    // Tokens to reserve for the step's own prompt
}
