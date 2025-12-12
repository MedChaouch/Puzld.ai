import React, { useState, useMemo, useEffect, useRef } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { orchestrate } from '../orchestrator';
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
import { CollaborationView, type CollaborationStep, type CollaborationType } from './components/CollaborationView';
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
import { runAgentic, formatFileContext, type AgenticResult } from '../agentic';
import {
  startObservation,
  logResponse,
  logReviewDecision,
  completeObservation
} from '../observation';
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
  compareResults?: CompareResult[];
  collaborationSteps?: CollaborationStep[];
  collaborationType?: CollaborationType;
  pipelineName?: string;
}

let messageId = 0;
const nextId = () => String(++messageId);

type AppMode = 'chat' | 'workflows' | 'sessions' | 'settings' | 'model' | 'compare' | 'collaboration' | 'agent' | 'review' | 'index';

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

  // Double Ctrl+C to exit
  useInput((input, key) => {
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

  // Handle keyboard shortcuts
  useInput((char, key) => {
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
      // Don't intercept Enter - let TextInput handle submit
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
    }
  };

  // Save current collaboration results to history and exit collaboration mode
  const saveCollaborationToHistory = () => {
    if (mode === 'collaboration' && collaborationSteps.length > 0 && !collaborationSteps.some(s => s.loading)) {
      setMessages(prev => [...prev, {
        id: nextId(),
        role: 'collaboration',
        content: '',
        collaborationSteps: collaborationSteps,
        collaborationType: collaborationType,
        pipelineName: collaborationType === 'pipeline' ? pipelineName : undefined
      }]);
      setMode('chat');
      setCollaborationSteps([]);
    }
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

    // Add user message
    setMessages(prev => [...prev, { id: nextId(), role: 'user', content: value }]);
    setInput('');
    setLoading(true);
    setLoadingText('thinking...');

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
      const result = await orchestrate(value, { agent: currentAgent });
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
          duration: result.duration
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
        addMessage(`Commands:
  /compare <agents> <task>  - Compare agents side-by-side
  /autopilot <task>         - AI-generated execution plan
  /workflow <name> <task>   - Run a saved workflow
  /workflows                - Manage workflows (interactive)
  /agentic <task>           - [EXPERIMENTAL] Review file edits (any agent)
  /review <task>            - Review file edits (Claude dry-run mode)
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

      case 'review': {
        // Edit Review Mode - dry-run Claude to capture proposed edits
        if (!rest) {
          addMessage('Usage: /review <task>\nExample: /review "create a hello world script at /tmp/hello.sh"', 'system');
          break;
        }

        const taskMatch = rest.match(/^(?:"([^"]+)"|(.+))$/);
        if (!taskMatch) {
          addMessage('Usage: /review <task>', 'system');
          break;
        }
        const task = taskMatch[1] || taskMatch[2];

        setMessages(prev => [...prev, { id: nextId(), role: 'user', content: '/review "' + task + '"' }]);
        setLoading(true);
        setLoadingText('running dry-run...');

        try {
          const result = await claudeAdapter.dryRun(task);

          if (result.proposedEdits.length === 0) {
            addMessage(result.response.content || 'No file edits proposed.', 'claude');
            setLoading(false);
            break;
          }

          // Show summary of proposed edits (NOT Claude's "permission denied" response)
          const editSummary = result.proposedEdits.map(e =>
            `  ${e.operation}: ${e.filePath}${e.originalContent === null ? ' (new)' : ''}`
          ).join('\n');
          addMessage(`Claude proposed ${result.proposedEdits.length} file edit(s):\n${editSummary}\n\nReview each edit below:`, 'claude');

          // Switch to review mode
          setProposedEdits(result.proposedEdits);
          setMode('review');
          setLoading(false);
        } catch (err) {
          addMessage('Error: ' + (err as Error).message);
          setLoading(false);
        }
        break;
      }

      case 'agentic': {
        // Agentic Mode - LLM proposes JSON, PuzldAI applies files
        if (!rest) {
          addMessage('Usage: /agentic <task>\nExample: /agentic "create a hello world script at /tmp/hello.sh"', 'system');
          break;
        }

        const taskMatch = rest.match(/^(?:"([^"]+)"|(.+))$/);
        if (!taskMatch) {
          addMessage('Usage: /agentic <task>', 'system');
          break;
        }
        const task = taskMatch[1] || taskMatch[2];

        // Get the appropriate adapter based on current agent setting
        const agentName = currentAgent === 'auto' ? 'claude' : currentAgent;
        const adapter = adapters[agentName as keyof typeof adapters];
        if (!adapter) {
          addMessage(`Unknown agent: ${agentName}`, 'system');
          break;
        }

        setMessages(prev => [...prev, { id: nextId(), role: 'user', content: '/agentic "' + task + '"' }]);
        setLoading(true);
        setLoadingText(`running agentic mode with ${agentName}...`);

        try {
          // Extract file paths mentioned in the task and inject their contents
          // Limit to 10KB per file to avoid slow responses
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
                  // Truncate large files
                  files.push({ path: pattern, content: content.slice(0, MAX_FILE_SIZE) + '\n... (truncated)' });
                }
              } catch {
                // Skip unreadable files
              }
            }
          }

          // Start observation logging
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

          // Log response to observation
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
            // Complete observation (no review needed)
            completeObservation(observationId);
            // Show detailed error with raw response hint
            let errorMsg = `Agentic error: ${result.error}`;
            if (result.rawResponse?.content) {
              const preview = result.rawResponse.content.slice(0, 200);
              errorMsg += `\n\nRaw response preview:\n${preview}${result.rawResponse.content.length > 200 ? '...' : ''}`;
            }
            addMessage(errorMsg, agentName);
            setLoading(false);
            break;
          }

          if (!result.proposedEdits || result.proposedEdits.length === 0) {
            // Complete observation (no review needed)
            completeObservation(observationId);
            // Show the explanation if no file edits
            const explanation = result.agenticResponse?.explanation || result.rawResponse.content || 'No file edits proposed.';
            // Add context about what happened
            let hint = '';
            if (!result.agenticResponse) {
              hint = '\n\n(LLM did not return JSON format - showing raw response)';
            } else if (result.agenticResponse.files.length === 0) {
              hint = '\n\n(LLM returned empty files array - no changes proposed)';
            }
            addMessage(explanation + hint, agentName);
            setLoading(false);
            break;
          }

          // Show summary of proposed edits
          const editSummary = result.proposedEdits.map(e =>
            `  ${e.operation}: ${e.filePath}${e.originalContent === null ? ' (new)' : ''}`
          ).join('\n');
          const explanation = result.agenticResponse?.explanation || '';
          addMessage(`${explanation}\n\n${agentName} proposed ${result.proposedEdits.length} file edit(s):\n${editSummary}\n\nReview each edit below:`, agentName);

          // Store observation ID and result for review completion
          setCurrentObservationId(observationId);
          setCurrentAgenticResult(result);

          // Switch to review mode
          setProposedEdits(result.proposedEdits);
          setMode('review');
          setLoading(false);
        } catch (err) {
          addMessage('Error: ' + (err as Error).message);
          setLoading(false);
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
          const plan = buildCorrectionPlan(task, {
            producer: producer as AgentName | 'auto',
            reviewer: reviewer as AgentName | 'auto',
            fixAfterReview: correctFix
          });

          const result = await execute(plan);

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
          const plan = buildDebatePlan(topic, {
            agents: agents as AgentName[],
            rounds: debateRounds,
            moderator
          });

          const result = await execute(plan);

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
          const plan = buildConsensusPlan(task, {
            agents: agents as AgentName[],
            maxRounds: consensusRounds,
            synthesizer: synth
          });

          const result = await execute(plan);

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
          onSelect={async (option) => {
            setMode('chat');
            if (option === 'search') {
              setInput('/index search ');
              setInputKey(k => k + 1);
            } else if (option === 'context') {
              setInput('/index context ');
              setInputKey(k => k + 1);
            } else if (option === 'config') {
              // Show config immediately
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
              // Build and show graph
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
                setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: 'Dependency Graph:\n' + getGraphSummary(graph), agent: 'system' }]);
              } catch (err) {
                setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: 'Graph error: ' + (err as Error).message, agent: 'system' }]);
              }
              setLoading(false);
            } else {
              // full or quick index
              setLoading(true);
              setLoadingText('indexing codebase...');
              try {
                const result = await indexCodebase(process.cwd(), { skipEmbedding: option === 'quick' });
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
          }}
        />
      )}

      {/* Chat Mode (also shows compare/collaboration results inline) */}
      {(mode === 'chat' || mode === 'compare' || mode === 'collaboration') && (
        <>
          {/* Messages - hide when active compare/collaboration to prevent terminal scroll */}
          {mode === 'chat' && (
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
                inputValue={input}
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
                inputValue={input}
                pipelineName={pipelineName}
              />
            </>
          )}

          {/* Loading */}
          {loading && (
            <Box marginBottom={1}>
              <Text color="yellow">● {loadingText}</Text>
            </Box>
          )}

          {/* Input */}
          <Box borderStyle="round" borderColor="gray" paddingX={1}>
            <Text color="green" bold>{'> '}</Text>
            <TextInput
              key={inputKey}
              value={input}
              onChange={setInput}
              onSubmit={handleSubmit}
              placeholder={mode === 'chat' ? "Type a message or /help" : "Type to exit view..."}
              focus={!showUpdatePrompt}
            />
          </Box>

          {/* Autocomplete suggestions - aligned with input text (border + padding + "> ") */}
          {(mode === 'chat' || mode === 'compare' || mode === 'collaboration') && autocompleteItems.length > 0 && !loading && (
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

      {/* Status Bar */}
      <StatusBar agent={currentAgent} messageCount={messages.length} tokens={tokens} />
    </Box>
  );
}

export function startTUI() {
  // Disable mouse tracking to prevent escape sequence garbage
  process.stdout.write('\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l');

  render(<App />, { exitOnCtrlC: false });
}
