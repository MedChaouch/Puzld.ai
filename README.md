<p align="center">
  <img src="https://raw.githubusercontent.com/MedChaouch/Puzld.ai/main/assets/logo.jpg" width="300" alt="PuzldAI">
</p>

<p align="center">
  <strong>Multi-LLM orchestration with agentic execution, memory, and training data generation.</strong>
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
  <img src="https://img.shields.io/badge/agents-Claude%20%7C%20Gemini%20%7C%20Codex%20%7C%20Ollama%20%7C%20Mistral-purple" alt="agents">
  <img src="https://img.shields.io/badge/models-sonnet%20%7C%20opus%20%7C%20gemini--pro%20%7C%20devstral-orange" alt="models">
</p>

---

> **Beyond CLI wrappers.** PuzldAI is a complete AI orchestration framework — route tasks, execute file edits, build memory, and generate training data.

PuzldAI is a terminal-native framework for orchestrating multiple AI agents. Route tasks to the best agent, compare responses, chain agents in pipelines, or let them collaborate. But that's just the start: **Agentic Mode** lets LLMs propose file edits you review before applying. **Memory/RAG** stores decisions and code for future context. **Observation Layer** logs everything for DPO fine-tuning. One framework that grows with your AI workflow.

---

## Why PuzldAI?

| Problem | Solution |
|---------|----------|
| Claude is great at code, Gemini at research | **Auto-routing** picks the best agent |
| Need specific model versions | **Model selection** — pick sonnet, opus, haiku, etc. |
| Want multiple opinions | **Compare mode** runs all agents in parallel |
| Complex tasks need multiple steps | **Pipelines** chain agents together |
| Repetitive workflows | **Workflows** save and reuse pipelines |
| Need agents to review each other | **Collaboration** — correct, debate, consensus |
| Want LLM to edit files safely | **Agentic mode** — propose, review, apply |
| Context gets lost between sessions | **Memory/RAG** — semantic retrieval of past decisions |
| Need data to fine-tune models | **Observations** — export DPO training pairs |

---

## Features

- **Auto-routing** — Ask anything. The right agent answers.
- **Model Selection** — Pick specific models per agent (sonnet, opus, haiku, etc.)
- **Compare** — Same question, multiple agents, side-by-side.
- **Pipelines** — Chain agents on-the-fly: `gemini:analyze → claude:code` (CLI)
- **Workflows** — Save pipelines as templates, run anywhere (TUI & CLI)
- **Autopilot** — Describe the goal. AI builds the plan.
- **Multi-Agent Collaboration** — Correct, debate, and build consensus across agents.
- **Agentic Mode** — LLMs propose file edits, you review and apply. [EXPERIMENTAL]
- **Memory/RAG** — Semantic retrieval injects relevant context into prompts.
- **Observation Layer** — Logs all interactions for training data generation.
- **Sessions** — Persist chat history, resume conversations.
- **TUI** — Full terminal UI with autocomplete, history, keyboard nav.

---

## Supported Agents

