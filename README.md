# Trinno Chat

VS Code extension for TRIZ-based research assistant sidebar panel.

## Features

### Trinno Chat Research Assistant
- TRIZ-based research assistant sidebar panel
- Analyzes notebook context and provides research assistance
- Supports OpenAI, Anthropic, and OpenAI-compatible providers
- Streaming responses with optional thinking/reveal
- Persistent chat history across sessions
- Auto-injects notebook context into conversations

## Requirements

- VS Code 1.75.0 or later

## Extension Settings

### Chat Model

| Setting | Default | Description |
|---|---|---|
| `chat.model.provider` | `"openai"` | AI provider: `openai`, `anthropic`, or `openai-compatible` |
| `chat.model.name` | `"gpt-4o"` | Model name |
| `chat.model.baseUrl` | `https://api.openai.com/v1` | API base URL (for compatible providers) |
| `chat.model.apiKey` | `""` | API key (stored in VS Code secrets) |

### Chat Behavior

| Setting | Default | Description |
|---|---|---|
| `chat.streaming.showThinking` | `true` | Show reasoning/thinking content |
| `chat.context.autoInject` | `true` | Auto-inject notebook context at conversation start |
| `chat.context.maxCharsPerCell` | `500` | Max characters per cell in context |
| `chat.context.maxTotalTokens` | `4000` | Max tokens for notebook context |
| `chat.history.enabled` | `true` | Persist chat history across sessions |
| `chat.history.maxMessages` | `100` | Max messages to retain |

## Commands

| Command | Description |
|---|---|
| `trinno-chat.open` | Open Research Assistant |
| `trinno-chat.undoInsert` | Undo last AI-inserted cell |
| `trinno-chat.clearHistory` | Clear chat history |

## Keybindings

| Keys | Action |
|---|---|
| `Cmd+Shift+C` / `Ctrl+Shift+C` | Open Research Assistant |

## Usage

### Trinno Chat
1. Click the Research Assistant icon in the activity bar
2. Ask questions about your notebook or research topic
3. The assistant can help with your research questions

## Development

```bash
npm install
npm run compile   # build to dist/
npm run watch     # incremental build
npm run test      # runs in VS Code instance via @vscode/test-electron
npm run lint      # eslint (no config yet)
```

> **Note:** `compile` must succeed before `test` — tests run from `dist/`.

## Known Issues

- None reported yet
