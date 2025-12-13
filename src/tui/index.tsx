import React, { useState, useMemo, useEffect, useRef } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { orchestrate } from '../orchestrator';
import { chat as chatOrchestrator } from '../chat';
import { compare as compareOrchestrator, recordComparePreference, hasPendingComparison } from '../chat/compare';
import { debate as debateOrchestrator, recordDebateWinner, hasPendingDebate } from '../chat/debate';
import { pipeline as pipelineOrchestrator } from '../chat/pipeline';
import { Banner, WelcomeMessage } from './components/Banner';
import { useHistory } from './hooks/useHistory';
import { getCommandSuggestions } from './components/Autocomplete';
import { StatusBar } from './components/StatusBar';
import {
  buildComparePlan,
  buildPipelinePlan,
  buildCorrectionPlan,
  buildDebatePlan,
  buildConsensusPlan,
  parseAgentsString,
  parsePipelineString,
  execute,
  type AgentName
} from '../executor';
import { listTemplates, loadTemplate } from '../executor/templates';
import { WorkflowsManager } from './components/WorkflowsManager';
import { SessionsManager } from './components/SessionsManager';
import { SettingsPanel } from './components/SettingsPanel';
import { ModelPanel } from './components/ModelPanel';
import { getConfig, saveConfig } from '../lib/config';
import { getCLIDefaults } from '../lib/cliConfigs';
import { getModelSuggestions } from '../lib/models';
import { CompareView } from './components/CompareView';
import { CollaborationView, type CollaborationStep, type CollaborationType, type PostAction } from './components/CollaborationView';
import { generatePlan } from '../executor/planner';
import { isRouterAvailable } from '../router/router';
import { adapters } from '../adapters';
import {
  getLatestSession,
  loadSession,
  addMessage as addSessionMessage,
  createSession,
  clearSessionHistory,
  type AgentSession
} from '../memory';
import { checkForUpdate, markUpdated } from '../lib/updateCheck';
import { UpdatePrompt } from './components/UpdatePrompt';
import { AgentPanel } from './components/AgentPanel';
import { IndexPanel } from './components/IndexPanel';
import { DiffReview } from './components/DiffReview';
import { execa } from 'execa';
import type { PlanStep, StepResult } from '../executor';
import { claudeAdapter, type DryRunResult } from '../adapters/claude';
import type { ProposedEdit } from '../lib/edit-review';
import {
  runAgentic,
  formatFileContext,
  runAgentLoop,
  permissionTracker,
  type AgenticResult,
  type ToolCall,
  type ToolResult,
  type PermissionRequest,
  type PermissionResult,
  type PermissionDecision
} from '../agentic';
import { ToolActivity, type ToolCallInfo } from './components/ToolActivity';
import { PermissionPrompt } from './components/PermissionPrompt';
import { AgentStatus } from './components/AgentStatus';
import {
  startObservation,
  logResponse,
  logReviewDecision,
  completeObservation
} from '../observation';
import { addMemory } from '../memory/vector-store';
import { buildInjectionForAgent } from '../memory/injector';
import {
  indexCodebase,
  getIndexSummary,
  getConfigSummary,
  getGraphSummary,
  searchCode,
  getTaskContext,
  detectProjectConfig,
  buildDependencyGraph,
  parseFiles
} from '../indexing';
import { globSync } from 'glob';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8'));

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'compare' | 'collaboration';
  content: string;
  agent?: string;
  duration?: number;
  tokens?: { input: number; output: number };
  compareResults?: CompareResult[];
  collaborationSteps?: CollaborationStep[];
  collaborationType?: CollaborationType;
  pipelineName?: string;
  toolCalls?: ToolCallInfo[];
}

let messageId = 0;
const nextId = () => String(++messageId);

type AppMode = 'chat' | 'workflows' | 'sessions' | 'settings' | 'model' | 'compare' | 'collaboration' | 'agent' | 'review' | 'index' | 'plan';
type AgenticSubMode = 'plan' | 'build';

interface CompareResult {
  agent: string;
  content: string;
  error?: string;
  duration?: number;
  loading?: boolean;
}

interface AgentStatus {
  name: string;
  ready: boolean;
}

