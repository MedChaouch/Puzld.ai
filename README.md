<p align="center">
  <img src="https://raw.githubusercontent.com/MedChaouch/Puzld.ai/main/assets/logo.jpg" width="300" alt="PuzldAI">
</p>

<p align="center">
  <strong>One CLI. Multiple AI agents. Infinite possibilities.</strong>
</p>

<p align="center">
  <a href="#install">Install</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#features">Features</a> •
  <a href="#configuration">Config</a>
</p>

<p align="center">
  <img src="https://img.shields.io/npm/v/puzldai?color=blue" alt="npm">
  <img src="https://img.shields.io/badge/license-AGPL--3.0-green" alt="license">
  <img src="https://img.shields.io/badge/agents-Claude%20%7C%20Gemini%20%7C%20Codex%20%7C%20Ollama-purple" alt="agents">
</p>

---

> **Stop switching between AI CLIs.** PuzldAI routes your tasks to the right agent automatically — or lets you orchestrate them together.

---

## Why PuzldAI?

| Problem | Solution |
|---------|----------|
| Claude is great at code, Gemini at research | **Auto-routing** picks the best agent |
| Want multiple opinions | **Compare mode** runs all agents in parallel |
| Complex tasks need multiple steps | **Pipelines** chain agents together |
| Repetitive workflows | **Templates** save and reuse pipelines |

---

## Install

```bash
npm install -g puzldai
```

Or try without installing:

```bash
npx puzldai
```

---

## Quick Start

```bash
# Interactive TUI
puzld

# Single task
puzld run "explain recursion"

# Compare agents
puzld compare claude,gemini "best error handling practices"

# Pipeline: analyze → code → review
puzld run "build a logger" -P "gemini:analyze,claude:code,gemini:review"

# Check what's available
puzld check
```

---

## Features

- **Auto-routing** — Ask anything. The right agent answers.
- **Compare** — Same question, multiple agents, side-by-side.
- **Pipelines** — Chain agents on-the-fly: `gemini:analyze → claude:code` (CLI)
- **Workflows** — Save pipelines as templates, run anywhere (TUI & CLI)
- **Autopilot** — Describe the goal. AI builds the plan.
- **TUI** — Full terminal UI with autocomplete, history, keyboard nav.

---

## Supported Agents

