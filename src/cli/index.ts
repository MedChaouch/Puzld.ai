#!/usr/bin/env node
import { Command } from 'commander';
import { runCommand } from './commands/run';
import { checkCommand } from './commands/check';
import { serveCommand } from './commands/serve';
import { agentCommand } from './commands/agent';
import { compareCommand } from './commands/compare';
import { planCommand } from './commands/plan';
import {
  templateListCommand,
  templateShowCommand,
  templateCreateCommand,
  templateEditCommand,
  templateDeleteCommand
} from './commands/template';
import {
  sessionListCommand,
  sessionNewCommand,
  sessionInfoCommand,
  sessionDeleteCommand,
  sessionClearCommand
} from './commands/session';
import {
  correctionCommand,
  debateCommand,
  consensusCommand
} from './commands/collaboration';
import {
  modelShowCommand,
  modelListCommand,
  modelSetCommand,
  modelClearCommand
} from './commands/model';
import { indexCommand } from './commands/indexing';
import {
  observeSummaryCommand,
  observeListCommand,
  observeExportCommand
} from './commands/observe';
import {
  loginCommand,
  logoutCommand,
  whoamiCommand
} from './commands/login';
import { startTUI } from '../tui';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8'));

const program = new Command();

program
  .name('puzld')
  .description('PuzldAI - Multi-LLM Orchestrator')
  .version(pkg.version);

program
  .command('run')
  .description('Run a task with the best available agent')
  .argument('<task>', 'The task to execute')
  .option('-a, --agent <agent>', 'Force specific agent (claude, gemini, codex, ollama)', 'auto')
  .option('-m, --model <model>', 'Override model for the agent (e.g., sonnet, opus, gemini-2.5-flash)')
  .option('-P, --pipeline <steps>', 'Run as pipeline (e.g., "gemini:analyze,claude:code")')
  .option('-T, --template <name>', 'Use a saved pipeline template')
  .option('-i, --interactive', 'Prompt before each step in pipeline/template mode')
  .action(runCommand);

program
  .command('compare')
  .description('Compare responses from multiple agents')
  .argument('<prompt>', 'The prompt to send to all agents')
  .option('-a, --agents <agents>', 'Comma-separated agents to compare', 'claude,gemini')
  .option('-s, --sequential', 'Run agents sequentially instead of parallel')
  .option('-p, --pick', 'Have an LLM pick the best response')
  .action(compareCommand);

program
  .command('autopilot')
  .description('Generate and optionally execute an AI-planned workflow')
  .argument('<task>', 'The task to plan')
  .option('-x, --execute', 'Execute the plan after generating')
  .option('-i, --interactive', 'Prompt before each step (requires --execute)')
  .option('-p, --planner <agent>', 'Agent to use for planning', 'ollama')
  .action(planCommand);

program
  .command('check')
  .description('Check available agents and dependencies')
  .action(checkCommand);

program
  .command('serve')
  .description('Start the API server or MCP bridge')
  .option('-p, --port <port>', 'Port to listen on', '3000')
  .option('-H, --host <host>', 'Host to bind to', '0.0.0.0')
  .option('-w, --web', 'Also start ttyd web terminal')
  .option('-t, --terminal-port <port>', 'Terminal port (default: 3001)')
  .option('--mcp', 'Start MCP bridge server instead of API server')
  .option('--mcp-port <port>', 'MCP bridge port (default: 9234)')
  .action((opts) => serveCommand({
    port: parseInt(opts.port, 10),
    host: opts.host,
    web: opts.web,
    terminalPort: opts.terminalPort ? parseInt(opts.terminalPort, 10) : undefined,
    mcp: opts.mcp,
    mcpPort: opts.mcpPort ? parseInt(opts.mcpPort, 10) : undefined
  }));

program
  .command('agent')
  .description('Interactive agent mode')
  .option('-a, --agent <agent>', 'Force specific agent (claude, gemini, codex, ollama)', 'auto')
  .option('-m, --model <model>', 'Override model for the agent')
  .action((opts) => agentCommand({ agent: opts.agent, model: opts.model }));

program
  .command('tui')
  .description('Launch interactive terminal UI')
  .action(() => startTUI());

program
  .command('index [path]')
  .description('Index codebase for semantic search and context injection')
  .option('-q, --quick', 'Quick index (skip embedding)')
  .option('-c, --clear', 'Clear the code index')
  .option('-s, --stats', 'Show index statistics')
  .option('-S, --search <query>', 'Search indexed code')
  .option('-C, --context <task>', 'Get relevant code context for a task')
  .option('--config', 'Show project configuration details')
  .option('-g, --graph', 'Show dependency graph summary')
  .option('-m, --max-files <n>', 'Maximum files to index', '1000')
  .action((path, opts) => indexCommand(path || '.', {
    quick: opts.quick,
    clear: opts.clear,
    stats: opts.stats,
    search: opts.search,
    context: opts.context,
    config: opts.config,
    graph: opts.graph,
    maxFiles: opts.maxFiles ? parseInt(opts.maxFiles, 10) : undefined,
  }));

// Model subcommands
const modelCmd = program
  .command('model')
  .description('Manage model settings');

modelCmd
  .command('show')
  .description('Show current model settings')
  .action(modelShowCommand);

modelCmd
  .command('list [agent]')
  .description('List available models (optionally for specific agent)')
  .action(modelListCommand);

