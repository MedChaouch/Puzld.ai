# Changelog

All notable changes to PuzldAI will be documented in this file.

## [Unreleased]

---

## [0.2.67] - 2025-12-10

### Added
- **Mistral Vibe CLI adapter** - New agent powered by Devstral models
  - Uses `vibe` CLI with streaming output for fast responses (~1.5s)
  - Available via `/agent mistral` or agent panel
  - Shown in banner status panel
- Mistral tab in Model panel (`/model`)

### Changed
- **Faster adapter responses** via streaming output modes:
  - Mistral: `--output streaming` (~45% faster)
  - Claude: `--output-format stream-json` (~25% faster)
- Updated `/agent` and `/model` help to include mistral

### Fixed
- Mistral adapter no longer passes invalid `--agent` flag for model selection

---

## [0.2.66] - 2025-12-10

### Added
- Double Ctrl+C to exit (first shows warning, second exits)

### Fixed
- Mouse escape sequences no longer pollute terminal after exit (#2)
- Clean terminal cleanup using ink's proper exit handling

---

## [0.2.65] - 2025-12-10

### Added
- User-friendly error messages in Compare and Pipeline views
  - Rate limit: `Rate limited (429) - quota exceeded, try again later or switch model`
  - Timeout: `Timed out after 120s - try a simpler prompt or different model`
  - Auth, network, server errors with actionable hints
- Claude 3 Opus model option (`claude-3-opus-20240229`)

### Changed
- Settings panel reorganized: Config tab now grouped by mode (Pipeline, Compare, Autopilot)
- Collaboration settings merged into single tab (Correct, Debate, Consensus)

### Fixed
- Update prompt no longer reappears after updating (skip file mechanism)

### Removed
- Step confirmation box UI (interactive mode toggle remains)

---

## [0.2.64] - 2025-12-10

### Added
- Token counting for Claude, Gemini, and Codex adapters (footer now shows usage)
  - Claude: Uses `--output-format json` for token extraction
  - Gemini: Uses `-o json` for token extraction
  - Codex: Uses `--json` for JSONL token extraction
- Agent selection panel via `/agent` command (without args)
  - Navigate with arrow keys, Enter to select, Esc to cancel
  - Shows agent status (ready/offline) and current selection

### Fixed
- `/agent X` notification now displays properly (timed 2s notification instead of flickering)

---

## [0.2.63] - 2025-12-10

### Added
- Interactive mode for pipeline/workflow execution (Phase 6)
  - TUI: Enable via `/settings` toggle, shows step confirmation dialog
  - CLI: `--interactive` flag for `puzld run --pipeline/--template` and `puzld autopilot --execute`
  - Options: [Y] Yes, [A] Yes All, [S] Skip, [E] Edit prompt, [X] Abort
- StepConfirmation component with edit-in-place prompt support

### Fixed
- Workflow edit mode now preserves existing steps - exiting without changes no longer shows error

---

## [0.2.62] - 2025-12-10

### Added
- Update check on TUI startup - prompts when newer version available
- Boxed prompt with [U] Update / [S] Skip options
- Auto-publish to npm via GitHub Actions on release

---

## [0.2.6] - 2025-12-09

### Added
- Model selection panel via `/model` command in TUI with tabbed interface
  - Shows aliases as (latest) with specific versions separated below
- CLI commands: `puzld model show/list/set/clear`
- `-m, --model` flag for `run` and `agent` commands
- Syncs default models from agent CLI configs on startup

---

## [0.2.51] - 2025-12-08

### Changed
- Fresh session on startup instead of loading latest (use `/resume` to continue previous)
- First-launch hint shows "Use /resume to continue a previous session" (auto-dismisses after 4s)

---

## [0.2.5] - 2025-12-08

### Added
- "Messages hidden" hint in compare/collaboration modes (shows count + Esc to return)
- Single mode output redesigned to match compare/collaboration style:
  - Teal agent name (`#06ba9e`)
  - Grey lines (0.8 width)
  - `[Single]` chip tag
  - Mode indicator (`auto` or `selected`)
  - Execution time at footer with green status dot

### Fixed
- **5 race conditions identified and fixed:**
  - Stale session capture - now re-fetches session after async operations to prevent cross-agent contamination
  - Compare result lookup - uses Map for O(1) access instead of array find
  - Pipeline memory - `Promise.allSettled` preserves partial results (summary OR keyPoints) on failure
  - Scaffolding - `Promise.allSettled` preserves successful chunk summaries if some fail
  - Executor (2 places) - `Promise.allSettled` preserves batch results when individual steps fail
- Autocomplete dropdown now visible in compare/collaboration modes
- Keyboard handler for autocomplete navigation works in all modes (was disabled in compare/collaboration)

---

## [0.2.4] - 2025-12-08

### Added
- **Phase 5: Scaffolded Context Windows** - RAG-style chunking for large outputs
  - 512-token chunks with 10% overlap (research-backed defaults)
  - Tiered processing: <5k pass, 5-15k summarize, >15k scaffold
  - Code-aware boundary detection (functions/classes/headings/paragraphs)
  - Semantic retrieval via Ollama embeddings (nomic-embed-text)
- "Disabled in config" messaging in `puzldai check` command

### Changed
- Ollama model token limits updated (phi3, qwen2, llama3.2 → 128k)
- Scaffold threshold set to 15,000 tokens (was 50,000)

### Fixed
- Session resume no longer flashes "Session not found" during load

---

## [0.2.3] - 2025-12-08

### Added
- Workflow validation warns when workflow has no steps
- Debate and Consensus mode screenshots in README

### Changed
- Autopilot planner now creates balanced multi-step plans (claude for code, gemini for analysis, codex for review)
- Planner guidelines encourage multi-agent workflows instead of single-agent plans

### Fixed
- Empty workflows no longer cause blank pipeline view
- WorkflowsManager prevents saving workflows with no steps

---

## [0.2.2] - 2025-12-08

### Added
- Pipeline view mode for `/workflow` and `/autopilot` commands
- 3 view modes now available for pipelines (side-by-side, expanded, all)
- Pipeline steps display 3 boxes per row with grid navigation
- Pipeline name shown in header (workflow name or "Autopilot")
- Colored header for autopilot mode (orange dashes, teal agent, yellow mode label)
- Execution Modes reference tables in README

### Changed
- `/workflow` command now uses CollaborationView instead of text output
- `/autopilot` with execute mode now uses CollaborationView for results
- WorkflowsManager runs also use the new pipeline view
- README reorganized with Features and Supported Agents after Why PuzldAI
- All README examples now use `puzldai` as main command (`puzld` as alias)

### Fixed
- Autopilot plan display no longer shows template variables ({{prompt}}, etc.)
- Arrow keys in collaboration/compare mode now navigate boxes instead of command history
- Terminal scrolling no longer occurs when navigating collaboration/compare views

---

## [0.2.1] - 2025-12-08

### Added
- CollaborationView component with 3 view modes (side-by-side, expanded, all)
- Debate mode displays 2 boxes per row with up/down arrow navigation
- Consensus mode displays 3 boxes per row with grid navigation
- Mode labels highlighted in yellow (e.g., "[Correct Mode]", "[Debate Mode]")

### Fixed
- Round counting: setting 2 rounds now correctly shows 2 total (was showing 3)
- Rounds display as 1-based (Round 1, Round 2) instead of 0-based
- Role labels (Producer, Reviewer, etc.) now use teal color matching agent names
- Consensus synthesis prompt now identifies winning proposal before merging

---

## [0.2.0] - 2025-12-07

### Added - Phase 1-4 Complete

#### Token Management Layer (`src/context/tokens.ts`)
- Token estimation using ~4 chars/token standard
- Per-adapter limits (Claude 100k, Gemini 128k, Codex 32k, Ollama 8k)
- Reserve tokens for response budget
- Smart truncation at paragraph/sentence boundaries
- Text chunking for scaffolding support
- Context usage tracking with percentage

#### Summarization Layer (`src/context/summarizer.ts`)
- Zero-cost compression using local Ollama
- Code block preservation (extract → summarize → restore)
- Graceful fallback to truncation if Ollama unavailable
- Skip-if-short optimization
- Key points extraction utility
- Compression ratio metrics

#### Context Window Manager (`src/context/window.ts`)
- Agent-specific context rules (Claude verbose, Ollama minimal)
- Priority-based compression (code priority 8, summaries priority 3)
- Dynamic Ollama model limits (llama3.1=128k, mixtral=32k)
- Structured context tags (`<code_context>`, `<previous_context>`)
- User override via config `maxTokens`

#### Pipeline Memory (`src/executor/memory.ts`)
- Auto-summarized step outputs
- Token-safe variable injection
- Key point extraction for tight budgets
- Memory stats tracking across steps
- Budget-aware output formatting

#### Semantic Relevance Scoring (`src/context/relevance.ts`)
- Embedding-based relevance via Ollama (nomic-embed-text)
- Keyword fallback using Jaccard similarity
- Recency scoring with linear decay
- Configurable weights (embedding vs keyword vs recency)
- `filterByRelevance()` and `getTopRelevant()` utilities

#### Session Manager (`src/memory/sessions.ts`)
- Persistent chat history to `~/.puzldai/sessions/`
- Auto-summarization when token limit reached
- Per-agent session isolation
- Token tracking per session
- Compression ratio stats

#### CLI Session Commands (`src/cli/commands/session.ts`)
- `puzld session list [agent]` — List all sessions
- `puzld session new [agent]` — Create a new session
- `puzld session info <id>` — View session details
- `puzld session delete <id>` — Remove a session
- `puzld session clear <id>` — Clear history, keep session

#### TUI Session Management (`src/tui/components/SessionsManager.tsx`)
- `/session` — Create new session directly
- `/resume` — Interactive picker with arrow navigation
- Menu: All Sessions / Current Agent Sessions
- Session detail view with stats
- Resume, Clear History, Delete actions
- Confirm dialogs default to "No" for safety

#### TUI Settings Panel (`src/tui/components/SettingsPanel.tsx`)
- `/settings` — Open tabbed settings panel
- 6 tabs: Status, Session, Config, Correct, Debate, Consensus
- Tab to cycle, ↑↓ navigate, ←→ change values, Enter/Space toggle

#### Multi-Agent Collaboration (`src/executor/plan-builders.ts`)
- **Cross-Agent Correction** — One agent produces, another reviews, optional fix step
  - CLI: `puzld correct "task" --producer claude --reviewer gemini [--fix]`
  - TUI: `/correct <producer> <reviewer> <task>`
- **Multi-Agent Debate** — Agents argue positions across configurable rounds
  - CLI: `puzld debate "topic" -a claude,gemini [-r 3] [-m ollama]`
  - TUI: `/debate <agents> <topic>`
- **Consensus Building** — Agents propose, vote, and synthesize best solution
  - CLI: `puzld consensus "task" -a claude,gemini,ollama [-r 2] [-s claude]`
  - TUI: `/consensus <agents> <task>`

#### CLI Collaboration Commands (`src/cli/commands/collaboration.ts`)
- `puzld correct` — Cross-agent correction with --producer, --reviewer, --fix
- `puzld debate` — Multi-agent debate with -a agents, -r rounds, -m moderator
- `puzld consensus` — Consensus building with -a agents, -r rounds, -s synthesizer

#### TUI Collaboration Settings
- **Correct tab** — Toggle fix after review
- **Debate tab** — Set rounds (1-5), moderator agent
- **Consensus tab** — Set voting rounds (1-5), synthesizer agent

---

## [0.1.9] - 2025-12-07

### Added
- Auto-migration from `~/.pulzdai` to `~/.puzldai`
- `/planner` command in TUI for autopilot agent selection

### Fixed
- Autopilot error handling for plan result
- Config path consistency (pulzdai → puzldai)

## [0.1.8] - 2025-12-07

### Fixed
- Autopilot error when plan generation fails

## [0.1.7] - 2025-12-07

### Changed
- Config path updated to `~/.puzldai`
- Branding consistency fixes

## [0.1.6] - 2025-12-07

### Added
- `/planner` command in TUI

## [0.1.5] - 2025-12-07

### Added
- Compare mode screenshots
- Interface screenshot
- Dynamic version from package.json

### Fixed
- Logo URL for npm/GitHub display

## [0.1.0] - 2025-12-07

### Added
- Initial release
- Multi-agent orchestration (Claude, Gemini, Codex, Ollama)
- Compare mode with side-by-side, expanded, stacked views
- Pipeline mode for chaining agents
- Workflow mode with reusable templates
- Autopilot mode with AI-planned execution
- TUI with autocomplete and keyboard navigation
- CLI with full command support
- Auto-routing based on task type