| Agent | Source | Requirement |
|-------|--------|-------------|
| Claude | Anthropic | [Claude CLI](https://docs.anthropic.com) |
| Gemini | Google | [Gemini CLI](https://ai.google.dev) |
| Codex | OpenAI | [Codex CLI](https://openai.com) |
| Ollama | Local | [Ollama](https://ollama.ai) running |
| Mistral | Mistral AI | [Vibe CLI](https://github.com/mistralai/vibe) |

---

## Install

```bash
npm install -g puzldai
```

Or try without installing:

```bash
npx puzldai
```

**Update:**

```bash
npm update -g puzldai
```

---

## Quick Start

```bash
# Interactive TUI
puzldai

# Single task
puzldai run "explain recursion"

# Compare agents
puzldai compare claude,gemini "best error handling practices"

# Pipeline: analyze → code → review
puzldai run "build a logger" -P "gemini:analyze,claude:code,gemini:review"

# Multi-agent collaboration
puzldai correct "write a sort function" --producer claude --reviewer gemini
puzldai debate "microservices vs monolith" -a claude,gemini
puzldai consensus "best database choice" -a claude,gemini,ollama

# Check what's available
puzldai check
```

> `puzld` also works as a shorter alias.

---

## Interface

<p align="center">
  <img src="https://raw.githubusercontent.com/MedChaouch/Puzld.ai/main/assets/interface/TUI.png" width="700" alt="PuzldAI TUI">
</p>

---

## Execution Modes

| Mode | Pattern | Use Case | Category |
|------|---------|----------|----------|
| **Single** | One agent processes task | Quick questions, simple tasks | Basic |
| **Compare** | Same task → multiple agents in parallel | See different perspectives | Parallel |
| **Pipeline** | Agent A → Agent B → Agent C | Multi-step processing | Sequencing |
| **Workflow** | Saved pipeline, reusable | Repeatable workflows | Sequencing |
| **Autopilot** | LLM generates plan → executes | Complex tasks, unknown steps | AI Planning |
| **Correct** | Producer → Reviewer → Fix | Quality assurance, code review | Collaboration |
| **Debate** | Agents argue in rounds, optional moderator | Find flaws in reasoning | Collaboration |
| **Consensus** | Propose → Vote → Synthesize | High-confidence answers | Collaboration |
| **Agentic** | LLM proposes → User reviews → Apply | File edits with approval | Execution |

### Mode Options

| Mode | Option | Type | Default | Description |
|------|--------|------|---------|-------------|
| Single | `agent` | AgentName | `auto` | Which agent to use |
| | `model` | string | — | Override model (e.g., sonnet, opus) |
| Compare | `agents` | AgentName[] | — | Agents to compare (min 2) |
| | `sequential` | boolean | `false` | Run one-at-a-time vs parallel |
| | `pick` | boolean | `false` | LLM selects best response |
| Pipeline | `steps` | PipelineStep[] | — | Sequence of agent:action |
| | `interactive` | boolean | `false` | Confirm between steps |
| Workflow | `name` | string | — | Workflow to load |
| | `interactive` | boolean | `false` | Confirm between steps |
| Autopilot | `planner` | AgentName | `ollama` | Agent that generates plan |
| | `execute` | boolean | `false` | Auto-run generated plan |
| Correct | `producer` | AgentName | `auto` | Agent that creates output |
| | `reviewer` | AgentName | `auto` | Agent that critiques |
| | `fixAfterReview` | boolean | `false` | Producer fixes based on review |
| Debate | `agents` | AgentName[] | — | Debating agents (min 2) |
| | `rounds` | number | `2` | Number of debate rounds |
| | `moderator` | AgentName | `none` | Synthesizes final conclusion |
| Consensus | `agents` | AgentName[] | — | Participating agents (min 2) |
| | `maxRounds` | number | `2` | Voting rounds |
| | `synthesizer` | AgentName | `auto` | Creates final output |

### Model Selection

Pick specific models for each agent. Aliases like `sonnet`, `opus`, `haiku` always point to the latest version. Specific versions like `claude-sonnet-4-20250514` are pinned.

```bash
# TUI
/model                            # Open model selection panel

# CLI
puzldai model show                # Show current models for all agents
puzldai model list                # List all available models
puzldai model list claude         # List models for specific agent
puzldai model set claude opus     # Set model for an agent
puzldai model clear claude        # Reset to CLI default

# Per-task override
puzldai run "task" -m opus        # Override model for this run
puzldai agent -a claude -m haiku  # Interactive mode with specific model
```

<p align="center">
  <img src="https://raw.githubusercontent.com/MedChaouch/Puzld.ai/main/assets/Models/Model-change.gif" width="700" alt="Model Selection">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/MedChaouch/Puzld.ai/main/assets/Models/model-change.png" width="700" alt="Model Change">
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
puzldai compare "task"                          # Default: claude,gemini
puzldai compare "task" -a claude,gemini,codex   # Specify agents
puzldai compare "task" -s                       # Sequential mode
puzldai compare "task" -p                       # Pick best response
```

<p align="center">
  <img src="https://raw.githubusercontent.com/MedChaouch/Puzld.ai/main/assets/compare-mode/compare-mode-1.gif" width="700" alt="Compare Mode 1">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/MedChaouch/Puzld.ai/main/assets/compare-mode/compare-mode-2.gif" width="700" alt="Compare Mode 2">
</p>

---

## Pipeline Mode (CLI)

Chain multiple agents together for complex tasks. Each agent handles a specific step.

```bash
puzldai run "build a REST API" -P "gemini:analyze,claude:code,gemini:review"
puzldai run "task" -P "claude:plan,codex:code" -i   # Interactive: pause between steps
```

<p align="center">
  <img src="https://raw.githubusercontent.com/MedChaouch/Puzld.ai/main/assets/pipeline-mode/1.png" width="700" alt="Pipeline Mode">
</p>

---

## Workflow Mode

Save pipelines as reusable templates. Run them anywhere with a single command.

Three views: **side-by-side**, **expanded**, or **stacked**.

```bash
# TUI
/workflow code-review "my code here"
/workflows                     # Manage templates (interactive)
/interactive                   # Toggle: pause between steps

# CLI
puzldai run "task" -T code-review
puzldai run "task" -T code-review -i   # Interactive mode
puzldai template list            # List all templates
puzldai template show my-flow    # Show template details
puzldai template create my-flow -P "claude:plan,codex:code"
puzldai template delete my-flow  # Delete template
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

With `/execute` enabled, results display in **3 view modes**: side-by-side, expanded, or stacked.

```bash
# TUI
/autopilot "build a todo app with authentication"
/planner claude                # Set planner agent
/execute                       # Toggle auto-execution on/off

# CLI
puzldai autopilot "task"              # Generate plan only
puzldai autopilot "task" -x           # Generate and execute
puzldai autopilot "task" -p claude    # Use specific agent as planner
```

<p align="center">
  <img src="https://raw.githubusercontent.com/MedChaouch/Puzld.ai/main/assets/autopilot-mode/autopilot-mode.gif" width="700" alt="Autopilot Mode">
</p>

---

## Multi-Agent Collaboration

Get multiple agents to work together through correction, debate, or consensus.

### Correct Mode

One agent produces, another reviews. Optionally fix based on feedback.

```bash
# TUI
/correct claude gemini "write a sorting algorithm"

# CLI
puzldai correct "task" --producer claude --reviewer gemini
puzldai correct "task" --producer claude --reviewer gemini --fix
```

<p align="center">
  <img src="https://raw.githubusercontent.com/MedChaouch/Puzld.ai/main/assets/correct-mode/correct-mode.gif" width="700" alt="Correct Mode">
</p>

### Debate Mode

Agents debate a topic across multiple rounds. Optional moderator summarizes.

```bash
# TUI
/debate claude,gemini "Is functional programming better than OOP?"

# CLI
puzldai debate "topic" -a claude,gemini
puzldai debate "topic" -a claude,gemini -r 3 -m ollama   # 3 rounds + moderator
```

<p align="center">
  <img src="https://raw.githubusercontent.com/MedChaouch/Puzld.ai/main/assets/Debate%20mode/Debate%20mode.png" width="700" alt="Debate Mode">
</p>

### Consensus Mode

Agents propose solutions, vote on them, and synthesize a final answer.

```bash
# TUI
/consensus claude,gemini,ollama "best database for this use case"

# CLI
puzldai consensus "task" -a claude,gemini,ollama
puzldai consensus "task" -a claude,gemini -r 3 -s claude   # 3 rounds + synthesizer
```

<p align="center">
  <img src="https://raw.githubusercontent.com/MedChaouch/Puzld.ai/main/assets/consensus-mode/consensus-mode.png" width="700" alt="Consensus Mode">
</p>

All collaboration modes support **3 view modes**: side-by-side, expanded, and stacked.

Configure rounds, moderator, and synthesizer in `/settings`.

---

## Agentic Mode [EXPERIMENTAL]

Let LLMs propose file edits that you review before applying. PuzldAI acts as the execution layer — the LLM proposes JSON, you decide what gets written.

```bash
# TUI
/agentic "create a hello world script at hello.sh"
/agentic "fix the bug in src/utils.ts"
/agentic "add error handling to api/routes.ts"
```

**How it works:**
1. You describe the task
2. LLM returns structured JSON with file operations (create/edit/delete)
3. You review each proposed change with a diff view
4. Accept, reject, or skip each file individually

**Review controls:**
- `[A]` Accept — Apply this edit
- `[R]` Reject — Skip this edit
- `[S]` Skip — Decide later
- `[Y]` Yes All — Accept all remaining
- `[N]` No All — Reject all remaining
- `←/→` Navigate between files
- `↑/↓` Scroll diff

Files mentioned in your task are automatically injected as context (up to 10KB each).

---

## Memory & Context

PuzldAI includes a memory system that stores conversations, decisions, and code patterns for future retrieval.

**Memory types:**
- `conversation` — Q&A pairs from sessions
- `decision` — Accepted file edits and explanations
- `code` — Code snippets and patterns
- `pattern` — Reusable solutions

**How it works:**
- Observations from `/agentic` are automatically saved to memory
- When you accept file edits, the decision is stored for future context
- Semantic search retrieves relevant memories for new prompts
- Uses SQLite FTS5 (zero dependencies) or Ollama embeddings when available

**Embedding models (auto-detected):**
- `nomic-embed-text` (recommended)
- `mxbai-embed-large`
- `all-minilm`

---

## Observation Layer

All `/agentic` interactions are logged for training data generation:

- **Inputs:** Prompts, injected context, agent/model used
- **Outputs:** LLM responses, proposed files, explanations
- **Decisions:** Which files were accepted/rejected
- **Edits:** User modifications to proposed content

**Export for fine-tuning:**

```typescript
import { exportObservations, exportPreferencePairs } from 'puzldai/observation';

// Export all observations as JSONL
exportObservations({ outputPath: 'observations.jsonl', format: 'jsonl' });

// Export DPO training pairs (chosen vs rejected)
exportPreferencePairs({ outputPath: 'preferences.jsonl', format: 'jsonl' });
```

**DPO pair types:**
- `accept_reject` — User accepted some files, rejected others
- `user_edit` — User modified the LLM's proposed content
- `full_reject` — User rejected all proposed files

---

## Commands

### TUI Mode

```
/compare claude,gemini "task"   Compare agents side-by-side
/autopilot "task"               AI-planned workflow
/workflow code-review "code"    Run saved workflow
/workflows                      Manage templates

/correct claude gemini "task"   Cross-agent correction
/debate claude,gemini "topic"   Multi-agent debate
/consensus claude,gemini "task" Build consensus

/agentic "task"                 [EXPERIMENTAL] Review file edits

/session                        Start new session
/resume                         Resume previous session
/settings                       Open settings panel
/changelog                      Show version history

/agent claude                   Switch agent
/model                          Model selection panel
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
puzldai                           # Launch TUI
puzldai run "task"                # Single task
puzldai run "task" -a claude      # Force agent
puzldai run "task" -m opus        # Override model
puzldai run "task" -P "..."       # Pipeline
puzldai run "task" -T template    # Use template
puzldai run "task" -i             # Interactive: pause between steps
puzldai compare "task"            # Compare (default: claude,gemini)
puzldai compare "task" -a a,b,c   # Specify agents
puzldai compare "task" -s         # Sequential mode
puzldai compare "task" -p         # Pick best response
puzldai autopilot "task"          # Generate plan
puzldai autopilot "task" -x       # Plan + execute
puzldai autopilot "task" -p claude # Use specific planner
puzldai correct "task" --producer claude --reviewer gemini
puzldai correct "task" --producer claude --reviewer gemini --fix
puzldai debate "topic" -a claude,gemini -r 3 -m ollama
puzldai consensus "task" -a claude,gemini -r 3 -s claude
puzldai session list              # List sessions
puzldai session new               # Create new session
puzldai check                     # Agent status
puzldai agent                     # Interactive agent mode
puzldai agent -a claude           # Force specific agent
puzldai agent -m sonnet           # With specific model
puzldai model show                # Show current models
puzldai model list                # List available models
puzldai model set claude opus     # Set model for agent
puzldai model clear claude        # Reset to CLI default
puzldai serve                     # API server
puzldai serve -p 8080             # Custom port
puzldai serve -w                  # With web terminal
puzldai template list             # List templates
puzldai template show <name>      # Show template details
puzldai template create <name> -P "..." -d "desc"
puzldai template edit <name>      # Edit template
puzldai template delete <name>    # Delete template
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
    "claude": { "enabled": true, "path": "claude", "model": "sonnet" },
    "gemini": { "enabled": true, "path": "gemini", "model": "gemini-2.5-pro" },
    "codex": { "enabled": false, "path": "codex", "model": "gpt-5.1-codex" },
    "ollama": { "enabled": true, "model": "llama3.2" },
    "mistral": { "enabled": true, "path": "vibe" }
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
        ┌─────────────┼─────────────┐    │
        ▼             ▼             ▼    ▼
 ┌───────────┐ ┌───────────┐ ┌──────────────┐
 │  Router   │ │  Memory   │ │   Agents     │
 │ (Ollama)  │ │  (RAG)    │ │ Claude       │
 └───────────┘ └───────────┘ │ Gemini       │
        │             │      │ Codex        │
        ▼             ▼      │ Ollama       │
 ┌───────────┐ ┌───────────┐ │ Mistral      │
 │ Agentic   │ │Observation│ └──────────────┘
 │ Executor  │ │  Logger   │
 └───────────┘ └───────────┘
        │             │
        ▼             ▼
 ┌───────────┐ ┌───────────┐
 │   Diff    │ │  Export   │
 │  Review   │ │  (DPO)    │
 └───────────┘ └───────────┘
```

---

## Authentication & Privacy

PuzldAI doesn't handle your AI credentials directly. Instead, it orchestrates the official CLI tools you already have installed:

| What PuzldAI Does | What PuzldAI Doesn't Do |
|-------------------|-------------------------|
| Calls `claude`, `gemini`, `codex` binaries | Store your API keys |
| Passes prompts, receives responses | Handle OAuth flows |
| Respects each CLI's auth state | Piggyback on private OAuth clients |

**Why this matters:**

- **No credential exposure** — Your tokens stay with the official CLIs
- **No piggybacking** — We don't borrow OAuth client IDs or reverse-engineer auth endpoints
- **No terms violations** — We use CLIs exactly as their creators intended
- **Always up-to-date** — When CLIs update their auth, you get it automatically
- **Your auth, your control** — Log in once per CLI, PuzldAI just orchestrates

Some tools bypass official CLIs to call APIs directly using piggybacked credentials or unofficial OAuth flows. PuzldAI takes a different approach: we wrap the tools you trust, nothing more.

---

## Development

```bash
git clone https://github.com/MedChaouch/Puzld.ai.git
cd Puzld.ai
bun install
bun run build
npm link
puzldai
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