modelCmd
  .command('set <agent> <model>')
  .description('Set model for an agent (e.g., puzld model set claude sonnet)')
  .action(modelSetCommand);

modelCmd
  .command('clear <agent>')
  .description('Clear model override for an agent (use CLI default)')
  .action(modelClearCommand);

// Template subcommands
const templateCmd = program
  .command('template')
  .description('Manage pipeline templates');

templateCmd
  .command('list')
  .description('List all available templates')
  .action(templateListCommand);

templateCmd
  .command('show <name>')
  .description('Show template details')
  .action(templateShowCommand);

templateCmd
  .command('create <name>')
  .description('Create a new template')
  .requiredOption('-P, --pipeline <steps>', 'Pipeline steps (e.g., "claude:plan,codex:code")')
  .option('-d, --description <desc>', 'Template description')
  .action((name, opts, cmd) => templateCreateCommand(name, cmd.opts()));

templateCmd
  .command('edit <name>')
  .description('Edit an existing user template')
  .option('-P, --pipeline <steps>', 'New pipeline steps')
  .option('-d, --description <desc>', 'New description')
  .action((name, opts, cmd) => templateEditCommand(name, cmd.opts()));

templateCmd
  .command('delete <name>')
  .description('Delete a user template')
  .action(templateDeleteCommand);

// Session subcommands
const sessionCmd = program
  .command('session')
  .description('Manage chat sessions');

sessionCmd
  .command('list [agent]')
  .description('List all sessions (optionally filter by agent)')
  .action(sessionListCommand);

sessionCmd
  .command('new [agent]')
  .description('Create a new session')
  .action(sessionNewCommand);

sessionCmd
  .command('info <id>')
  .description('Show session details')
  .action(sessionInfoCommand);

sessionCmd
  .command('delete <id>')
  .description('Delete a session')
  .action(sessionDeleteCommand);

sessionCmd
  .command('clear <id>')
  .description('Clear session history (keep session, remove messages)')
  .action(sessionClearCommand);

// Observe subcommands
const observeCmd = program
  .command('observe')
  .description('Manage and export observations for training');

observeCmd
  .command('summary')
  .description('Show observation summary')
  .option('-a, --agent <agent>', 'Filter by agent')
  .action((opts) => observeSummaryCommand(opts.agent));

observeCmd
  .command('list')
  .description('List recent observations')
  .option('-a, --agent <agent>', 'Filter by agent')
  .option('-n, --limit <n>', 'Number of observations to show', '10')
  .action((opts) => observeListCommand({
    agent: opts.agent,
    limit: opts.limit ? parseInt(opts.limit, 10) : 10
  }));

observeCmd
  .command('export <output>')
  .description('Export observations to file')
  .option('-f, --format <format>', 'Output format (jsonl, json, csv)', 'jsonl')
  .option('-a, --agent <agent>', 'Filter by agent')
  .option('-n, --limit <n>', 'Maximum records to export', '10000')
  .option('-t, --type <type>', 'Export type (observations, preferences)', 'observations')
  .option('--no-content', 'Exclude content (metadata only)')
  .action((output, opts) => observeExportCommand(output, {
    format: opts.format as 'jsonl' | 'json' | 'csv',
    agent: opts.agent,
    limit: opts.limit ? parseInt(opts.limit, 10) : 10000,
    type: opts.type as 'observations' | 'preferences',
    noContent: !opts.content
  }));

// MCP Authentication commands
program
  .command('login')
  .description('Login to PuzldAI MCP server')
  .option('-t, --token <token>', 'API key (pk_xxx) from dashboard')
  .option('-e, --endpoint <url>', 'MCP server endpoint')
  .action((opts) => loginCommand({
    token: opts.token,
    endpoint: opts.endpoint
  }));

program
  .command('logout')
  .description('Logout from PuzldAI MCP server')
  .action(logoutCommand);

program
  .command('whoami')
  .description('Show current login status')
  .action(whoamiCommand);

// Multi-agent collaboration commands
program
  .command('correct')
  .description('Cross-agent correction: one produces, another reviews')
  .argument('<task>', 'The task to execute')
  .requiredOption('--producer <agent>', 'Agent to produce initial output')
  .requiredOption('--reviewer <agent>', 'Agent to review and critique')
  .option('-f, --fix', 'Have producer fix issues after review')
  .action(correctionCommand);

program
  .command('debate')
  .description('Multi-agent debate on a topic')
  .argument('<topic>', 'The topic to debate')
  .requiredOption('-a, --agents <agents>', 'Comma-separated agents to debate')
  .option('-r, --rounds <n>', 'Number of debate rounds', '2')
  .option('-m, --moderator <agent>', 'Agent to synthesize conclusion')
  .action(debateCommand);

program
  .command('consensus')
  .description('Build consensus among multiple agents')
  .argument('<task>', 'The task to reach consensus on')
  .requiredOption('-a, --agents <agents>', 'Comma-separated agents to participate')
  .option('-r, --rounds <n>', 'Number of voting rounds', '2')
  .option('-s, --synthesizer <agent>', 'Agent to synthesize final result')
  .action(consensusCommand);

// If no arguments, launch TUI; otherwise parse commands
if (process.argv.length <= 2) {
  startTUI();
} else {
  program.parseAsync().then(() => {
    setTimeout(() => process.exit(0), 100);
  });
}
