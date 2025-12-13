# Changelog

All notable changes to PuzldAI will be documented in this file.

## [Unreleased]

---

## [0.2.84] - 2025-12-13

### Changed
- **Adapter-Specific System Prompts** - Each CLI gets tailored instructions
  - Mistral: Explicit "OUTPUT ```tool blocks as text" instructions
  - Gemini: Reminder to use tool blocks instead of native functions
  - Claude/Codex/Ollama: Standard prompt

- **Mistral Adapter** - Disabled native tools with `--enabled-tools none`
  - Forces Mistral to use our text-based tool format
  - Works with permission system (inconsistent but functional)

### Added
- **Ctrl+S Expand/Collapse** - Toggle expanded tool activity view
  - Normal: 6 calls, 3 lines per result
  - Expanded: 20 calls, 15 lines per result
  - Dynamic hint text "(ctrl+s to expand/collapse)"

### Fixed
- **Tool Call ID Collision** - Each tool call now has unique ID
  - Was: `call_0, call_1` repeating each iteration (caused result mixing)
  - Now: `call_<timestamp>_<random>` (globally unique)
- **Permission Prompt Responsiveness** - Fixed lag on Enter
  - Capture decision value before setImmediate defers execution
  - Use ref to avoid stale closure issues
- **Tool History on Errors** - Tool activity now saved even when response fails
- **Pattern Display in Permission Prompt** - Glob patterns now show correctly
  - Was: Empty path for glob/grep tools
  - Now: Shows pattern like `**/*.md`
- Tool-specific titles in permission prompt (Search files, Search content, etc.)

---

## [0.2.83] - 2025-12-13

