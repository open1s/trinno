# Context

## Project

Trinno is a VS Code extension that adds Typst markup cells to Jupyter notebooks and a Trinno Chat AI assistant sidebar panel.

## Agent Guidelines (CRITICAL)

### Before Modifying Any File
1. Read `.instructions.md` for task decomposition rules
2. Read `.agent.md` for operational heuristics
3. Check `AGENTS.md` for project structure details

### Non-Negotiable Rules
- **Never rewrite files**: Use incremental edits or multi_replace_string_in_file
- **Never ignore compilation**: `npm run compile` must succeed before testing
- **Never touch these**: `node_modules/`, `dist/`, `tride/`, `.git/`
- **Always verify changes**: After edits, run `npm run compile` + relevant tests

### Task Decomposition (Prevent Timeout)
For multi-file work:
1. Analyze state (read files in parallel)
2. State 3-step plan (no implementation yet)
3. Execute one file at a time, verifying between each

## Domain model

### Core concepts

- **Notebook Context**: auto-extracted snapshot of the active notebook's cells (one per cell, truncated at `maxCharsPerCell`). Used as implicit prompt prefix.
- **Attachment**: user-initiated context injection via Send Selection / Send Current File / Choose File. Each attachment is either **inlined** (full content embedded in message) or sent as a **file reference** (the LLM uses `read_file` tool to fetch content on demand).
- **File Reference**: a lightweight attachment format consisting of a workspace-relative path, line range, and a short preview (~200 chars / 3-5 lines). Triggers the LLM's `read_file` tool for full content.
- **Hybrid Attachment Strategy**: content ≤ `maxCharsPerAttachment` is inlined; larger content is sent as a file reference + preview. Whole notebooks are always sent as references with cell-header previews.
- **Session**: a chat conversation with persisted message history. Attachments in history store reference + preview, not full content.
- **Compaction**: summarization of conversation history into a `systemSummary` appended to the system prompt when the context window fills up.
- **BOS Worker**: external process (spawned via stdio) handling LLM streaming, tool orchestration, and skill execution. Communicates with the extension via JSON messages.
- **Skill**: a markdown-based agent instruction loaded from `~/.trinno/skills/` or the BOS skills directory. Activated via slash commands.
- **Tool Permission**: per-tool allow/ask/deny policy controlling which BOS tools require user approval before execution.

### Message flow

```
User input → Webview (chat.js) → Extension (panel.ts) → Agent (agent.ts) → BOS Worker (worker.ts) → LLM API
                                                                                  ↑
                                                                         read_file tool
                                                                         (reads workspace files)
```

### Attachment pipeline

```
User clicks "Send Selection" / "Send File" / "Choose File"
  → Extension extracts content (context.ts)
  → If ≤ threshold: inline full content as markdown code block
  → If > threshold: format as file reference + preview with tool hint
  → Posted to webview as chips
  → Webview prepends attachment text to user message
  → Sent to BOS Worker as part of user message
  → LLM calls read_file tool to fetch full content for references
```

## Key decisions

See [docs/adr/](docs/adr/) for architectural decision records.

## Stack

- TypeScript (strict mode, ES2020 target, CommonJS modules)
- VS Code Extension API (`@types/vscode` ^1.120.0)
- BOS (Brain Operating System) framework for LLM orchestration
- EZBOS for tool definitions and DI
- Mocha + @vscode/test-electron for testing