| Agent | Source | Requirement |
|-------|--------|-------------|
| Claude | Anthropic | [Claude CLI](https://docs.anthropic.com) |
| Gemini | Google | [Gemini CLI](https://ai.google.dev) |
| Codex | OpenAI | [Codex CLI](https://openai.com) |
| Ollama | Local | [Ollama](https://ollama.ai) running |

---

## Interface

<p align="center">
  <img src="https://raw.githubusercontent.com/MedChaouch/Puzld.ai/main/assets/interface/tui.png" width="700" alt="PuzldAI TUI">
</p>

---

## Compare Mode

Run the same prompt on multiple agents and compare results side-by-side.

Three views: **side-by-side**, **expanded**, or **stacked**.

```bash
# TUI
/compare claude,gemini "explain async/await"
/sequential                    # Toggle: run one-at-a-time
/pick                          # Toggle: select best response

# CLI
puzld compare claude,gemini "task"
puzld compare claude,gemini,codex "task" -s   # Sequential mode
puzld compare claude,gemini "task" -p         # Pick best response
```

<p align="center">
  <img src="https://raw.githubusercontent.com/MedChaouch/Puzld.ai/main/assets/compare-mode/1.png" width="700" alt="Compare Mode 1">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/MedChaouch/Puzld.ai/main/assets/compare-mode/2.png" width="700" alt="Compare Mode 2">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/MedChaouch/Puzld.ai/main/assets/compare-mode/3.png" width="700" alt="Compare Mode 3">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/MedChaouch/Puzld.ai/main/assets/compare-mode/4.png" width="700" alt="Compare Mode 4">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/MedChaouch/Puzld.ai/main/assets/compare-mode/5.png" width="700" alt="Compare Mode 5">
</p>

---

## Pipeline Mode (CLI)

Chain multiple agents together for complex tasks. Each agent handles a specific step.

```bash
puzld run "build a REST API" -P "gemini:analyze,claude:code,gemini:review"
puzld run "task" -P "claude:plan,codex:code" -i   # Interactive: pause between steps
```

<p align="center">
  <img src="https://raw.githubusercontent.com/MedChaouch/Puzld.ai/main/assets/pipeline-mode/1.png" width="700" alt="Pipeline Mode">
</p>

---

## Workflow Mode

Save pipelines as reusable templates. Run them anywhere with a single command.

```bash
# TUI
/workflow code-review "my code here"
/workflows                     # Manage templates (interactive)
/interactive                   # Toggle: pause between steps

# CLI
puzld run "task" -T code-review
puzld template list            # List all templates
puzld template create my-flow -P "claude:plan,codex:code"
```

<p align="center">
  <img src="https://raw.githubusercontent.com/MedChaouch/Puzld.ai/main/assets/workflow-mode/1.png" width="700" alt="Workflow Mode 1">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/MedChaouch/Puzld.ai/main/assets/workflow-mode/2.png" width="700" alt="Workflow Mode 2">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/MedChaouch/Puzld.ai/main/assets/workflow-mode/3.png" width="700" alt="Workflow Mode 3">
</p>

---

## Autopilot Mode

Describe the goal. AI analyzes the task, builds a multi-step plan, and executes it automatically using the best agents for each step.

```bash
# TUI
/autopilot "build a todo app with authentication"
/planner claude                # Set planner agent
/execute                       # Toggle auto-execution on/off

# CLI
puzld plan "task"              # Generate plan only
puzld plan "task" -x           # Generate and execute
puzld plan "task" -p claude    # Use specific agent as planner
```

<p align="center">
  <img src="https://raw.githubusercontent.com/MedChaouch/Puzld.ai/main/assets/autopilot-mode/1.png" width="700" alt="Autopilot Mode 1">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/MedChaouch/Puzld.ai/main/assets/autopilot-mode/2.png" width="700" alt="Autopilot Mode 2">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/MedChaouch/Puzld.ai/main/assets/autopilot-mode/3.png" width="700" alt="Autopilot Mode 3">
</p>

---

## Commands

### TUI Mode

```
/compare claude,gemini "task"   Compare agents
/autopilot "task"               AI-planned workflow
/workflow code-review "code"    Run saved workflow
/workflows                      Manage templates
/agent claude                   Switch agent
/router ollama                  Set routing agent
/planner claude                 Set autopilot planner
/sequential                     Toggle: compare one-at-a-time
/pick                           Toggle: select best from compare
/execute                        Toggle: auto-run autopilot plans
/interactive                    Toggle: pause between steps
/help                           All commands
```

### CLI Mode

```bash
puzld                           # Launch TUI
puzld run "task"                # Single task
puzld run "task" -a claude      # Force agent
puzld run "task" -P "..."       # Pipeline
puzld run "task" -T template    # Use template
puzld compare a,b "task"        # Compare
puzld plan "task"               # Generate plan
puzld plan "task" -x            # Plan + execute
puzld plan "task" -p claude     # Use specific planner
puzld check                     # Agent status
puzld serve                     # API server
puzld agent                     # Interactive agent mode
puzld template list             # List templates
puzld template show <name>      # Show template details
puzld template create <name>    # Create template
puzld template edit <name>      # Edit template
puzld template delete <name>    # Delete template
```

---

## Configuration

`~/.puzldai/config.json`

```json
{
  "defaultAgent": "auto",
  "fallbackAgent": "claude",
  "routerModel": "llama3.2",
  "adapters": {
    "claude": { "enabled": true, "path": "claude" },
    "gemini": { "enabled": true, "path": "gemini" },
    "codex": { "enabled": false, "path": "codex" },
    "ollama": { "enabled": true, "model": "llama3.2" }
  }
}
```

---

## Architecture

```
User Input
    │
    ▼
┌─────────┐     ┌────────────┐     ┌──────────┐
│ CLI/TUI │────▶│ Orchestrator│────▶│ Adapters │
└─────────┘     └────────────┘     └──────────┘
                      │                  │
                      ▼                  ▼
               ┌───────────┐      ┌─────────────┐
               │  Router   │      │ Claude      │
               │ (Ollama)  │      │ Gemini      │
               └───────────┘      │ Codex       │
                                  │ Ollama      │
                                  └─────────────┘
```

---

## Development

```bash
git clone https://github.com/MedChaouch/Puzld.ai.git
cd Puzld.ai
bun install
bun run build
npm link
puzld
```

---

## Contributing

Pull requests welcome! Please ensure your changes pass the build before submitting.

---

## License

**AGPL-3.0-only** — See [LICENSE](./LICENSE)

---

<p align="center">
  <sub>Built by <a href="https://github.com/MedChaouch">Med Chaouch</a></sub>
</p>