function App() {
  // Disable mouse tracking to prevent scroll events from triggering input
  const { exit } = useApp();

  const [input, setInput] = useState('');
  const [inputKey, setInputKey] = useState(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [tokens, setTokens] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('thinking...');
  const [mode, setMode] = useState<AppMode>('chat');
  const [compareResults, setCompareResults] = useState<CompareResult[]>([]);
  const [compareKey, setCompareKey] = useState(0); // Increments to reset CompareView state
  const [collaborationSteps, setCollaborationSteps] = useState<CollaborationStep[]>([]);
  const [collaborationType, setCollaborationType] = useState<CollaborationType>('correct');
  const [collaborationKey, setCollaborationKey] = useState(0); // Increments to reset CollaborationView state
  const [pipelineName, setPipelineName] = useState<string>('');
  const [notification, setNotification] = useState<string | null>(null);
  const [proposedEdits, setProposedEdits] = useState<ProposedEdit[]>([]);
  const [currentObservationId, setCurrentObservationId] = useState<number | null>(null);
  const [currentAgenticResult, setCurrentAgenticResult] = useState<AgenticResult | null>(null);
  const [agentStatus, setAgentStatus] = useState<AgentStatus[]>([]);
  const [session, setSession] = useState<AgentSession | null>(null);
  const [updateInfo, setUpdateInfo] = useState<{ current: string; latest: string } | null>(null);
  const [showUpdatePrompt, setShowUpdatePrompt] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [ctrlCPressed, setCtrlCPressed] = useState(false);
  const [lastMode, setLastMode] = useState<'compare' | 'debate' | 'pipeline' | null>(null);
  const [consensusContext, setConsensusContext] = useState<string | null>(null); // For follow-up context
  const [isReEnteringCollaboration, setIsReEnteringCollaboration] = useState(false); // Track re-enter to avoid duplicate saves
  const [agenticSubMode, setAgenticSubMode] = useState<AgenticSubMode>('plan'); // Plan vs Build mode
  const [currentPlan, setCurrentPlan] = useState<string | null>(null); // Current plan content for Tab toggle
  const [currentPlanTask, setCurrentPlanTask] = useState<string | null>(null); // Task that generated the plan
  const [modeChangeNotice, setModeChangeNotice] = useState<string | null>(null); // Brief notification when mode changes

  // Tool activity state (for background display like Claude Code)
  const [toolActivity, setToolActivity] = useState<ToolCallInfo[]>([]);
  const [toolIteration, setToolIteration] = useState(0);
  const [loadingStartTime, setLoadingStartTime] = useState<number | undefined>();
  const [loadingAgent, setLoadingAgent] = useState<string>('');

  // Permission prompt state
  const [pendingPermission, setPendingPermission] = useState<{
    request: PermissionRequest;
    resolve: (result: PermissionResult) => void;
  } | null>(null);

  // AbortController for cancelling running operations
  const abortControllerRef = useRef<AbortController | null>(null);

  // Check if collaboration is currently loading
  const isCollaborationLoading = mode === 'collaboration' && collaborationSteps.some(s => s.loading);

  // Ctrl+C to cancel/exit, Escape to go back
  useInput((input, key) => {
    // Only handle Ctrl+C or Escape - ignore all other keys
    if (!(key.ctrl && input === 'c') && !key.escape) {
      return;
    }

    // Escape while loading = go back to chat (keep results so far)
    if (isCollaborationLoading && key.escape) {
      saveCollaborationToHistory();
      return;
    }

    // Ctrl+C while loading = cancel the operation
    if (isCollaborationLoading && key.ctrl && input === 'c') {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
        setNotification('Cancelling...');
        return;
      }
    }

    // Double Ctrl+C to exit app
    if (key.ctrl && input === 'c') {
      if (ctrlCPressed) {
        exit();
        process.exit(0);
      } else {
        setCtrlCPressed(true);
        setNotification('Press Ctrl+C again to exit');
        setTimeout(() => {
          setCtrlCPressed(false);
          setNotification(null);
        }, 2000);
      }
    }
  });

  // Ctrl+E to re-enter last collaboration result
  useInput((input, key) => {
    if (key.ctrl && input === 'e' && mode === 'chat') {
      // Find the last collaboration message
      const lastCollabMsg = [...messages].reverse().find(m => m.role === 'collaboration' && m.collaborationSteps);
      if (lastCollabMsg && lastCollabMsg.collaborationSteps) {
        setCollaborationSteps(lastCollabMsg.collaborationSteps);
        setCollaborationType(lastCollabMsg.collaborationType || 'correct');
        setPipelineName(lastCollabMsg.pipelineName || '');
        setCollaborationKey(k => k + 1);
        setIsReEnteringCollaboration(true); // Don't save again on exit
        setMode('collaboration');
      }
    }
  });


  // Value options
  const [currentAgent, setCurrentAgent] = useState('auto');
  const [currentRouter, setCurrentRouter] = useState('ollama');
  const [currentPlanner, setCurrentPlanner] = useState('ollama');

  // Toggle options
  const [sequential, setSequential] = useState(false);
  const [pick, setPick] = useState(false);
  const [executeMode, setExecuteMode] = useState(false);
  const [interactive, setInteractive] = useState(false);

  // Collaboration settings
  const [correctFix, setCorrectFix] = useState(false);
  const [debateRounds, setDebateRounds] = useState(2);
  const [debateModerator, setDebateModerator] = useState('none');
  const [consensusRounds, setConsensusRounds] = useState(2);
  const [consensusSynthesizer, setConsensusSynthesizer] = useState('auto');

  // Model settings (loaded from config, fallback to CLI defaults)
  const config = getConfig();
  const cliDefaults = getCLIDefaults();
  const [claudeModel, setClaudeModel] = useState(config.adapters.claude.model || cliDefaults.claude || '');
  const [geminiModel, setGeminiModel] = useState(config.adapters.gemini.model || cliDefaults.gemini || '');
  const [codexModel, setCodexModel] = useState(config.adapters.codex.model || cliDefaults.codex || '');
  const [ollamaModel, setOllamaModel] = useState(config.adapters.ollama.model || cliDefaults.ollama || '');
  const [mistralModel, setMistralModel] = useState(config.adapters.mistral?.model || '');

  // Model setters that persist to config (returns warning if unknown model)
  const handleSetClaudeModel = (model: string): string | undefined => {
    setClaudeModel(model);
    const cfg = getConfig();
    cfg.adapters.claude.model = model;
    saveConfig(cfg);
    const known = getModelSuggestions('claude');
    if (known.length > 0 && !known.includes(model)) {
      return `Warning: "${model}" not in known models. It may still work.`;
    }
  };
  const handleSetGeminiModel = (model: string): string | undefined => {
    setGeminiModel(model);
    const cfg = getConfig();
    cfg.adapters.gemini.model = model;
    saveConfig(cfg);
    const known = getModelSuggestions('gemini');
    if (known.length > 0 && !known.includes(model)) {
      return `Warning: "${model}" not in known models. It may still work.`;
    }
  };
  const handleSetCodexModel = (model: string): string | undefined => {
    setCodexModel(model);
    const cfg = getConfig();
    cfg.adapters.codex.model = model;
    saveConfig(cfg);
    const known = getModelSuggestions('codex');
    if (known.length > 0 && !known.includes(model)) {
      return `Warning: "${model}" not in known models. It may still work.`;
    }
  };
  const handleSetOllamaModel = (model: string): string | undefined => {
    setOllamaModel(model);
    const cfg = getConfig();
    cfg.adapters.ollama.model = model;
    saveConfig(cfg);
    // Ollama models are dynamic, no warning needed
  };
  const handleSetMistralModel = (model: string): string | undefined => {
    setMistralModel(model);
    const cfg = getConfig();
    if (!cfg.adapters.mistral) {
      cfg.adapters.mistral = { enabled: true, path: 'vibe' };
    }
    cfg.adapters.mistral.model = model;
    saveConfig(cfg);
    const known = getModelSuggestions('mistral');
    if (known.length > 0 && !known.includes(model)) {
      return `Warning: "${model}" not in known models. It may still work.`;
    }
  };

  const { addToHistory, navigateHistory } = useHistory();

  // Check router availability on startup
  useEffect(() => {
    isRouterAvailable().then(available => {
      if (!available) {
        setNotification('Router offline, using fallback agent');
      }
    }).catch(() => {
      setNotification('Router offline, using fallback agent');
    });
  }, []);

  // Check for updates on startup
  useEffect(() => {
    checkForUpdate().then(info => {
      if (info.hasUpdate) {
        setUpdateInfo({ current: info.currentVersion, latest: info.latestVersion });
        setShowUpdatePrompt(true);
      }
    });
  }, []);

  // Handle update action
  const handleUpdate = async () => {
    setIsUpdating(true);
    setShowUpdatePrompt(false);
    setNotification('Updating PuzldAI...');
    try {
      await execa('npm', ['update', '-g', 'puzldai']);
      // Mark this version as updated so we don't prompt again on restart
      if (updateInfo) {
        markUpdated(updateInfo.latest);
      }
      setNotification('Updated! Restart puzldai to use the new version.');
    } catch {
      setNotification('Update failed. Run: npm update -g puzldai');
    }
    setIsUpdating(false);
  };

  // Handle skip update
  const handleSkipUpdate = () => {
    setShowUpdatePrompt(false);
  };

  // Check agent availability on startup
  useEffect(() => {
    const checkAgents = async () => {
      const status: AgentStatus[] = [];
      for (const [name, adapter] of Object.entries(adapters)) {
        const ready = await adapter.isAvailable();
        status.push({ name, ready });
      }
      setAgentStatus(status);
    };
    checkAgents();
  }, []);

  // Helper to restore messages from session
  const restoreFromSession = (sess: AgentSession) => {
    if (sess.messages.length > 0) {
      const restored: Message[] = sess.messages.map((m, i) => ({
        id: String(i),
        role: m.role === 'system' ? 'assistant' : m.role,
        content: m.content
      }));
      setMessages(restored);
      messageId = restored.length;
    } else {
      setMessages([]);
      messageId = 0;
    }
  };

  // Handle session load from SessionsManager
  const handleLoadSession = (sess: AgentSession) => {
    setSession(sess);
    restoreFromSession(sess);
    setMode('chat');
  };

  // Track if we've shown the resume hint (ref to avoid re-renders)
  const hasShownHint = useRef(false);

  // Start fresh session for current agent (use /resume to continue previous)
  useEffect(() => {
    const sess = createSession(currentAgent);
    setSession(sess);
    setMessages([]);
    messageId = 0;

    // Show hint about resuming sessions on first launch only
    if (!hasShownHint.current) {
      setNotification('Use /resume to continue a previous session');
      const timer = setTimeout(() => setNotification(null), 4000);
      hasShownHint.current = true;
      return () => clearTimeout(timer);
    }
  }, [currentAgent]);

  // Handle workflow run from WorkflowsManager
  const handleWorkflowRun = async (workflowName: string, task: string) => {
    setMessages(prev => [...prev, { id: nextId(), role: 'user', content: '/workflow ' + workflowName + ' "' + task + '"' }]);

    try {
      const template = loadTemplate(workflowName);
      if (!template) throw new Error('Workflow not found');
      if (!template.steps || template.steps.length === 0) throw new Error('Workflow has no steps');

      const plan = buildPipelinePlan(task, { steps: template.steps });

      // Initialize collaboration steps with loading state
      const initialSteps: CollaborationStep[] = plan.steps.map(step => ({
        agent: step.agent || 'auto',
        role: step.action || 'execute',
        content: '',
        loading: true
      }));

      setCollaborationKey(k => k + 1);
      setCollaborationSteps(initialSteps);
      setCollaborationType('pipeline');
      setPipelineName(workflowName);
      setMode('collaboration');

      const result = await execute(plan);

      // Build visual collaboration steps from results
      const pipelineSteps: CollaborationStep[] = plan.steps.map((step) => {
        const stepResult = result.results.find(r => r.stepId === step.id);
        return {
          agent: step.agent || 'auto',
          role: step.action || 'execute',
          content: stepResult?.content || '',
          error: stepResult?.error,
          duration: stepResult?.duration,
          loading: false
        };
      });

      setCollaborationSteps(pipelineSteps);
    } catch (err) {
      setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: 'Error: ' + (err as Error).message }]);
      setMode('chat');
    }
  };

  // Memoize autocomplete items
  const autocompleteItems = useMemo(() => {
    if (!input.startsWith('/')) return [];
    // Don't show autocomplete if user has typed arguments (space + more text)
    const spaceIndex = input.indexOf(' ');
    if (spaceIndex > 0 && input.length > spaceIndex + 1) return [];
    return getCommandSuggestions(input).map(cmd => ({
      label: cmd.label + '  ' + cmd.description,
      value: cmd.value
    }));
  }, [input]);

  // Autocomplete selection index
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);

  // Reset index when input changes
  useEffect(() => {
    setAutocompleteIndex(0);
  }, [input]);

  // Handle autocomplete selection
  const handleAutocompleteSelect = (item: { value: string; label: string }) => {
    setInput(item.value);
    setInputKey(k => k + 1);
  };

  // Handle keyboard shortcuts - only for navigation keys, not regular typing
  useInput((char, key) => {
    // Only handle specific navigation/control keys - let TextInput handle all other input
    const isNavigationKey = key.upArrow || key.downArrow || key.tab || key.escape;
    if (!isNavigationKey) {
      return;
    }

    // Don't handle input in review mode - let DiffReview handle it
    if (mode === 'review') return;

    // When autocomplete is showing, handle navigation
    if (autocompleteItems.length > 0) {
      if (key.upArrow) {
        setAutocompleteIndex(i => Math.max(0, i - 1));
        return;
      } else if (key.downArrow) {
        setAutocompleteIndex(i => Math.min(autocompleteItems.length - 1, i + 1));
        return;
      } else if (key.tab) {
        // Tab selects autocomplete item
        handleAutocompleteSelect(autocompleteItems[autocompleteIndex]);
        return;
      } else if (key.escape) {
        setInput('');
        return;
      }
    }

    // Skip history navigation in collaboration/compare mode (let those views handle arrows)
    if (mode === 'collaboration' || mode === 'compare') {
      if (key.escape) {
        setInput('');
      }
      return;
    }

    if (key.upArrow) {
      setInput(navigateHistory('up', input));
    } else if (key.downArrow) {
      setInput(navigateHistory('down', input));
    } else if (key.escape) {
      setInput('');
    } else if (key.tab && input.startsWith('/') && autocompleteItems.length > 0) {
      // Tab completes when autocomplete available
      handleAutocompleteSelect(autocompleteItems[autocompleteIndex]);
    }
  }, { isActive: (mode === 'chat' || autocompleteItems.length > 0) && mode !== 'review' });

  // Save current compare results to history and exit compare mode
  const saveCompareToHistory = () => {
    if (mode === 'compare' && compareResults.length > 0 && !compareResults.some(r => r.loading)) {
      setMessages(prev => [...prev, {
        id: nextId(),
        role: 'compare',
        content: '',
        compareResults: compareResults
      }]);
      setMode('chat');
      setCompareResults([]);
      // Reset input to fix cursor issues when returning to chat
      setInput('');
      setInputKey(k => k + 1);
    }
  };

  // Save current collaboration results to history and exit collaboration mode
  const saveCollaborationToHistory = () => {
    if (mode === 'collaboration' && collaborationSteps.length > 0 && !collaborationSteps.some(s => s.loading)) {
      // Don't save again if we're re-entering (already in history)
      if (!isReEnteringCollaboration) {
        setMessages(prev => [...prev, {
          id: nextId(),
          role: 'collaboration',
          content: '',
          collaborationSteps: collaborationSteps,
          collaborationType: collaborationType,
          pipelineName: collaborationType === 'pipeline' ? pipelineName : undefined
        }]);
      }
      setMode('chat');
      setCollaborationSteps([]);
      setIsReEnteringCollaboration(false); // Reset flag
      // Reset input to fix cursor issues when returning to chat
      setInput('');
      setInputKey(k => k + 1);
    }
  };

  // Helper to add system messages
  const addSystemMessage = (content: string, agent?: string) => {
    setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content, agent: agent || 'system' }]);
  };

  // Handle post-collaboration actions (Build/Continue/Reject) for consensus, debate, correct
  const handleCollaborationAction = async (action: PostAction, content: string) => {
    const modeLabel = collaborationType === 'consensus' ? 'synthesis' :
                      collaborationType === 'debate' ? 'conclusion' :
                      collaborationType === 'correct' ? 'fix' : 'result';

    // Build summary of all steps for context
    const stepsSummary = collaborationSteps.map(s =>
      `[${s.agent}/${s.role}${s.round !== undefined ? `/round${s.round}` : ''}]: ${(s.content || s.error || '').slice(0, 200)}`
    ).join('\n');

    // Track decision in memory for learning (with full context)
    try {
      await addMemory({
        type: 'decision',
        content: `${collaborationType} action: ${action}\n\n${modeLabel}:\n${content.slice(0, 1000)}\n\nAll steps:\n${stepsSummary.slice(0, 2000)}`,
        metadata: {
          mode: collaborationType,
          action,
          agents: [...new Set(collaborationSteps.map(s => s.agent))].join(','),
          stepCount: String(collaborationSteps.length),
          timestamp: String(Date.now())
        }
      });
    } catch {
      // Continue even if memory fails
    }

    // Also log to observation layer for DPO training
    try {
      const observationId = startObservation({
        sessionId: session?.id,
        prompt: `[${collaborationType}] User chose: ${action}`,
        injectedContext: stepsSummary.slice(0, 3000),
        agent: collaborationSteps.find(s => s.role === 'synthesis' || s.role === 'moderator' || s.role === 'fix')?.agent || 'multi'
      });
      logResponse(observationId, {
        response: content,
        explanation: `User action: ${action} on ${collaborationType} ${modeLabel}`
      });
      // Log the action as a "review decision" (repurposing the field)
      logReviewDecision(observationId, {
        acceptedFiles: action === 'build' ? ['[BUILD]'] : action === 'continue' ? ['[CONTINUE]'] : [],
        rejectedFiles: action === 'reject' ? ['[REJECT]'] : []
      });
      await completeObservation(observationId);
    } catch {
      // Continue even if observation fails
    }

    // Save collaboration to history first
    saveCollaborationToHistory();

    // Reset input state when transitioning back to chat mode
    const resetInputState = () => {
      setInput('');
      setInputKey(k => k + 1);
    };

    if (action === 'build') {
      // Run agentic mode with the content as the task
      const agentName = currentAgent === 'auto' ? 'claude' : currentAgent;
      const adapter = adapters[agentName as keyof typeof adapters];

      if (!adapter) {
        addSystemMessage(`Unknown agent: ${agentName}`);
        resetInputState();
        return;
      }

      setMode('review');
      setLoading(true);
      setLoadingText(`building from ${modeLabel}...`);
      setMessages(prev => [...prev, {
        id: nextId(),
        role: 'user',
        content: `[Build from ${collaborationType}] ${content.slice(0, 200)}...`
      }]);

      try {
        const result = await runAgentic(content, {
          adapter,
          projectRoot: process.cwd()
        });
        setCurrentAgenticResult(result);
        setLoading(false);

        if (!result.proposedEdits || result.proposedEdits.length === 0) {
          addSystemMessage(`No file changes proposed from ${modeLabel}.`);
          setMode('chat');
          resetInputState();
        } else {
          // Show summary and switch to review mode
          const editSummary = result.proposedEdits.map(e =>
            `  ${e.operation}: ${e.filePath}${e.originalContent === null ? ' (new)' : ''}`
          ).join('\n');
          addSystemMessage(`Proposed ${result.proposedEdits.length} file edit(s) from ${modeLabel}:\n${editSummary}\n\nReview each edit below:`);
          setProposedEdits(result.proposedEdits);
        }
      } catch (err) {
        addSystemMessage(`Build failed: ${(err as Error).message}`);
        setLoading(false);
        setMode('chat');
        resetInputState();
      }

    } else if (action === 'continue') {
      // Preserve content context for follow-up chat
      setConsensusContext(content);
      setMode('chat');
      resetInputState();
      addSystemMessage(`Continuing with ${modeLabel} context. Your next message will have access to the ${collaborationType} result.`);

    } else if (action === 'reject') {
      // Still pass context so user can reference it if needed
      setConsensusContext(content);
      setMode('chat');
      resetInputState();
      addSystemMessage(`${collaborationType.charAt(0).toUpperCase() + collaborationType.slice(1)} rejected. Context still available for your next message.`);
    }
  };

  // Plan Mode - Analyze task without making changes (Tab toggles to Build)
  const runPlanMode = async (task: string) => {
    const agentName = currentAgent === 'auto' ? 'claude' : currentAgent;
    const adapter = adapters[agentName as keyof typeof adapters];
    if (!adapter) {
      setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: `Unknown agent: ${agentName}`, agent: 'system' }]);
      return;
    }

    setCurrentPlanTask(task);
    setAgenticSubMode('plan');
    setMessages(prev => [...prev, { id: nextId(), role: 'user', content: task }]);
    setLoading(true);
    setLoadingText(`planning with ${agentName}...`);

    try {
      const MAX_FILE_SIZE = 10 * 1024;
      const filePatterns = task.match(/[\w./\\-]+\.\w+/g) || [];
      const files: Array<{ path: string; content: string }> = [];
      for (const pattern of filePatterns) {
        const filePath = resolve(process.cwd(), pattern);
        if (existsSync(filePath)) {
          try {
            const content = readFileSync(filePath, 'utf-8');
            if (content.length <= MAX_FILE_SIZE) {
              files.push({ path: pattern, content });
            } else {
              files.push({ path: pattern, content: content.slice(0, MAX_FILE_SIZE) + '\n... (truncated)' });
            }
          } catch { /* Skip unreadable */ }
        }
      }

      const planPrompt = `You are in PLAN MODE. Analyze this task and describe what you WOULD do, but DO NOT generate actual file contents.

Task: ${task}
${files.length > 0 ? `\nRelevant files:\n${files.map(f => `--- ${f.path} ---\n${f.content}`).join('\n\n')}` : ''}

Provide:
1. **Analysis**: What does this task require?
2. **Approach**: How would you implement it?
3. **Files**: Which files would you create/modify? (just names, no content)
4. **Considerations**: Any potential issues or alternatives?

Keep your response concise and focused on the plan, not the implementation.`;

      const startTime = Date.now();
      const response = await adapter.run(planPrompt);
      const duration = Date.now() - startTime;

      setCurrentPlan(response.content || '');
      const planOutput = response.content || 'No plan generated.';
      setMessages(prev => [...prev, {
        id: nextId(),
        role: 'assistant',
        content: `${planOutput}\n\n───\n📋 Plan complete. Press Tab to Build.`,
        agent: agentName,
        duration
      }]);
      setMode('plan');
    } catch (err) {
      setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: 'Error: ' + (err as Error).message }]);
    }
    setLoading(false);
  };

  // Build Mode - Propose file edits for review (Tab toggles to Plan)
  const runBuildMode = async (task: string) => {
    const agentName = currentAgent === 'auto' ? 'claude' : currentAgent;
    const adapter = adapters[agentName as keyof typeof adapters];
    if (!adapter) {
      setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: `Unknown agent: ${agentName}`, agent: 'system' }]);
      return;
    }

    setCurrentPlanTask(task);
    setAgenticSubMode('build');
    setMessages(prev => [...prev, { id: nextId(), role: 'user', content: `[build] ${task}` }]);
    setLoading(true);
    setLoadingText(`building with ${agentName}...`);

    try {
      const MAX_FILE_SIZE = 10 * 1024;
      const filePatterns = task.match(/[\w./\\-]+\.\w+/g) || [];
      const files: Array<{ path: string; content: string }> = [];
      for (const pattern of filePatterns) {
        const filePath = resolve(process.cwd(), pattern);
        if (existsSync(filePath)) {
          try {
            const content = readFileSync(filePath, 'utf-8');
            if (content.length <= MAX_FILE_SIZE) {
              files.push({ path: pattern, content });
            } else {
              files.push({ path: pattern, content: content.slice(0, MAX_FILE_SIZE) + '\n... (truncated)' });
            }
          } catch { /* Skip unreadable */ }
        }
      }

      const fileContext = files.length > 0 ? files.map(f => `${f.path}:\n${f.content}`).join('\n\n') : undefined;
      const observationId = startObservation({
        sessionId: session?.id,
        prompt: task,
        injectedContext: fileContext,
        agent: agentName
      });

      const startTime = Date.now();
      const result = await runAgentic(task, {
        adapter,
        projectRoot: process.cwd(),
        files: files.length > 0 ? files : undefined
      });

      logResponse(observationId, {
        response: result.rawResponse?.content,
        explanation: result.agenticResponse?.explanation,
        proposedFiles: result.agenticResponse?.files?.map(f => ({
          path: f.path,
          operation: f.operation,
          content: f.content
        })),
        durationMs: Date.now() - startTime,
        tokensIn: result.rawResponse?.tokensIn,
        tokensOut: result.rawResponse?.tokensOut
      });

      if (!result.success) {
        completeObservation(observationId);
        let errorMsg = `Agentic error: ${result.error}`;
        if (result.rawResponse?.content) {
          const preview = result.rawResponse.content.slice(0, 200);
          errorMsg += `\n\nRaw response preview:\n${preview}${result.rawResponse.content.length > 200 ? '...' : ''}`;
        }
        setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: errorMsg, agent: agentName }]);
        setLoading(false);
        return;
      }

      if (!result.proposedEdits || result.proposedEdits.length === 0) {
        completeObservation(observationId);
        const explanation = result.agenticResponse?.explanation || result.rawResponse.content || 'No file edits proposed.';
        let hint = '';
        if (!result.agenticResponse) {
          hint = '\n\n(LLM did not return JSON format - showing raw response)';
        } else if (result.agenticResponse.files.length === 0) {
          hint = '\n\n(LLM returned empty files array - no changes proposed)';
        }
        setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: explanation + hint, agent: agentName }]);
        setLoading(false);
        return;
      }

      const editSummary = result.proposedEdits.map(e =>
        `  ${e.operation}: ${e.filePath}${e.originalContent === null ? ' (new)' : ''}`
      ).join('\n');
      const explanation = result.agenticResponse?.explanation || '';
      setMessages(prev => [...prev, {
        id: nextId(),
        role: 'assistant',
        content: `${explanation}\n\n${agentName} proposed ${result.proposedEdits.length} file edit(s):\n${editSummary}\n\nReview each edit below:`,
        agent: agentName
      }]);

      setCurrentObservationId(observationId);
      setCurrentAgenticResult(result);
      setProposedEdits(result.proposedEdits);
      setMode('review');
    } catch (err) {
      setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: 'Error: ' + (err as Error).message }]);
    }
    setLoading(false);
  };

  const handleSubmit = async (value: string) => {
    // Save any active compare/collaboration to history before processing new input (only if there's actual input)
    if (mode === 'compare' && value.trim()) {
      saveCompareToHistory();
    }
    if (mode === 'collaboration' && value.trim()) {
      saveCollaborationToHistory();
    }

    // If autocomplete is showing with single match, execute that command
    if (autocompleteItems.length === 1) {
      const cmd = autocompleteItems[0].value.trim();
      setInput('');
      setInputKey(k => k + 1);
      addToHistory(cmd);
      await handleSlashCommand(cmd);
      return;
    }
    // If multiple matches, check for exact match first
    if (autocompleteItems.length > 1) {
      const exactMatch = autocompleteItems.find(item => item.value.trim() === value.trim());
      if (exactMatch) {
        // Execute exact match
        setInput('');
        setInputKey(k => k + 1);
        addToHistory(value.trim());
        await handleSlashCommand(value.trim());
        return;
      }
      // Otherwise select highlighted item (user needs to pick)
      handleAutocompleteSelect(autocompleteItems[autocompleteIndex]);
      return;
    }

    if (!value.trim()) return;

    // Add to history
    addToHistory(value);

    // Handle slash commands
    if (value.startsWith('/')) {
      setInput('');
      await handleSlashCommand(value);
      return;
    }

    // Intelligent routing - LLM decides what to do
    setInput('');
    await runIntelligentChat(value);
  };

  // Handle permission decisions from PermissionPrompt
  const handlePermissionDecision = (decision: PermissionDecision) => {
    if (pendingPermission) {
      pendingPermission.resolve({ decision });
      setPendingPermission(null);
    }
  };

  // Intelligent chat with agentic tool loop - LLM can explore codebase
  const runIntelligentChat = async (userMessage: string) => {
    const agentName = currentAgent === 'auto' ? 'claude' : currentAgent;
    const adapter = adapters[agentName as keyof typeof adapters];
    if (!adapter) {
      setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: `Unknown agent: ${agentName}`, agent: 'system' }]);
      return;
    }

    setMessages(prev => [...prev, { id: nextId(), role: 'user', content: userMessage }]);
    setLoading(true);
    setLoadingAgent(agentName);
    setLoadingStartTime(Date.now());
    setLoadingText(`${agentName} is thinking...`);

    // Reset tool activity
    setToolActivity([]);
    setToolIteration(0);
    permissionTracker.reset();

    try {
      const result = await runAgentLoop(adapter, userMessage, {
        cwd: process.cwd(),

        // Permission handler - shows prompt and waits for user decision
        onPermissionRequest: async (request: PermissionRequest): Promise<PermissionResult> => {
          return new Promise((resolve) => {
            setPendingPermission({ request, resolve });
          });
        },

        // Tool call started (before permission)
        onToolCall: (call: ToolCall) => {
          const args = Object.entries(call.arguments)
            .map(([k, v]) => `${k}=${typeof v === 'string' ? (v as string).slice(0, 30) : v}`)
            .join(', ');
          setToolActivity(prev => [...prev, {
            id: call.id,
            name: call.name,
            args,
            status: 'pending'
          }]);
        },

        // Tool started executing (after permission granted)
        onToolStart: (call: ToolCall) => {
          setToolActivity(prev => prev.map(t =>
            t.id === call.id ? { ...t, status: 'running' as const } : t
          ));
          setLoadingText(`${agentName}: ${call.name}...`);
        },

        // Tool finished
        onToolEnd: (call: ToolCall, result: ToolResult) => {
          setToolActivity(prev => prev.map(t =>
            t.id === call.id ? {
              ...t,
              status: result.isError ? 'error' as const : 'done' as const,
              result: result.content.slice(0, 100)
            } : t
          ));
        },

        // Iteration callback
        onIteration: (iteration: number) => {
          setToolIteration(iteration);
          setLoadingText(`${agentName} exploring (${iteration})...`);
        }
      });

      const duration = result.duration;
      let content = result.content || 'No response';

      // Check if response contains JSON file edits (from write/edit tools or JSON block)
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1]);
          if (parsed.files && Array.isArray(parsed.files) && parsed.files.length > 0) {
            // Convert to proposed edits format and enter review mode
            const edits = parsed.files.map((f: any) => ({
              filePath: resolve(process.cwd(), f.path),
              operation: f.operation || 'edit',
              newContent: f.content,
              originalContent: existsSync(resolve(process.cwd(), f.path))
                ? readFileSync(resolve(process.cwd(), f.path), 'utf-8')
                : null
            }));

            const editSummary = edits.map((e: any) =>
              `  ${e.operation}: ${e.filePath}${e.originalContent === null ? ' (new)' : ''}`
            ).join('\n');

            setMessages(prev => [...prev, {
              id: nextId(),
              role: 'assistant',
              content: `${parsed.explanation || ''}\n\nProposed ${edits.length} file edit(s):\n${editSummary}\n\nReview below:`,
              agent: agentName,
              duration
            }]);

            setProposedEdits(edits);
            setMode('review');
            setLoading(false);
            return;
          }
        } catch { /* Not valid JSON, treat as normal response */ }
      }

      // Normal response - include tool calls from exploration
      const currentToolCalls = [...toolActivity];
      setMessages(prev => [...prev, {
        id: nextId(),
        role: 'assistant',
        content,
        agent: agentName,
        duration,
        tokens: result.tokens,
        toolCalls: currentToolCalls.length > 0 ? currentToolCalls : undefined
      }]);

      if (result.tokens) {
        setTokens(prev => prev + (result.tokens?.input || 0) + (result.tokens?.output || 0));
      }

      setMode('chat');
    } catch (err) {
      setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: 'Error: ' + (err as Error).message }]);
    }
    setLoading(false);
    setLoadingStartTime(undefined);
  };

  /* LEGACY DIRECT CHAT CODE - Commented out, now routing through /plan by default
   * To restore direct chat mode, uncomment this and remove the /plan routing above
   *
  const handleDirectChat = async (value: string) => {
    // Add user message
    setMessages(prev => [...prev, { id: nextId(), role: 'user', content: value }]);
    setInput('');
    setLoading(true);
    setLoadingText('thinking...');

    // Record preference from previous compare/debate (signal detection)
    if (lastMode === 'compare' && hasPendingComparison()) {
      recordComparePreference(value).catch(() => {});
    } else if (lastMode === 'debate' && hasPendingDebate()) {
      recordDebateWinner(value).catch(() => {});
    }
    setLastMode(null);

    // Capture session ID to avoid stale reference after async operations
    const sessionId = session?.id;
    const sessionAgent = session?.agent;

    // Persist user message to session
    if (sessionId) {
      const currentSession = loadSession(sessionId);
      if (currentSession) {
        const updated = await addSessionMessage(currentSession, 'user', value);
        setSession(updated);
      }
    }

    try {
      // Inject consensus context if available
      let promptWithContext = value;
      if (consensusContext) {
        promptWithContext = `<consensus_context>\n${consensusContext.slice(0, 4000)}\n</consensus_context>\n\nUser follow-up: ${value}`;
        setConsensusContext(null); // Clear after use
      }

      // Retrieve cross-session memory and inject into prompt
      let promptWithMemory = promptWithContext;
      try {
        const agentName = currentAgent === 'auto' ? 'claude' : currentAgent;
        const injection = await buildInjectionForAgent(promptWithContext, agentName, {
          maxTokens: 1500,
          includeConversation: true,
          includeCode: true,
          includeDecisions: true,
          includePatterns: true
        });

        if (injection.itemCount > 0) {
          promptWithMemory = `${injection.content}\n\n${promptWithContext}`;
        }
      } catch {
        // Continue without memory if retrieval fails
      }

      const result = await orchestrate(promptWithMemory, { agent: currentAgent });
      const responseContent = result.content || result.error || 'No response';
      // Track tokens
      if (result.tokens) {
        setTokens(prev => prev + (result.tokens?.input || 0) + (result.tokens?.output || 0));
      }
      setMessages(prev => [
        ...prev,
        {
          id: nextId(),
          role: 'assistant',
          content: responseContent,
          agent: result.model,
          duration: result.duration,
          tokens: result.tokens
        }
      ]);
      // Persist assistant message to session (re-fetch to avoid stale state)
      if (sessionId && sessionAgent === currentAgent) {
        const currentSession = loadSession(sessionId);
        if (currentSession) {
          const updated = await addSessionMessage(currentSession, 'assistant', responseContent);
          setSession(updated);
        }
      }

      // Save conversation to vector store for cross-session memory
      if (sessionId && responseContent && !result.error) {
        try {
          await addMemory({
            type: 'conversation',
            content: `User: ${value}\nAssistant: ${responseContent.slice(0, 2000)}`,
            metadata: {
              agent: result.model,
              sessionId,
              timestamp: new Date().toISOString()
            }
          });
        } catch {
          // Continue even if memory save fails
        }
      }
    } catch (err) {
      const errorMsg = 'Error: ' + (err as Error).message;
      setMessages(prev => [
        ...prev,
        { id: nextId(), role: 'assistant', content: errorMsg }
      ]);
      // Persist error to session (re-fetch to avoid stale state)
      if (sessionId && sessionAgent === currentAgent) {
        const currentSession = loadSession(sessionId);
        if (currentSession) {
          const updated = await addSessionMessage(currentSession, 'assistant', errorMsg);
          setSession(updated);
        }
      }
    }

    setLoading(false);
  };
  END LEGACY DIRECT CHAT CODE */

  const handleSlashCommand = async (cmd: string) => {
    // Parse command - handle quoted strings
    const match = cmd.slice(1).match(/^(\S+)\s*(.*)/);
    const command = match?.[1] || '';
    const rest = match?.[2] || '';

    const addMessage = (content: string, agent?: string) => {
      setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content, agent }]);
    };

    switch (command) {
      // === UTILITY ===
      case 'help':
        addMessage(`Just type a message - AI decides how to respond (answer, plan, or propose edits)

Commands:
  /compare <agents> <task>  - Compare agents side-by-side
  /autopilot <task>         - AI-generated execution plan
  /workflow <name> <task>   - Run a saved workflow
  /workflows                - Manage workflows (interactive)
  /index                    - Codebase indexing options
  /index full               - Index with embeddings
  /index quick              - Index without embeddings
  /index search <query>     - Search indexed code
  /index context <task>     - Get relevant code for task
  /index config             - Show project configuration
  /index graph              - Show dependency graph
  /session                  - Start new session
  /resume                   - Resume a previous session

Multi-Agent Collaboration:
  /correct <prod> <rev> <task>  - Cross-agent correction (fix in settings)
  /debate <agents> <topic>      - Multi-agent debate (rounds in settings)
  /consensus <agents> <task>    - Build consensus (rounds in settings)

Options:
  /agent [name]     - Show/set agent (claude, gemini, codex, ollama, mistral, auto)
  /model [agent] [model] - Show/set model (or open model panel)
  /router [name]    - Show/set routing agent
  /planner [name]   - Show/set autopilot planner agent
  /sequential       - Toggle: compare one-at-a-time
  /pick             - Toggle: select best from compare
  /execute          - Toggle: auto-run autopilot plans
  /interactive      - Toggle: pause between steps

Utility:
  /settings  - Open settings panel
  /changelog - Show version history
  /help      - Show this help
  /clear     - Clear chat history
  /exit      - Exit

Keyboard:
  Tab        - Autocomplete command
  Up/Down    - Navigate autocomplete or history
  Enter      - Submit or select autocomplete
  Esc        - Cancel/clear

Compare View:
  ←/→        - Navigate agents
  Enter      - Expand selected
  Tab        - Show all stacked
  Esc        - Back`);
        break;

      case 'clear':
        setMessages([]);
        if (session) {
          const cleared = clearSessionHistory(session);
          setSession(cleared);
        }
        messageId = 0;
        break;

      case 'index': {
        // Index codebase for semantic search
        const subCmd = rest.trim().split(/\s+/)[0] || '';
        const searchQuery = rest.slice(subCmd.length).trim();

        if (!subCmd) {
          // Open index panel
          setMode('index');
          break;
        }

        if (subCmd === 'search' && !searchQuery) {
          addMessage('Usage: /index search <query>\nExample: /index search "authentication"', 'system');
          break;
        }

        if (subCmd === 'search' && searchQuery) {
          // Search indexed code
          setLoading(true);
          setLoadingText('searching indexed code...');
          try {
            const results = await searchCode(searchQuery, process.cwd(), {
              limit: 10,
              includeContent: false
            });
            if (results.length === 0) {
              addMessage('No results found.', 'system');
            } else {
              const resultList = results.map(r =>
                '  ' + r.path + ' (' + (r.score * 100).toFixed(0) + '% - ' + r.matchReason + ')'
              ).join('\n');
              addMessage('Found ' + results.length + ' matches:\n' + resultList, 'system');
            }
          } catch (err) {
            addMessage('Search error: ' + (err as Error).message, 'system');
          }
          setLoading(false);
        } else if (subCmd === 'context') {
          // Get relevant code context for a task
          if (!searchQuery) {
            addMessage('Usage: /index context <task>\nExample: /index context "fix auth bug"', 'system');
            break;
          }
          setLoading(true);
          setLoadingText('getting relevant context...');
          try {
            const context = await getTaskContext(searchQuery, process.cwd(), {
              maxFiles: 5,
              maxTotalSize: 30 * 1024
            });
            if (context.files.length === 0) {
              addMessage('No relevant files found.', 'system');
            } else {
              let msg = 'Found ' + context.files.length + ' relevant files (' + (context.totalSize / 1024).toFixed(1) + 'KB):\n\n';
              for (const file of context.files) {
                msg += '--- ' + file.path + ' (' + file.reason + ') ---\n';
                msg += file.content + '\n\n';
              }
              addMessage(msg.trim(), 'system');
            }
          } catch (err) {
            addMessage('Context error: ' + (err as Error).message, 'system');
          }
          setLoading(false);
        } else if (subCmd === 'config') {
          // Show project configuration
          try {
            const config = detectProjectConfig(process.cwd());
            if (config.configFiles.length === 0) {
              addMessage('No project configuration files found.\n\nSupported: AGENTS.md, CLAUDE.md, .cursorrules, copilot-instructions.md', 'system');
            } else {
              addMessage('Project Configuration:\n' + getConfigSummary(config), 'system');
            }
          } catch (err) {
            addMessage('Config error: ' + (err as Error).message, 'system');
          }
        } else if (subCmd === 'graph') {
          // Show dependency graph
          setLoading(true);
          setLoadingText('building dependency graph...');
          try {
            const rootDir = process.cwd();
            const files = globSync('**/*.{ts,tsx,js,jsx}', {
              cwd: rootDir,
              absolute: true,
              ignore: ['**/node_modules/**', '**/dist/**', '**/build/**']
            }).slice(0, 500);
            const structures = parseFiles(files, rootDir);
            const graph = buildDependencyGraph(structures, rootDir);
            addMessage('Dependency Graph:\n' + getGraphSummary(graph), 'system');
          } catch (err) {
            addMessage('Graph error: ' + (err as Error).message, 'system');
          }
          setLoading(false);
        } else if (subCmd === 'full' || subCmd === 'quick') {
          // Index current directory
          setLoading(true);
          setLoadingText('indexing codebase...');
          try {
            const result = await indexCodebase(process.cwd(), { skipEmbedding: subCmd === 'quick' });
            const summary = getIndexSummary(result);
            let msg = summary;
            if (result.config.configFiles.length > 0) {
              msg += '\n\nProject Config:\n' + getConfigSummary(result.config);
            }
            addMessage(msg, 'system');
          } catch (err) {
            addMessage('Index error: ' + (err as Error).message, 'system');
          }
          setLoading(false);
        } else {
          addMessage('Unknown subcommand: ' + subCmd + '\n\nUsage: /index [full|quick|search|context|config|graph]', 'system');
        }
        break;
      }

      case 'resume':
        setMode('sessions');
        break;

      case 'settings':
        setMode('settings');
        break;

      case 'model':
        if (rest) {
          // /model <agent> [model] - show or set model for agent
          const [agent, ...modelParts] = rest.split(' ');
          const modelName = modelParts.join(' ');
          if (['claude', 'gemini', 'codex', 'ollama', 'mistral'].includes(agent)) {
            if (modelName) {
              // Set model
              switch (agent) {
                case 'claude': handleSetClaudeModel(modelName); break;
                case 'gemini': handleSetGeminiModel(modelName); break;
                case 'codex': handleSetCodexModel(modelName); break;
                case 'ollama': handleSetOllamaModel(modelName); break;
                case 'mistral': handleSetMistralModel(modelName); break;
              }
              addMessage(`Model for ${agent} set to: ${modelName}`);
            } else {
              // Show model
              let currentModel = '';
              switch (agent) {
                case 'claude': currentModel = claudeModel; break;
                case 'gemini': currentModel = geminiModel; break;
                case 'codex': currentModel = codexModel; break;
                case 'ollama': currentModel = ollamaModel; break;
                case 'mistral': currentModel = mistralModel; break;
              }
              addMessage(`${agent} model: ${currentModel || '(default)'}`);
            }
          } else {
            addMessage('Unknown agent. Use: claude, gemini, codex, ollama, mistral');
          }
        } else {
          // /model - open model panel
          setMode('model');
        }
        break;

      case 'session': {
        const freshSession = createSession(currentAgent);
        setSession(freshSession);
        setMessages([]);
        messageId = 0;
        addMessage('New session started');
        break;
      }

      case 'exit':
        process.exit(0);
        break;

      case 'changelog': {
        try {
          // Get package root directory (go up from src/tui to project root)
          const __filename = fileURLToPath(import.meta.url);
          const __dirname = dirname(__filename);
          const changelogPath = join(__dirname, '..', '..', 'CHANGELOG.md');
          const changelog = readFileSync(changelogPath, 'utf-8');

          // Parse and format the changelog for display
          const lines = changelog.split('\n');
          let formatted = '';
          let inVersion = false;
          let versionCount = 0;
          const maxVersions = rest ? parseInt(rest, 10) || Infinity : Infinity;

          for (const line of lines) {
            // Version headers
            if (line.startsWith('## [')) {
              if (line.includes('[Unreleased]')) continue;
              versionCount++;
              if (versionCount > maxVersions) break;
              inVersion = true;
              const match = line.match(/## \[(.+?)\] - (.+)/);
              if (match) {
                formatted += `\n━━━ v${match[1]} (${match[2]}) ━━━\n`;
              }
            } else if (inVersion) {
              // Section headers
              if (line.startsWith('### ')) {
                formatted += `\n${line.replace('### ', '▸ ')}\n`;
              } else if (line.startsWith('#### ')) {
                formatted += `  ${line.replace('#### ', '• ')}\n`;
              } else if (line.startsWith('- ')) {
                formatted += `    ${line}\n`;
              } else if (line.startsWith('---')) {
                // Skip separators
              } else if (line.trim()) {
                formatted += `  ${line}\n`;
              }
            }
          }

          if (!formatted.trim()) {
            addMessage('No changelog entries found.');
          } else {
            addMessage(`Release Notes (${versionCount} versions):\n${formatted}`);
          }
        } catch (err) {
          addMessage('Could not read changelog: ' + (err as Error).message);
        }
        break;
      }

      // === VALUE OPTIONS ===
      case 'agent':
        if (rest) {
          setCurrentAgent(rest);
          setNotification('Agent set to: ' + rest);
          setTimeout(() => setNotification(null), 2000);
        } else {
          setMode('agent');
        }
        break;

      case 'router':
        if (rest) {
          setCurrentRouter(rest);
          addMessage('Router set to: ' + rest);
        } else {
          addMessage('Current router: ' + currentRouter);
        }
        break;

      case 'planner':
        if (rest) {
          setCurrentPlanner(rest);
          addMessage('Planner set to: ' + rest);
        } else {
          addMessage('Current planner: ' + currentPlanner);
        }
        break;

      // === TOGGLE OPTIONS ===
      case 'sequential':
        setSequential(s => !s);
        addMessage('Sequential mode: ' + (!sequential ? 'ON' : 'OFF'));
        break;

      case 'pick':
        setPick(p => !p);
        addMessage('Pick mode: ' + (!pick ? 'ON' : 'OFF'));
        break;

      case 'execute':
        setExecuteMode(e => !e);
        addMessage('Execute mode: ' + (!executeMode ? 'ON' : 'OFF'));
        break;

      case 'interactive':
        setInteractive(i => !i);
        addMessage('Interactive mode: ' + (!interactive ? 'ON' : 'OFF'));
        break;

      // === WORKFLOWS ===
      case 'workflows':
        setMode('workflows');
        break;

      // === COMMANDS ===
      case 'compare': {
        // Parse: /compare agents "task" or /compare agents task
        const compareMatch = rest.match(/^(\S+)\s+(?:"([^"]+)"|(.+))$/);
        if (!compareMatch) {
          addMessage('Usage: /compare <agents> <task>\nExample: /compare claude,gemini "explain async"');
          break;
        }
        const agentsStr = compareMatch[1];
        const task = compareMatch[2] || compareMatch[3];
        const agents = parseAgentsString(agentsStr);

        if (agents.length < 2) {
          addMessage('Compare needs at least 2 agents.\nExample: /compare claude,gemini "task"');
          break;
        }

        // Add user message to chat history
        setMessages(prev => [...prev, { id: nextId(), role: 'user', content: '/compare ' + agentsStr + ' "' + task + '"' }]);

        // Initialize compare results with loading state
        setCompareKey(k => k + 1); // Reset CompareView state (side-by-side)
        setCompareResults(agents.map(agent => ({
          agent,
          content: '',
          loading: true
        })));
        setMode('compare');

        try {
          const plan = buildComparePlan(task, {
            agents: agents as AgentName[],
            sequential,
            pick
          });

          const result = await execute(plan);

          // Build result map for safe lookup (O(1) instead of O(n) find)
          const resultMap = new Map(result.results.map(r => [r.stepId, r]));

          // Build visual compare results
          const visualResults: CompareResult[] = agents.map((agent, i) => {
            const stepResult = resultMap.get('step_' + i);
            return {
              agent,
              content: stepResult?.content || '',
              error: stepResult?.error,
              duration: stepResult?.duration,
              loading: false
            };
          });

          setCompareResults(visualResults);
          setLastMode('compare'); // Track for preference detection
          // Keep in compare mode - will be saved to history when user types something new
        } catch (err) {
          // Show error in compare view
          const errorResults = agents.map(agent => ({
            agent,
            content: '',
            error: (err as Error).message,
            loading: false
          }));
          setCompareResults(errorResults);
          // Keep in compare mode - will be saved to history when user types something new
        }
        break;
      }

      case 'autopilot': {
        // Parse: /autopilot "task" or /autopilot task
        const taskMatch = rest.match(/^(?:"([^"]+)"|(.+))$/);
        if (!taskMatch) {
          addMessage('Usage: /autopilot <task>\nExample: /autopilot "build a REST API"');
          break;
        }
        const task = taskMatch[1] || taskMatch[2];

        setMessages(prev => [...prev, { id: nextId(), role: 'user', content: '/autopilot "' + task + '"' }]);
        setLoading(true);
        setLoadingText('generating plan...');

        try {
          const planResult = await generatePlan(task, currentPlanner as AgentName);

          if (planResult.error || !planResult.plan) {
            addMessage('Error: ' + (planResult.error || 'Failed to generate plan'), 'autopilot');
            setLoading(false);
            break;
          }

          const plan = planResult.plan;

          // Format plan display
          let planDisplay = 'Plan: ' + (plan.prompt || task) + '\n\n';
          plan.steps.forEach((step, i) => {
            // Extract just the description (before "Original task:")
            const description = step.prompt.split('Original task:')[0].trim();
            planDisplay += (i + 1) + '. [' + (step.agent || 'auto') + '] ' + step.action + '\n';
            planDisplay += '   ' + description.slice(0, 80) + (description.length > 80 ? '...' : '') + '\n';
          });

          if (executeMode) {
            addMessage(planDisplay, 'autopilot');
            setLoading(false);

            // Initialize collaboration steps with loading state
            const initialSteps: CollaborationStep[] = plan.steps.map(step => ({
              agent: step.agent || 'auto',
              role: step.action || 'execute',
              content: '',
              loading: true
            }));

            setCollaborationKey(k => k + 1);
            setCollaborationSteps(initialSteps);
            setCollaborationType('pipeline');
            setPipelineName('Autopilot');
            setMode('collaboration');

            const result = await execute(plan);

            // Build visual collaboration steps from results
            const pipelineSteps: CollaborationStep[] = plan.steps.map((step) => {
              const stepResult = result.results.find(r => r.stepId === step.id);
              return {
                agent: step.agent || 'auto',
                role: step.action || 'execute',
                content: stepResult?.content || '',
                error: stepResult?.error,
                duration: stepResult?.duration,
                loading: false
              };
            });

            setCollaborationSteps(pipelineSteps);
          } else {
            addMessage(planDisplay + '\nUse /execute to enable auto-execution', 'autopilot');
            setLoading(false);
          }
        } catch (err) {
          addMessage('Error: ' + (err as Error).message);
          setLoading(false);
        }

        break;
      }

      case 'workflow': {
        // Parse: /workflow name "task" or /workflow name task
        const wfMatch = rest.match(/^(\S+)\s+(?:"([^"]+)"|(.+))$/);
        if (!wfMatch) {
          addMessage('Usage: /workflow <name> <task>\nExample: /workflow code-review "my code here"');
          break;
        }
        const wfName = wfMatch[1];
        const task = wfMatch[2] || wfMatch[3];

        const template = loadTemplate(wfName);
        if (!template) {
          addMessage('Workflow not found: ' + wfName + '\nUse /workflows to see available workflows.');
          break;
        }
        if (!template.steps || template.steps.length === 0) {
          addMessage('Workflow "' + wfName + '" has no steps.\nEdit it in /workflows to add steps.');
          break;
        }

        // Add user message to chat history
        setMessages(prev => [...prev, { id: nextId(), role: 'user', content: '/workflow ' + wfName + ' "' + task + '"' }]);

        const plan = buildPipelinePlan(task, { steps: template.steps });

        // Initialize collaboration steps with loading state
        const initialSteps: CollaborationStep[] = plan.steps.map(step => ({
          agent: step.agent || 'auto',
          role: step.action || 'execute',
          content: '',
          loading: true
        }));

        setCollaborationKey(k => k + 1);
        setCollaborationSteps(initialSteps);
        setCollaborationType('pipeline');
        setPipelineName(wfName);
        setMode('collaboration');

        try {
          const result = await execute(plan);

          // Build visual collaboration steps from results
          const pipelineSteps: CollaborationStep[] = plan.steps.map((step, i) => {
            const stepResult = result.results.find(r => r.stepId === step.id);
            return {
              agent: step.agent || 'auto',
              role: step.action || 'execute',
              content: stepResult?.content || '',
              error: stepResult?.error,
              duration: stepResult?.duration,
              loading: false
            };
          });

          setCollaborationSteps(pipelineSteps);
        } catch (err) {
          // Show error in collaboration view
          const errorSteps = initialSteps.map(s => ({
            ...s,
            content: '',
            error: (err as Error).message,
            loading: false
          }));
          setCollaborationSteps(errorSteps);
        }

        break;
      }

      // === MULTI-AGENT COLLABORATION ===
      case 'correct': {
        // Parse: /correct producer reviewer "task"
        const correctMatch = rest.match(/^(\S+)\s+(\S+)\s+(?:"([^"]+)"|(.+))$/);
        if (!correctMatch) {
          addMessage('Usage: /correct <producer> <reviewer> <task>\nExample: /correct claude gemini "write a function"');
          break;
        }
        const producer = correctMatch[1];
        const reviewer = correctMatch[2];
        const task = correctMatch[3] || correctMatch[4];

        // Add user message to chat history
        setMessages(prev => [...prev, { id: nextId(), role: 'user', content: '/correct ' + producer + ' ' + reviewer + ' "' + task + '"' }]);

        // Initialize collaboration steps with loading state
        const initialSteps: CollaborationStep[] = [
          { agent: producer, role: 'producer', content: '', loading: true },
          { agent: reviewer, role: 'reviewer', content: '', loading: true },
        ];
        if (correctFix) {
          initialSteps.push({ agent: producer, role: 'fix', content: '', loading: true });
        }

        setCollaborationKey(k => k + 1);
        setCollaborationSteps(initialSteps);
        setCollaborationType('correct');
        setMode('collaboration');

        try {
          // Inject memory context into task
          let taskWithMemory = task;
          try {
            const injection = await buildInjectionForAgent(task, producer, {
              maxTokens: 1000,
              includeConversation: true,
              includeDecisions: true,
              includePatterns: true
            });
            if (injection.itemCount > 0) {
              taskWithMemory = `${injection.content}\n\nTask: ${task}`;
            }
          } catch {
            // Continue without memory
          }

          const plan = buildCorrectionPlan(taskWithMemory, {
            producer: producer as AgentName | 'auto',
            reviewer: reviewer as AgentName | 'auto',
            fixAfterReview: correctFix
          });

          // Create AbortController for cancellation
          const controller = new AbortController();
          abortControllerRef.current = controller;

          const result = await execute(plan, { signal: controller.signal });
          abortControllerRef.current = null;

          // Check if cancelled
          if (result.status === 'cancelled') {
            const cancelledSteps = initialSteps.map(s => ({
              ...s,
              content: s.loading ? '' : s.content,
              error: s.loading ? 'Cancelled by user' : undefined,
              loading: false
            }));
            setCollaborationSteps(cancelledSteps);
            setNotification(null);
            addSystemMessage('Correction cancelled.');
            return;
          }

          // Build visual collaboration steps
          const steps: CollaborationStep[] = [
            {
              agent: producer,
              role: 'producer',
              content: result.results[0]?.content || '',
              error: result.results[0]?.error,
              duration: result.results[0]?.duration,
              loading: false
            },
            {
              agent: reviewer,
              role: 'reviewer',
              content: result.results[1]?.content || '',
              error: result.results[1]?.error,
              duration: result.results[1]?.duration,
              loading: false
            }
          ];

          if (correctFix && result.results[2]) {
            steps.push({
              agent: producer,
              role: 'fix',
              content: result.results[2]?.content || '',
              error: result.results[2]?.error,
              duration: result.results[2]?.duration,
              loading: false
            });
          }

          setCollaborationSteps(steps);
        } catch (err) {
          // Show error in collaboration view
          const errorSteps = initialSteps.map(s => ({
            ...s,
            content: '',
            error: (err as Error).message,
            loading: false
          }));
          setCollaborationSteps(errorSteps);
        }

        setLoading(false);
        break;
      }

      case 'debate': {
        // Parse: /debate agents "topic" (rounds/moderator from settings)
        const debateMatch = rest.match(/^(\S+)\s+(?:"([^"]+)"|(.+))$/);
        if (!debateMatch) {
          addMessage('Usage: /debate <agents> <topic>\nExample: /debate claude,gemini "Is AI safe?"');
          break;
        }
        const agentsStr = debateMatch[1];
        const topic = debateMatch[2] || debateMatch[3];
        const agents = parseAgentsString(agentsStr);

        if (agents.length < 2) {
          addMessage('Debate needs at least 2 agents.\nExample: /debate claude,gemini "topic"');
          break;
        }

        const moderator = debateModerator !== 'none' ? debateModerator as AgentName : undefined;

        // Add user message to chat history
        setMessages(prev => [...prev, { id: nextId(), role: 'user', content: '/debate ' + agentsStr + ' "' + topic + '"' }]);

        // Initialize collaboration steps with loading state
        // Each round has all agents, plus optional moderator at end
        const initialDebateSteps: CollaborationStep[] = [];
        for (let round = 0; round < debateRounds; round++) {
          for (const agent of agents) {
            initialDebateSteps.push({
              agent,
              role: `round-${round}`,
              round,
              content: '',
              loading: true
            });
          }
        }
        if (moderator) {
          initialDebateSteps.push({
            agent: moderator,
            role: 'moderator',
            content: '',
            loading: true
          });
        }

        setCollaborationKey(k => k + 1);
        setCollaborationSteps(initialDebateSteps);
        setCollaborationType('debate');
        setMode('collaboration');

        try {
          // Inject memory context into topic
          let topicWithMemory = topic;
          try {
            const injection = await buildInjectionForAgent(topic, agents[0], {
              maxTokens: 1000,
              includeConversation: true,
              includeDecisions: true,
              includePatterns: true
            });
            if (injection.itemCount > 0) {
              topicWithMemory = `${injection.content}\n\nDebate topic: ${topic}`;
            }
          } catch {
            // Continue without memory
          }

          const plan = buildDebatePlan(topicWithMemory, {
            agents: agents as AgentName[],
            rounds: debateRounds,
            moderator
          });

          // Create AbortController for cancellation
          const controller = new AbortController();
          abortControllerRef.current = controller;

          const result = await execute(plan, { signal: controller.signal });
          abortControllerRef.current = null;

          // Check if cancelled
          if (result.status === 'cancelled') {
            const cancelledSteps = initialDebateSteps.map(s => ({
              ...s,
              content: s.loading ? '' : s.content,
              error: s.loading ? 'Cancelled by user' : undefined,
              loading: false
            }));
            setCollaborationSteps(cancelledSteps);
            setNotification(null);
            addSystemMessage('Debate cancelled.');
            return;
          }

          // Build visual collaboration steps
          const debateSteps: CollaborationStep[] = [];
          for (let round = 0; round < debateRounds; round++) {
            for (let i = 0; i < agents.length; i++) {
              const stepIndex = round * agents.length + i;
              const stepResult = result.results[stepIndex];
              debateSteps.push({
                agent: agents[i],
                role: `round-${round}`,
                round,
                content: stepResult?.content || '',
                error: stepResult?.error,
                duration: stepResult?.duration,
                loading: false
              });
            }
          }

          if (moderator) {
            const conclusionStep = result.results[result.results.length - 1];
            debateSteps.push({
              agent: moderator,
              role: 'moderator',
              content: conclusionStep?.content || '',
              error: conclusionStep?.error,
              duration: conclusionStep?.duration,
              loading: false
            });
          }

          setCollaborationSteps(debateSteps);
          setLastMode('debate'); // Track for preference detection
        } catch (err) {
          // Show error in collaboration view
          const errorSteps = initialDebateSteps.map(s => ({
            ...s,
            content: '',
            error: (err as Error).message,
            loading: false
          }));
          setCollaborationSteps(errorSteps);
        }

        break;
      }

      case 'consensus': {
        // Parse: /consensus agents "task" (rounds/synthesizer from settings)
        const consensusMatch = rest.match(/^(\S+)\s+(?:"([^"]+)"|(.+))$/);
        if (!consensusMatch) {
          addMessage('Usage: /consensus <agents> <task>\nExample: /consensus claude,gemini,ollama "best approach for..."');
          break;
        }
        const agentsStr = consensusMatch[1];
        const task = consensusMatch[2] || consensusMatch[3];
        const agents = parseAgentsString(agentsStr);

        if (agents.length < 2) {
          addMessage('Consensus needs at least 2 agents.\nExample: /consensus claude,gemini "task"');
          break;
        }

        const synth = consensusSynthesizer !== 'auto' ? consensusSynthesizer as AgentName : undefined;

        // Add user message to chat history
        setMessages(prev => [...prev, { id: nextId(), role: 'user', content: '/consensus ' + agentsStr + ' "' + task + '"' }]);

        // Initialize collaboration steps with loading state
        // Proposals (one per agent) + voting rounds + synthesis
        const initialConsensusSteps: CollaborationStep[] = [];

        // Initial proposals
        for (const agent of agents) {
          initialConsensusSteps.push({
            agent,
            role: 'proposal',
            content: '',
            loading: true
          });
        }

        // Voting rounds
        for (let round = 0; round < consensusRounds; round++) {
          for (const agent of agents) {
            initialConsensusSteps.push({
              agent,
              role: 'vote',
              round,
              content: '',
              loading: true
            });
          }
        }

        // Final synthesis
        initialConsensusSteps.push({
          agent: synth || agents[0],
          role: 'synthesis',
          content: '',
          loading: true
        });

        setCollaborationKey(k => k + 1);
        setCollaborationSteps(initialConsensusSteps);
        setCollaborationType('consensus');
        setMode('collaboration');

        try {
          // Inject memory context into task
          let taskWithMemory = task;
          try {
            const injection = await buildInjectionForAgent(task, agents[0], {
              maxTokens: 1000,
              includeConversation: true,
              includeDecisions: true,
              includePatterns: true
            });
            if (injection.itemCount > 0) {
              taskWithMemory = `${injection.content}\n\nTask: ${task}`;
            }
          } catch {
            // Continue without memory
          }

          const plan = buildConsensusPlan(taskWithMemory, {
            agents: agents as AgentName[],
            maxRounds: consensusRounds,
            synthesizer: synth
          });

          // Create AbortController for cancellation
          const controller = new AbortController();
          abortControllerRef.current = controller;

          const result = await execute(plan, { signal: controller.signal });
          abortControllerRef.current = null;

          // Check if cancelled
          if (result.status === 'cancelled') {
            const cancelledSteps = initialConsensusSteps.map(s => ({
              ...s,
              content: s.loading ? '' : s.content,
              error: s.loading ? 'Cancelled by user' : undefined,
              loading: false
            }));
            setCollaborationSteps(cancelledSteps);
            setNotification(null);
            addSystemMessage('Consensus cancelled.');
            return;
          }

          // Build visual collaboration steps from results
          const consensusSteps: CollaborationStep[] = [];
          let resultIndex = 0;

          // Proposals
          for (const agent of agents) {
            const stepResult = result.results[resultIndex++];
            consensusSteps.push({
              agent,
              role: 'proposal',
              content: stepResult?.content || '',
              error: stepResult?.error,
              duration: stepResult?.duration,
              loading: false
            });
          }

          // Voting rounds
          for (let round = 0; round < consensusRounds; round++) {
            for (const agent of agents) {
              const stepResult = result.results[resultIndex++];
              consensusSteps.push({
                agent,
                role: 'vote',
                round,
                content: stepResult?.content || '',
                error: stepResult?.error,
                duration: stepResult?.duration,
                loading: false
              });
            }
          }

          // Final synthesis
          const synthResult = result.results[resultIndex];
          consensusSteps.push({
            agent: synth || agents[0],
            role: 'synthesis',
            content: synthResult?.content || '',
            error: synthResult?.error,
            duration: synthResult?.duration,
            loading: false
          });

          setCollaborationSteps(consensusSteps);
        } catch (err) {
          // Show error in collaboration view
          const errorSteps = initialConsensusSteps.map(s => ({
            ...s,
            content: '',
            error: (err as Error).message,
            loading: false
          }));
          setCollaborationSteps(errorSteps);
        }

        break;
      }

      default:
        addMessage('Unknown command: /' + command + '\nType /help for available commands.');
    }
  };

  const isFirstMessage = messages.length === 0;

  return (
    <Box flexDirection="column" padding={1}>
      {/* Banner */}
      <Banner version={pkg.version} agents={agentStatus} />

      {/* Update Prompt */}
      {showUpdatePrompt && updateInfo && (
        <UpdatePrompt
          currentVersion={updateInfo.current}
          latestVersion={updateInfo.latest}
          onUpdate={handleUpdate}
          onSkip={handleSkipUpdate}
        />
      )}


      {/* Notification */}
      {notification && (
        <Box marginBottom={1}>
          <Text color="#fc3855">i </Text>
          <Text>{notification}</Text>
        </Box>
      )}

      {mode === 'chat' && (
        isFirstMessage && <WelcomeMessage />
      )}

      {/* Workflows Mode */}
      {mode === 'workflows' && (
        <WorkflowsManager
          onBack={() => setMode('chat')}
          onRun={handleWorkflowRun}
        />
      )}

      {/* Sessions Mode */}
      {mode === 'sessions' && (
        <SessionsManager
          onBack={() => setMode('chat')}
          onLoadSession={handleLoadSession}
          currentAgent={currentAgent}
        />
      )}

      {/* Settings Mode */}
      {mode === 'settings' && (
        <SettingsPanel
          onBack={() => setMode('chat')}
          version={pkg.version}
          currentAgent={currentAgent}
          routerAgent={currentRouter}
          plannerAgent={currentPlanner}
          session={session}
          sequential={sequential}
          pick={pick}
          autoExecute={executeMode}
          interactive={interactive}
          onToggleSequential={() => setSequential(s => !s)}
          onTogglePick={() => setPick(p => !p)}
          onToggleExecute={() => setExecuteMode(e => !e)}
          onToggleInteractive={() => setInteractive(i => !i)}
          correctFix={correctFix}
          debateRounds={debateRounds}
          debateModerator={debateModerator}
          consensusRounds={consensusRounds}
          consensusSynthesizer={consensusSynthesizer}
          onToggleCorrectFix={() => setCorrectFix(f => !f)}
          onSetDebateRounds={setDebateRounds}
          onSetDebateModerator={setDebateModerator}
          onSetConsensusRounds={setConsensusRounds}
          onSetConsensusSynthesizer={setConsensusSynthesizer}
        />
      )}

      {/* Model Selection Mode */}
      {mode === 'model' && (
        <ModelPanel
          onBack={() => setMode('chat')}
          claudeModel={claudeModel}
          geminiModel={geminiModel}
          codexModel={codexModel}
          ollamaModel={ollamaModel}
          mistralModel={mistralModel}
          onSetClaudeModel={handleSetClaudeModel}
          onSetGeminiModel={handleSetGeminiModel}
          onSetCodexModel={handleSetCodexModel}
          onSetOllamaModel={handleSetOllamaModel}
          onSetMistralModel={handleSetMistralModel}
        />
      )}

      {/* Agent Selection Mode */}
      {mode === 'agent' && (
        <AgentPanel
          currentAgent={currentAgent}
          agentStatus={agentStatus}
          onSelect={(agent) => {
            setCurrentAgent(agent);
            setMode('chat');
            setNotification('Agent set to: ' + agent);
            setTimeout(() => setNotification(null), 2000);
          }}
          onBack={() => setMode('chat')}
        />
      )}

      {/* Index Mode */}
      {mode === 'index' && (
        <IndexPanel
          onSelect={(option) => {
            setMode('chat');
            if (option === 'search') {
              setInput('/index search ');
              setInputKey(k => k + 1);
            } else if (option === 'context') {
              setInput('/index context ');
              setInputKey(k => k + 1);
            } else if (option === 'config') {
              // Show config immediately
              setMessages(prev => [...prev, { id: nextId(), role: 'user', content: '/index config' }]);
              try {
                const config = detectProjectConfig(process.cwd());
                if (config.configFiles.length === 0) {
                  setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: 'No project configuration files found.\n\nSupported: AGENTS.md, CLAUDE.md, .cursorrules, copilot-instructions.md', agent: 'system' }]);
                } else {
                  setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: 'Project Configuration:\n' + getConfigSummary(config), agent: 'system' }]);
                }
              } catch (err) {
                setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: 'Config error: ' + (err as Error).message, agent: 'system' }]);
              }
            } else if (option === 'graph') {
              // Build and show graph - defer to allow UI update
              setMessages(prev => [...prev, { id: nextId(), role: 'user', content: '/index graph' }]);
              setLoading(true);
              setLoadingText('building dependency graph...');
              setTimeout(async () => {
                try {
                  const rootDir = process.cwd();
                  const files = globSync('**/*.{ts,tsx,js,jsx}', {
                    cwd: rootDir,
                    absolute: true,
                    ignore: ['**/node_modules/**', '**/dist/**', '**/build/**']
                  }).slice(0, 500);
                  const structures = parseFiles(files, rootDir);
                  const graph = buildDependencyGraph(structures, rootDir);
                  setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: 'Dependency Graph:\n' + getGraphSummary(graph), agent: 'system' }]);
                } catch (err) {
                  setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: 'Graph error: ' + (err as Error).message, agent: 'system' }]);
                }
                setLoading(false);
              }, 50);
            } else {
              // full or quick index - defer to allow UI update
              const isQuick = option === 'quick';
              setMessages(prev => [...prev, { id: nextId(), role: 'user', content: `/index ${isQuick ? 'quick' : 'full'}` }]);
              setLoading(true);
              setLoadingText(`indexing codebase${isQuick ? ' (quick)' : ' with embeddings'}...`);
              setTimeout(async () => {
                try {
                  const result = await indexCodebase(process.cwd(), { skipEmbedding: isQuick });
                  const summary = getIndexSummary(result);
                  let msg = summary;
                  if (result.config.configFiles.length > 0) {
                    msg += '\n\nProject Config:\n' + getConfigSummary(result.config);
                  }
                  setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: msg, agent: 'system' }]);
                } catch (err) {
                  setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: 'Index error: ' + (err as Error).message, agent: 'system' }]);
                }
                setLoading(false);
              }, 50);
            }
          }}
          onBack={() => setMode('chat')}
        />
      )}

      {/* Edit Review Mode */}
      {mode === 'review' && (
        <DiffReview
          edits={proposedEdits}
          onComplete={(result) => {
            // Log review decision to observation
            if (currentObservationId !== null) {
              // Build final files record from accepted edits
              const finalFiles: Record<string, string> = {};
              for (const edit of proposedEdits) {
                if (result.accepted.includes(edit.filePath) && edit.newContent) {
                  finalFiles[edit.filePath] = edit.newContent;
                }
              }

              logReviewDecision(currentObservationId, {
                acceptedFiles: result.accepted,
                rejectedFiles: result.rejected,
                finalFiles: Object.keys(finalFiles).length > 0 ? finalFiles : undefined
              });

              // Complete observation (saves to memory)
              completeObservation(currentObservationId);
              setCurrentObservationId(null);
              setCurrentAgenticResult(null);
            }

            const summary: string[] = [];
            if (result.accepted.length > 0) {
              summary.push('Applied ' + result.accepted.length + ' file(s)');
            }
            if (result.rejected.length > 0) {
              summary.push('Rejected ' + result.rejected.length + ' file(s)');
            }
            if (result.skipped.length > 0) {
              summary.push('Skipped ' + result.skipped.length + ' file(s)');
            }
            setMessages(prev => [...prev, {
              id: nextId(),
              role: 'assistant',
              content: summary.join(', ') || 'Review complete',
              agent: 'review'
            }]);
            setProposedEdits([]);
            setMode('chat');
            // Reset input to fix cursor issues when returning to chat
            setInput('');
            setInputKey(k => k + 1);
          }}
          onCancel={() => {
            // Log cancellation as full rejection
            if (currentObservationId !== null) {
              const allPaths = proposedEdits.map(e => e.filePath);
              logReviewDecision(currentObservationId, {
                rejectedFiles: allPaths
              });
              completeObservation(currentObservationId);
              setCurrentObservationId(null);
              setCurrentAgenticResult(null);
            }

            setMessages(prev => [...prev, {
              id: nextId(),
              role: 'assistant',
              content: 'Review cancelled',
              agent: 'review'
            }]);
            setProposedEdits([]);
            setMode('chat');
            // Reset input to fix cursor issues when returning to chat
            setInput('');
            setInputKey(k => k + 1);
          }}
        />
      )}

      {/* Chat Mode (also shows compare/collaboration results inline) */}
      {(mode === 'chat' || mode === 'plan' || mode === 'compare' || mode === 'collaboration') && (
        <>
          {/* Messages - hide when active compare/collaboration to prevent terminal scroll */}
          {(mode === 'chat' || mode === 'plan') && (
          <Box flexDirection="column" marginBottom={1} width="100%">
            {messages.map((msg) => (
              msg.role === 'compare' && msg.compareResults ? (
                // Static render for historical compare results (no hooks, no re-renders)
                <Box key={msg.id} flexDirection="column" marginBottom={1} width="100%">
                  {msg.compareResults.map((result, i) => {
                    const isError = !!result.error;
                    const lineLength = Math.floor(((process.stdout.columns || 80) - 2) * 0.8);
                    return (
                      <Box key={i} flexDirection="column" marginBottom={i < msg.compareResults!.length - 1 ? 1 : 0}>
                        <Text color={isError ? 'red' : '#fc8657'}>
                          {'─'.repeat(2)} <Text bold color="#06ba9e">{result.agent}</Text>
                          {isError && <Text color="red"> [FAILED]</Text>}
                        </Text>
                        <Text color={isError ? 'red' : '#fc8657'}>{'─'.repeat(lineLength)}</Text>
                        <Box paddingY={1}>
                          <Text color={isError ? 'red' : undefined} wrap="wrap">
                            {result.content || result.error || 'No response'}
                          </Text>
                        </Box>
                        <Text color={isError ? 'red' : '#fc8657'}>
                          <Text color="green">●</Text>
                          <Text dimColor> {result.duration ? (result.duration / 1000).toFixed(1) + 's' : '-'}</Text>
                        </Text>
                        <Text color={isError ? 'red' : '#fc8657'}>{'─'.repeat(lineLength)}</Text>
                      </Box>
                    );
                  })}
                </Box>
              ) : msg.role === 'collaboration' && msg.collaborationSteps ? (
                // Static render for historical collaboration results
                <CollaborationView
                  key={msg.id}
                  type={msg.collaborationType || 'correct'}
                  steps={msg.collaborationSteps}
                  onExit={() => {}}
                  interactive={false}
                  pipelineName={msg.pipelineName}
                />
              ) : (
                <Box key={msg.id} marginBottom={1}>
                  {msg.role === 'user' ? (
                    <Text>
                      <Text color="green" bold>{'> '}</Text>
                      <Text>{msg.content}</Text>
                    </Text>
                  ) : (
                    <Box flexDirection="column">
                      {/* Tool calls history from exploration */}
                      {msg.toolCalls && msg.toolCalls.length > 0 && (
                        <ToolActivity calls={msg.toolCalls} iteration={0} />
                      )}
                      {msg.agent === 'autopilot' ? (
                        <Text>
                          <Text color="#fc8657">──</Text>
                          <Text bold color="#06ba9e"> {msg.agent} </Text>
                          <Text color="yellow">[Autopilot Mode]</Text>
                          <Text color="#fc8657"> ──</Text>
                        </Text>
                      ) : msg.agent && (
                        <>
                          <Text>
                            <Text dimColor>{'─'.repeat(2)} </Text>
                            <Text bold color="#06ba9e">{msg.agent}</Text>
                            <Text dimColor> </Text>
                            <Text color="#666666">[Single]</Text>
                            <Text dimColor> </Text>
                            <Text color="#888888">{currentAgent === 'auto' ? 'auto' : 'selected'}</Text>
                          </Text>
                          <Text dimColor>{'─'.repeat(Math.floor(((process.stdout.columns || 80) - 2) * 0.8))}</Text>
                        </>
                      )}
                      <Text wrap="wrap">{msg.content}</Text>
                      {msg.agent && msg.agent !== 'autopilot' && (
                        <Box marginTop={1}>
                          <Text color="green">●</Text>
                          <Text dimColor> {msg.duration ? (msg.duration / 1000).toFixed(1) + 's' : '-'}</Text>
                          {msg.tokens && (
                            <Text dimColor> · {msg.tokens.input}↓ {msg.tokens.output}↑</Text>
                          )}
                        </Box>
                      )}
                    </Box>
                  )}
                </Box>
              )
            ))}
          </Box>
          )}

          {/* Compare View (inline) */}
          {mode === 'compare' && (
            <>
              {messages.length > 0 && (
                <Box marginBottom={1}>
                  <Text dimColor>({messages.length} messages hidden - Esc to return to chat)</Text>
                </Box>
              )}
              <CompareView
                key={compareKey}
                results={compareResults}
                onExit={saveCompareToHistory}
              />
            </>
          )}

          {/* Collaboration View (inline) */}
          {mode === 'collaboration' && (
            <>
              {messages.length > 0 && (
                <Box marginBottom={1}>
                  <Text dimColor>({messages.length} messages hidden - Esc to return to chat)</Text>
                </Box>
              )}
              <CollaborationView
                key={collaborationKey}
                type={collaborationType}
                steps={collaborationSteps}
                onExit={saveCollaborationToHistory}
                onAction={['consensus', 'debate', 'correct'].includes(collaborationType) ? handleCollaborationAction : undefined}
                pipelineName={pipelineName}
              />
            </>
          )}

          {/* Tool Activity (shows when agent is using tools) */}
          {loading && toolActivity.length > 0 && (
            <ToolActivity calls={toolActivity} iteration={toolIteration} />
          )}

          {/* Permission Prompt (shows when tool needs user approval) */}
          {pendingPermission && (
            <PermissionPrompt
              request={pendingPermission.request}
              onDecision={handlePermissionDecision}
            />
          )}

          {/* Agent Status Line (shows at bottom with timer) */}
          {loading && !pendingPermission && (
            <AgentStatus
              agentName={loadingAgent || 'Agent'}
              isLoading={loading}
              startTime={loadingStartTime}
            />
          )}

          {/* Input - hidden when in collaboration, compare mode, or permission prompt */}
          {mode !== 'collaboration' && mode !== 'compare' && !pendingPermission && (
            <Box borderStyle="round" borderColor="gray" paddingX={1}>
              <Text color="green" bold>{'> '}</Text>
              <TextInput
                key={inputKey}
                value={input}
                onChange={setInput}
                onSubmit={handleSubmit}
                placeholder="Ask anything or describe a task..."
                focus={!showUpdatePrompt}
              />
            </Box>
          )}

          {/* Autocomplete suggestions - aligned with input text (border + padding + "> ") */}
          {mode === 'chat' && autocompleteItems.length > 0 && !loading && (
            <Box flexDirection="column" marginTop={1} marginLeft={4}>
              {autocompleteItems.map((item, i) => {
                const isSelected = i === autocompleteIndex;
                const parts = item.label.split('  ');
                const cmd = parts[0];
                const desc = parts.slice(1).join('  ');
                return (
                  <Box key={item.value}>
                    <Text bold={isSelected} color={isSelected ? '#8CA9FF' : undefined} dimColor={!isSelected}>{cmd}</Text>
                    <Text color={isSelected ? '#8CA9FF' : undefined} dimColor={!isSelected}> - {desc}</Text>
                  </Box>
                );
              })}
              <Box marginTop={1}>
                <Text dimColor>↑↓ navigate · Enter select · Esc cancel</Text>
              </Box>
            </Box>
          )}
        </>
      )}

      {/* Status Bar - hidden in collaboration/compare mode */}
      {mode !== 'collaboration' && mode !== 'compare' && (
        <StatusBar agent={currentAgent} messageCount={messages.length} tokens={tokens} />
      )}
    </Box>
  );
}

export function startTUI() {
  // Disable mouse tracking to prevent escape sequence garbage
  process.stdout.write('\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l');

  render(<App />, { exitOnCtrlC: false });
}
