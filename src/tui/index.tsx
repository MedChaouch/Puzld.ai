import React, { useState, useMemo, useEffect } from 'react';
import { render, Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { orchestrate } from '../orchestrator';
import { Banner, WelcomeMessage } from './components/Banner';
import { useHistory } from './hooks/useHistory';
import { getCommandSuggestions } from './components/Autocomplete';
import { StatusBar } from './components/StatusBar';
import {
  buildComparePlan,
  buildPipelinePlan,
  parseAgentsString,
  parsePipelineString,
  execute,
  type AgentName
} from '../executor';
import { listTemplates, loadTemplate } from '../executor/templates';
import { WorkflowsManager } from './components/WorkflowsManager';
import { CompareView } from './components/CompareView';
import { generatePlan } from '../executor/planner';
import { isRouterAvailable } from '../router/router';
import { adapters } from '../adapters';
import {
  getLatestSession,
  addMessage as addSessionMessage,
  listSessions,
  createSession,
  loadSession,
  deleteSession,
  clearSessionHistory,
  getSessionStats,
  type AgentSession
} from '../memory';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'compare';
  content: string;
  agent?: string;
  duration?: number;
  compareResults?: CompareResult[];
}

let messageId = 0;
const nextId = () => String(++messageId);

type AppMode = 'chat' | 'workflows' | 'compare';

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
  useEffect(() => {
    process.stdout.write('\x1b[?1000l\x1b[?1002l\x1b[?1003l');
    return () => {
      process.stdout.write('\x1b[?1000h');
    };
  }, []);

  const [input, setInput] = useState('');
  const [inputKey, setInputKey] = useState(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('thinking...');
  const [mode, setMode] = useState<AppMode>('chat');
  const [compareResults, setCompareResults] = useState<CompareResult[]>([]);
  const [compareKey, setCompareKey] = useState(0); // Increments to reset CompareView state
  const [notification, setNotification] = useState<string | null>(null);
  const [agentStatus, setAgentStatus] = useState<AgentStatus[]>([]);
  const [session, setSession] = useState<AgentSession | null>(null);

  // Value options
  const [currentAgent, setCurrentAgent] = useState('auto');
  const [currentRouter, setCurrentRouter] = useState('ollama');
  const [currentPlanner, setCurrentPlanner] = useState('ollama');

  // Toggle options
  const [sequential, setSequential] = useState(false);
  const [pick, setPick] = useState(false);
  const [executeMode, setExecuteMode] = useState(false);
  const [interactive, setInteractive] = useState(false);

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

  // Load session for current agent
  useEffect(() => {
    const sess = getLatestSession(currentAgent);
    setSession(sess);
    // Restore messages from session
    if (sess.messages.length > 0) {
      const restored: Message[] = sess.messages.map((m, i) => ({
        id: String(i),
        role: m.role === 'system' ? 'assistant' : m.role,
        content: m.content
      }));
      setMessages(restored);
    } else {
      setMessages([]);
    }
    messageId = sess.messages.length;
  }, [currentAgent]);

  // Handle workflow run from WorkflowsManager
  const handleWorkflowRun = async (workflowName: string, task: string) => {
    setMode('chat');
    setMessages(prev => [...prev, { id: nextId(), role: 'user', content: '/workflow ' + workflowName + ' "' + task + '"' }]);
    setLoading(true);
    setLoadingText('running ' + workflowName + '...');

    try {
      const template = loadTemplate(workflowName);
      if (!template) throw new Error('Workflow not found');

      const plan = buildPipelinePlan(task, { steps: template.steps });
      const result = await execute(plan);

      let output = 'Workflow: ' + workflowName + '\n';
      for (const stepResult of result.results) {
        const step = plan.steps.find(s => s.id === stepResult.stepId);
        output += '\n── ' + (step?.agent || 'auto') + ': ' + step?.action + ' ──\n';
        output += (stepResult.content || stepResult.error || 'No output') + '\n';
      }
      setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: output, agent: workflowName }]);
    } catch (err) {
      setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: 'Error: ' + (err as Error).message }]);
    }

    setLoading(false);
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
  });

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

  const handleSubmit = async (value: string) => {
    // Save any active compare to history before processing new input (only if there's actual input)
    if (mode === 'compare' && value.trim()) {
      saveCompareToHistory();
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
    // If multiple matches, select highlighted item (user needs to pick)
    if (autocompleteItems.length > 1) {
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

    // Persist user message to session
    let currentSession = session;
    if (currentSession) {
      currentSession = await addSessionMessage(currentSession, 'user', value);
      setSession(currentSession);
    }

    try {
      const result = await orchestrate(value, { agent: currentAgent });
      const responseContent = result.content || result.error || 'No response';
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
      // Persist assistant message to session
      if (currentSession) {
        currentSession = await addSessionMessage(currentSession, 'assistant', responseContent);
        setSession(currentSession);
      }
    } catch (err) {
      const errorMsg = 'Error: ' + (err as Error).message;
      setMessages(prev => [
        ...prev,
        { id: nextId(), role: 'assistant', content: errorMsg }
      ]);
      // Persist error to session
      if (currentSession) {
        currentSession = await addSessionMessage(currentSession, 'assistant', errorMsg);
        setSession(currentSession);
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

Options:
  /agent [name]     - Show/set agent (claude, gemini, codex, ollama, auto)
  /router [name]    - Show/set routing agent
  /planner [name]   - Show/set autopilot planner agent
  /sequential       - Toggle: compare one-at-a-time
  /pick             - Toggle: select best from compare
  /execute          - Toggle: auto-run autopilot plans
  /interactive      - Toggle: pause between steps

Sessions:
  /session          - Session management help
  /session new      - Start new session
  /session info     - Current session stats
  /sessions [agent] - List all sessions

Utility:
  /help   - Show this help
  /clear  - Clear chat history
  /exit   - Exit

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

      case 'sessions': {
        const allSessions = listSessions(rest || undefined);
        if (allSessions.length === 0) {
          addMessage('No sessions found.');
        } else {
          let output = 'Sessions' + (rest ? ' (' + rest + ')' : '') + ':\n\n';
          allSessions.forEach((s, i) => {
            const date = new Date(s.updatedAt).toLocaleDateString();
            output += (i + 1) + '. ' + s.id + '\n';
            output += '   Agent: ' + s.agent + ' | Messages: ' + s.messageCount + ' | ' + date + '\n';
            output += '   ' + s.preview + '\n\n';
          });
          addMessage(output);
        }
        break;
      }

      case 'session': {
        const subCmd = rest.split(' ')[0];
        const sessionArg = rest.split(' ').slice(1).join(' ');

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

        switch (subCmd) {
          case 'new': {
            const freshSession = createSession(currentAgent);
            setSession(freshSession);
            setMessages([]);
            messageId = 0;
            addMessage('New session created: ' + freshSession.id);
            break;
          }

          case 'load': {
            if (!sessionArg) {
              addMessage('Usage: /session load <session_id>');
              break;
            }
            const loaded = loadSession(sessionArg);
            if (!loaded) {
              addMessage('Session not found: ' + sessionArg);
              break;
            }
            setSession(loaded);
            restoreFromSession(loaded);
            addMessage('Loaded session: ' + loaded.id);
            break;
          }

          case 'delete': {
            if (!sessionArg) {
              addMessage('Usage: /session delete <session_id>');
              break;
            }
            if (deleteSession(sessionArg)) {
              addMessage('Deleted session: ' + sessionArg);
              if (session?.id === sessionArg) {
                const freshSession = createSession(currentAgent);
                setSession(freshSession);
                setMessages([]);
                messageId = 0;
              }
            } else {
              addMessage('Session not found: ' + sessionArg);
            }
            break;
          }

          case 'info': {
            if (!session) {
              addMessage('No active session');
              break;
            }
            const stats = getSessionStats(session);
            addMessage(
              'Session: ' + session.id + '\n' +
              'Agent: ' + session.agent + '\n' +
              'Messages: ' + stats.messageCount + '\n' +
              'Tokens: ' + stats.totalTokens + ' (summary: ' + stats.summaryTokens + ')\n' +
              'Compression: ' + stats.compressionRatio + '%'
            );
            break;
          }

          default:
            addMessage(
              'Session commands:\n' +
              '  /session new        - Start new session\n' +
              '  /session load <id>  - Load a session\n' +
              '  /session delete <id> - Delete a session\n' +
              '  /session info       - Current session info\n' +
              '  /sessions [agent]   - List all sessions'
            );
        }
        break;
      }

      case 'exit':
        process.exit(0);
        break;

      // === VALUE OPTIONS ===
      case 'agent':
        if (rest) {
          setCurrentAgent(rest);
          addMessage('Agent set to: ' + rest);
        } else {
          addMessage('Current agent: ' + currentAgent);
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

          // Build visual compare results
          const visualResults: CompareResult[] = agents.map((agent, i) => {
            const stepResult = result.results.find(r => r.stepId === 'step_' + i);
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
            break;
          }

          const plan = planResult.plan;

          // Format plan display
          let planDisplay = 'Plan: ' + (plan.prompt || task) + '\n\n';
          plan.steps.forEach((step, i) => {
            planDisplay += (i + 1) + '. [' + (step.agent || 'auto') + '] ' + step.action + '\n';
            planDisplay += '   ' + step.prompt.slice(0, 80) + (step.prompt.length > 80 ? '...' : '') + '\n';
          });

          if (executeMode) {
            addMessage(planDisplay + '\nExecuting...', 'autopilot');
            setLoadingText('executing plan...');

            const result = await execute(plan);

            let output = '\nResults:\n';
            for (const stepResult of result.results) {
              const step = plan.steps.find(s => s.id === stepResult.stepId);
              output += '\n── ' + (step?.agent || 'auto') + ': ' + step?.action + ' ──\n';
              output += (stepResult.content || stepResult.error || 'No output') + '\n';
            }
            addMessage(output, 'autopilot');
          } else {
            addMessage(planDisplay + '\nUse /execute to enable auto-execution', 'autopilot');
          }
        } catch (err) {
          addMessage('Error: ' + (err as Error).message);
        }

        setLoading(false);
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

        setMessages(prev => [...prev, { id: nextId(), role: 'user', content: '/workflow ' + wfName + ' "' + task + '"' }]);
        setLoading(true);
        setLoadingText('running ' + wfName + '...');

        try {
          const plan = buildPipelinePlan(task, { steps: template.steps });
          const result = await execute(plan);

          let output = 'Workflow: ' + wfName + '\n';
          for (const stepResult of result.results) {
            const step = plan.steps.find(s => s.id === stepResult.stepId);
            output += '\n── ' + (step?.agent || 'auto') + ': ' + step?.action + ' ──\n';
            output += (stepResult.content || stepResult.error || 'No output') + '\n';
          }
          addMessage(output, wfName);
        } catch (err) {
          addMessage('Error: ' + (err as Error).message);
        }

        setLoading(false);
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
      <Banner agents={agentStatus} />

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

      {/* Chat Mode (also shows compare results inline) */}
      {(mode === 'chat' || mode === 'compare') && (
        <>
          {/* Messages */}
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
              ) : (
                <Box key={msg.id} marginBottom={1}>
                  {msg.role === 'user' ? (
                    <Text>
                      <Text color="green" bold>{'> '}</Text>
                      <Text>{msg.content}</Text>
                    </Text>
                  ) : (
                    <Box flexDirection="column">
                      {msg.agent && (
                        <Text dimColor>── {msg.agent} {msg.duration ? '(' + (msg.duration / 1000).toFixed(1) + 's)' : ''} ──</Text>
                      )}
                      <Text>{msg.content}</Text>
                    </Box>
                  )}
                </Box>
              )
            ))}
          </Box>

          {/* Compare View (inline) */}
          {mode === 'compare' && (
            <CompareView
              key={compareKey}
              results={compareResults}
              onExit={saveCompareToHistory}
              inputValue={input}
            />
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
              placeholder="Type a message or /help"
            />
          </Box>

          {/* Autocomplete suggestions - aligned with input text (border + padding + "> ") */}
          {autocompleteItems.length > 0 && !loading && (
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
      <StatusBar agent={currentAgent} messageCount={messages.length} />
    </Box>
  );
}

export function startTUI() {
  render(<App />);
}