### Changed
- **Permission Prompt UX Improvements**
  - Vertical selection with arrow keys (↑↓) instead of keyboard shortcuts
  - Selection color matches dropdown menu (#8CA9FF)
  - Input box hidden when permission prompt is shown
  - Esc to cancel, Enter to confirm

- **Tool Activity Display Refresh**
  - Removed emojis, uses colored status dots (● green/yellow/red/gray)
  - Tool names in white, targets in default color
  - Tree characters (│ └) for result hierarchy
  - Shows truncated results with "(ctrl+s to expand)" hint
  - Read, Glob, Grep, Bash, Write, Update action labels

- **Tool Name Aliasing** - LLM-agnostic tool resolution
  - Maps common LLM tool names to our tools (read_file→view, find→glob, shell→bash)
  - Argument normalization (file_path→path, cmd→command)
  - Works with Claude, Gemini, and other LLMs' naming conventions

### Added
- **Agent Status Line** - Live execution status like Claude Code
  - `src/tui/components/AgentStatus.tsx` - Status component
  - Shows agent name, live elapsed timer, token count
  - "esc to interrupt" hint during execution

- **Tool History Persistence** - Tool activity persists in message history
  - `toolCalls` field added to Message interface
  - Tool calls saved with response message for history display

### Fixed
- Gemini now works properly with permission system via system prompt instructions
- Tool calls execute sequentially (was parallel, causing UI issues)

---

## [0.2.82] - 2025-12-13

### Added
- **Agentic Tool System** - LLM can explore codebase before proposing changes
  - `src/agentic/tools/` - Tool implementations (view, glob, grep, bash, edit, write)
  - `src/agentic/agent-loop.ts` - Agent loop that runs until LLM finishes
  - Tool call parsing via ```tool JSON blocks (universal for all adapters)
  - Background tool activity display during agent exploration

- **Permission System** - User approval for file operations (like Claude Code)
  - `src/agentic/tools/permissions.ts` - PermissionTracker with auto-approval
  - `src/tui/components/PermissionPrompt.tsx` - Permission prompt UI
  - `src/tui/components/ToolActivity.tsx` - Background tool activity display
  - Options: Allow, Allow all in directory, Allow all reads, Deny, Cancel
  - Arrow key navigation, Enter to select, Esc to cancel
  - Input box hidden when permission prompt is shown

---

## [0.2.81] - 2025-12-13

### Changed
- **Intelligent Routing** - LLM now decides how to respond (like Claude Code)
  - Direct answers for questions/explanations
  - JSON file edit proposals for code tasks (enters review mode)
  - Clarifying questions for complex/unclear tasks
  - Removed forced Plan/Build mode toggle
  - Removed `/mode` command
  - Updated help text to reflect new behavior

### Removed
- Plan/Build mode system (replaced by intelligent routing)
- `/mode` command from autocomplete suggestions
- Mode indicator under input

---

## [0.2.80] - 2025-12-13

### Added
- **Phase 13: Chat Orchestrator** - Intelligent context assembly for all chat modes
  - `src/chat/index.ts` - Main orchestrator with history, memory, code context injection
  - `src/chat/compare.ts` - Compare mode with implicit preference tracking
  - `src/chat/debate.ts` - Debate mode with winner detection from user continuations
  - `src/chat/pipeline.ts` - Pipeline orchestrator for multi-step workflows
  - Auto-summarization for long conversation histories
  - Scaffolding support for very large contexts (>15k tokens)

- **Plan/Build Mode System** - Two-mode workflow for task execution
  - **Plan Mode** (default): Analyzes task, describes approach without file changes
  - **Build Mode**: Proposes actual file edits with diff review
  - `/mode` command to toggle between modes
  - Mode indicator under input: `Mode: Plan · /mode to switch`
  - Mode change notification with visual feedback
  - `runPlanMode()` and `runBuildMode()` internal functions

- **Implicit Preference Learning** - Learn from user behavior
  - `src/memory/signals.ts` - Preference signal detection
  - `recordComparePreference()` - Detect which agent user prefers after /compare
  - `recordDebateWinner()` - Detect winning arguments after /debate
  - Semantic similarity matching for implicit signals
  - Explicit preference detection ("I prefer Claude's approach")

- **Collaboration View Enhancements**
  - Post-completion action menu: Build / Continue / Reject
  - Vertical action menu layout with keyboard navigation
  - Auto-show actions when viewing synthesis/conclusion
  - Ctrl+E to re-enter last collaboration from chat history
  - Historical collaboration results display as compact summary boxes

### Changed
- Default input now routes through Plan mode (not direct chat)
- Removed `/plan`, `/build`, `/agentic`, `/review` commands (replaced by mode system)
- Escape during collaboration loading = go back to chat (keep results)
- Ctrl+C during collaboration loading = cancel operation
- Simplified autocomplete with `/mode` at top of command list
- Improved keyboard handling - navigation keys don't interfere with typing
- Updated help text with Plan/Build workflow explanation

### Fixed
- Duplicate message issue when re-entering collaboration via Ctrl+E
- Action menu no longer intercepts arrow keys when not shown
- Cursor/input state properly reset when returning to chat from collaboration

---

## [0.2.75] - 2025-12-12

### Added
- **Phase 12: Codebase Indexing** - Semantic code search and context injection
  - `src/indexing/ast-parser.ts` - TypeScript/JavaScript AST parsing with ts-morph
  - `src/indexing/dependency-graph.ts` - File relationship graph with tsconfig path alias support
  - `src/indexing/embedder.ts` - Embeds code to Phase 11 memory store with content hashing
  - `src/indexing/searcher.ts` - Multi-strategy search (semantic + FTS5 + structure)
  - `src/indexing/config-detector.ts` - AGENTS.md and project config detection
  - `src/indexing/index.ts` - Unified `indexCodebase()` orchestrator
  - CLI: `puzld index [path]` with options: `--quick`, `--search`, `--context`, `--config`, `--graph`
  - TUI: `/index` panel with Full/Quick/Search options
  - Auto-injects AGENTS.md into agentic prompts (enabled by default)
  - Supports: AGENTS.md, CLAUDE.md, .cursorrules, copilot-instructions.md

### Changed
- `runAgentic()` now auto-injects project instructions via `autoInjectInstructions` option
- `wrapPromptWithMemory()` supports `autoInjectInstructions`, `autoSearchCode`, `codeMaxTokens`
- Autocomplete now supports exact-match execution (e.g., `/index` executes immediately)
- Added `IndexPanel` component for TUI index options

---

## [0.2.74] - 2025-12-11

### Added
- **Phase 10: Observation Layer** - Log all interactions for training data
  - `src/observation/logger.ts` - Lifecycle logging (start → response → review → complete)
  - `src/observation/diff-tracker.ts` - Track user edits with unified diff format
  - `src/observation/preference-extractor.ts` - Generate DPO training pairs
  - `src/observation/exporter.ts` - Export to JSONL/JSON/CSV formats
  - SQLite `observations` table via migration (schema v2)
  - Captures: prompts, injected context, responses, proposed files, accepted/rejected decisions, user edits
  - Auto-saves accepted decisions and conversations to memory store (Phase 11 bridge)

### Changed
- `/agentic` command now logs full interaction lifecycle for training data generation
- DiffReview completion logs review decisions to observations table
- README rewritten: new tagline, architecture diagram, full documentation for Agentic/Memory/Observation features
- Package description updated to reflect framework evolution beyond CLI wrapper

---

## [0.2.73] - 2025-12-11

### Added
- **Phase 11: Memory/RAG** - Semantic retrieval for context injection
  - `src/memory/embeddings.ts` - Ollama embeddings with FTS5 fallback
  - `src/memory/vector-store.ts` - SQLite FTS5 + optional LanceDB for vector search
  - `src/memory/retriever.ts` - High-level search with scoring and filtering
  - `src/memory/injector.ts` - Format context for XML (Claude) or Markdown (others)
  - Memory types: conversation, code, decision, pattern, context
  - Auto-detects Ollama embedding models (nomic-embed-text, mxbai-embed, all-minilm)
  - Zero new required dependencies (FTS5 built into SQLite)

### Changed
- `wrapPromptWithMemory()` auto-retrieves relevant context from memory store
- Memory index updated with new RAG exports

---

## [0.2.72] - 2025-12-11

### Added
- **Phase 9.2: Agentic Execution Layer** - PuzldAI as execution layer, LLMs propose JSON
  - `src/agentic/prompt-wrapper.ts` - Wraps tasks with JSON format instructions + context injection
  - `src/agentic/response-parser.ts` - Extracts JSON from LLM responses with fallback strategies
  - `src/agentic/edit-extractor.ts` - Converts AgenticResponse to ProposedEdit[]
  - `src/agentic/file-executor.ts` - Applies file changes (create/edit/delete)
  - `src/agentic/index.ts` - Main orchestrator: prompt → LLM → parse → extract
  - `/agentic <task>` command [EXPERIMENTAL] - Review file edits with any agent
  - Auto-injects file contents mentioned in task (10KB limit per file)
  - Dynamic diff view height based on terminal size

### Changed
- Added `disableTools` flag to `RunOptions` for agentic mode
- Claude adapter: `--tools ''` to disable native tools
- Codex adapter: `--sandbox read-only` to disable native tools
- Mistral/Gemini/Ollama adapters: documented tool limitations
- DiffReview now uses terminal height for better diff display
- Extended `ProposedEdit` to support 'Delete' operation

---

## [0.2.71] - 2025-12-11

### Added
- **Phase 9.1: Tool Call Visibility** - Stream parser for Claude CLI JSONL output
  - `StreamParser` class parses `--output-format stream-json --verbose` output
  - Supports multiple tool calls/results per message (parallel tool use)
  - Event types: `init`, `tool_call`, `tool_result`, `text`, `result`, `error`
  - `formatToolCall()` utility for display formatting
  - `getToolIcon()` for tool-specific icons
  - Full test coverage (21 tests)

### Changed
- Claude adapter now uses `StreamParser` for cleaner JSONL parsing
- Added `onToolEvent` callback to `RunOptions` for real-time tool visibility

---

## [0.2.70] - 2025-12-11

### Added
- **Phase 8: SQLite Persistence** - Long-term memory with SQLite database
  - Sessions, messages, and tasks stored in `~/.puzldai/puzldai.db`
  - WAL mode for concurrent access
  - Efficient indexed queries for listing and search
  - Schema versioning for future migrations
  - `initDatabase()`, `getDatabase()`, `closeDatabase()` APIs

### Changed
- Session storage migrated from JSON files to SQLite
- `listSessions()` now uses single query with preview subquery (no N+1)
- `searchSessions()` searches across messages and summaries efficiently

---

## [0.2.69] - 2025-12-11

### Added
- **Phase 7: Dynamic Memory Injection** - Intelligent per-step context assembly
  - Priority-based injection rules (critical → low) with graceful overflow
  - Default rules per step role: `code`, `review`, `analyze`, `fix`, `plan`, `summarize`
  - XML formatting for Claude, Markdown for other agents
  - Role inference from prompt keywords
  - `InjectionRule`, `StepRole`, `InjectionConfig` types

### Changed
- Executor now uses `assembleStepContext()` for smart context assembly before each step
- Steps can define custom `injectionRules` or use defaults based on `role`

---

## [0.2.68] - 2025-12-11

### Fixed
- **Gemini adapter compatibility** - Use `--output-format` instead of `-o` shorthand for older CLI versions

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
