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
  .command('plan')
  .description('Generate and optionally execute an LLM-planned workflow')
  .argument('<task>', 'The task to plan')
  .option('-x, --execute', 'Execute the plan after generating')
  .option('-p, --planner <agent>', 'Agent to use for planning', 'ollama')
  .action(planCommand);

program
  .command('check')
  .description('Check available agents and dependencies')
  .action(checkCommand);

program
  .command('serve')
  .description('Start the API server')
  .option('-p, --port <port>', 'Port to listen on', '3000')
  .option('-H, --host <host>', 'Host to bind to', '0.0.0.0')
  .option('-w, --web', 'Also start ttyd web terminal')
  .option('-t, --terminal-port <port>', 'Terminal port (default: 3001)')
  .action((opts) => serveCommand({
    port: parseInt(opts.port, 10),
    host: opts.host,
    web: opts.web,
    terminalPort: opts.terminalPort ? parseInt(opts.terminalPort, 10) : undefined
  }));

program
  .command('agent')
  .description('Interactive agent mode')
  .option('-a, --agent <agent>', 'Force specific agent (claude, gemini, codex, ollama)', 'auto')
  .action((opts) => agentCommand({ agent: opts.agent }));

program
  .command('tui')
  .description('Launch interactive terminal UI')
  .action(() => startTUI());

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

// If no arguments, launch TUI; otherwise parse commands
if (process.argv.length <= 2) {
  startTUI();
} else {
  program.parseAsync().then(() => {
    setTimeout(() => process.exit(0), 100);
  });
}
