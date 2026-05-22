# Typst Cells for Jupyter + Trinno Chat

VS Code extension that adds Typst markup cells to Jupyter notebooks with live SVG preview, plus a TRIZ research assistant sidebar panel.

## Features

### Typst Cells
- Create Typst markup cells in Jupyter notebooks
- Live SVG preview on cell blur
- Syntax highlighting for Typst markup
- Error display for compilation failures
- Tinymist LSP support (falls back to static completions if unavailable)
- Toggle between Typst and Markdown cells

### Trinno Chat Research Assistant
- TRIZ-based research assistant sidebar panel
- Analyzes notebook context and inserts Typst cells autonomously
- Supports OpenAI, Anthropic, and OpenAI-compatible providers
- Streaming responses with optional thinking/reveal
- Persistent chat history across sessions
- Auto-injects notebook context into conversations

## Requirements

- VS Code 1.75.0 or later
- Typst CLI installed on your system

### Installing Typst

```bash
# macOS (Homebrew)
brew install typst

# or via cargo
cargo install typst-cli

# or download from https://typst.app/
```

## Extension Settings

### Typst Cells

| Setting | Default | Description |
|---|---|---|
| `typstCells.enableLivePreview` | `true` | Enable live preview on cell blur |
| `typstCells.compileTimeout` | `30000` | Compilation timeout in ms |
| `typstCells.typstPath` | `"typst"` | Path to typst CLI binary (uses PATH lookup by default) |

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
| `jupyter-typst.changeCellToTypst` | Convert cell to Typst |
| `jupyter-typst.toggleCellLanguage` | Toggle between Typst and Markdown |
| `jupyter-typst.restartLanguageServer` | Restart Tinymist LSP |
| `jupyter-typst.disableTinymistNotebooks` | Disable Tinymist for notebooks |
| `trinno-chat.open` | Open Research Assistant |
| `trinno-chat.undoInsert` | Undo last AI-inserted cell |
| `trinno-chat.clearHistory` | Clear chat history |

## Keybindings

| Keys | Action |
|---|---|
| `Cmd+Shift+C` / `Ctrl+Shift+C` | Open Research Assistant |

## Usage

### Typst Cells
1. Open a Jupyter notebook in VS Code
2. Add a new cell
3. Change cell type to "Typst" from the dropdown
4. Type your Typst markup
5. Leave the cell to see the compiled SVG preview

### Trinno Chat
1. Click the Research Assistant icon in the activity bar
2. Ask questions about your notebook or research topic
3. The assistant can insert Typst cells directly into your notebook

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

- Typst must be installed on the system for compilation
- Large documents may take time to compile
- PDF export uses Jupyter's standard export pipeline
