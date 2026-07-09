# Trinno User Guide — Best Practices

> AI copilot for patent · paper · academic research.

---

## 1. What Trinno Is (and Isn't)

Trinno is an AI research assistant embedded in VS Code. It helps you:

- Search and organize prior art (patents, papers)
- Analyze technical problems using TRIZ (contradictions, S-curves, ideality)
- Write patents and papers incrementally
- Run autonomous research loops (propose → act → evaluate → ratchet)

It **is not** a general-purpose chatbot. It's optimized for structured innovation workflows. Every slash command maps to a concrete output file in your workspace.

---

## 2. Setup

### 2.1 System Dependencies

| Dependency | Required? | Notes |
|---|---|---|
| VS Code ≥ 1.120.0 | Required | Install from [code.visualstudio.com](https://code.visualstudio.com) |
| Node.js ≥ 18 | Required | Used by the agent worker process |
| **jj** (Jujutsu) | Required for `/undo` | `brew install jj` (macOS) or [get it here](https://github.com/jj-vcs/jj/releases) |
| npm | Required | Bundled with Node.js |

Check versions:
```bash
node --version    # ≥ 18
jj --version      # (optional, only for undo)
```

### 2.2 Install the Extension

**Option A: Open VSX**  
Search for **Trinno Research Assist** in the Extensions view (`Cmd+Shift+X`) or install from [open-vsx.org](https://open-vsx.org/extension/Open1s/trinno-research).

**Option B: VSIX file**  
```bash
# Build from source
git clone https://github.com/open1s/trinno.git
cd trinno
npm install && npm run compile
npx vsce package    # produces trinno-research-*.vsix
# Install in VS Code: Extensions → ⋮ → Install from VSIX...
```

### 2.3 Model Configuration

Configure an LLM provider. Trinno supports three ways:

**Way 1: VS Code Settings UI** (`Cmd+,` → search "trinno")

| Setting | Example | Description |
|---|---|---|
| `chat.model.provider` | `openai` | `openai`, `anthropic`, or `openai-compatible` |
| `chat.model.name` | `gpt-4o` | Model name string |
| `chat.model.baseUrl` | `https://api.openai.com/v1` | API base URL |
| `chat.model.apiKey` | `sk-...` | API key (stored in VS Code secret storage) |

**Way 2: VS Code `settings.json`**
```json
{
  "chat.model.provider": "openai",
  "chat.model.name": "gpt-4o",
  "chat.model.baseUrl": "https://api.openai.com/v1",
  "chat.model.apiKey": "sk-..."
}
```

**Way 3: BOS config file** (`~/.bos/conf/config.toml`)  

Full example with all available sections:

```toml
[global_model]
model = "gpt-4o"
base_url = "https://api.openai.com/v1"
api_key = "sk-..."

[agent]
max_iterations = 100
timeout_seconds = 30
temperature = 0.7
max_tokens = 4096
circuit_breaker_max_failures = 5
circuit_breaker_cooldown_secs = 30
rate_limit_capacity = 10
rate_limit_window_secs = 60
rate_limit_max_retries = 3
rate_limit_retry_backoff_secs = 5
rate_limit_auto_wait = true

[llm.nvidia]
model = "nvidia/llama-3.1-nemotron-70b-instruct"
base_url = "https://integrate.api.nvidia.com/v1"
api_key = "nv-..."

[llm.openrouter]
model = "anthropic/claude-3-haiku"
base_url = "https://openrouter.ai/api/v1"
api_key = "or-..."

[proxy]
http_proxy = "http://127.0.0.1:9981"
https_proxy = "http://127.0.0.1:9981"

[bus]
mode = "peer"
listen = ["127.0.0.1:7890"]

[logging]
level = "info"

[[mcp.servers]]
name = "my-tool-server"
type = "stdio"
command = "node"
args = ["server.js"]

[[mcp.servers]]
name = "api-server"
type = "http"
url = "http://localhost:3000/mcp"

[[skills_registry.skills]]
name = "awesome-skills"
repo = "https://github.com/user/awesome-skills.git"
ref = "main"
```

Priority: VS Code settings > BOS config.toml. VS Code settings take precedence.

**Supported providers:**

| Provider | `provider` value | Example model |
|---|---|---|
| OpenAI | `openai` | `gpt-4o`, `gpt-4.1`, `o3` |
| Anthropic | `anthropic` | `claude-sonnet-4-20250514` |
| OpenAI-compatible | `openai-compatible` | Any vLLM/Ollama/OpenRouter endpoint |

### 2.4 All VS Code Settings (reference)

Settings are accessible via `Cmd+,` → search for the key, or edit `settings.json` directly.

#### Model (`chat.model.*`)

| Key | Default | Description |
|---|---|---|
| `chat.model.provider` | `openai` | Provider: `openai`, `anthropic`, `openai-compatible` |
| `chat.model.name` | `gpt-4o` | Model name |
| `chat.model.baseUrl` | `https://api.openai.com/v1` | API base URL |
| `chat.model.apiKey` | `""` | API key (VS Code secret storage) |

#### Persona (`chat.persona.*`)

| Key | Default | Description |
|---|---|---|
| `chat.persona.name` | `Research Assistant` | Agent display name in the panel |
| `chat.persona.prompt` | *(long system prompt)* | System prompt defining agent behavior and methodology routing |

Tip: Customize `chat.persona.prompt` to change the agent's methodology preference (e.g., favor SWOT over TRIZ).

#### Streaming (`chat.streaming.*`)

| Key | Default | Description |
|---|---|---|
| `chat.streaming.showThinking` | `true` | Show agent reasoning in chat output |
| `chat.streaming.thinkingFlushInterval` | `200` | Characters buffered before flushing thinking content |

#### Context (`chat.context.*`)

| Key | Default | Description |
|---|---|---|
| `chat.context.autoInject` | `true` | Auto-inject notebook context at conversation start |
| `chat.context.maxCharsPerCell` | `500` | Max characters per notebook cell |
| `chat.context.maxTotalTokens` | `4000` | Max tokens for notebook context budget |

#### History (`chat.history.*`)

| Key | Default | Description |
|---|---|---|
| `chat.history.enabled` | `true` | Persist chat across VS Code sessions |
| `chat.history.maxMessages` | `100` | Max messages kept in history |

#### Tools (`chat.tools.*`)

| Key | Default | Description |
|---|---|---|
| `chat.tools.permissions` | *(all `allow`, only `bash: ask`)* | Per-tool permission: `allow`, `deny`, `ask` |

Permissions control which agent tools auto-execute vs. require your approval. The default is permissive — only `bash` requires consent.

#### Papers & Workspace (`chat.papers.*`, `chat.trpWorkspace`)

| Key | Default | Description |
|---|---|---|
| `chat.papers.outputDir` | `""` | Override download directory. Empty = `<workspace>/.trinno/papers/` or `~/.trinno/papers/`. Tilde expanded. |
| `chat.trpWorkspace` | `""` | Absolute path to TRP workspace root. Empty = auto-detect. Tilde expanded. |
| `chat.papers.unpaywallEmail` | `trinno-research@example.com` | Email for Unpaywall API (free, required by their ToS). |

### 2.5 BOS Config (`~/.bos/conf/config.toml`) — Reference

#### `[global_model]` — Primary LLM

| Key | Default | Description |
|---|---|---|
| `model` | `gpt-4o` | Model identifier |
| `base_url` | `https://api.openai.com/v1` | API endpoint |
| `api_key` | `""` | API key (falls back to `OPENAI_API_KEY` env) |

#### `[llm.<name>]` — Per-provider overrides

Create multiple named providers to switch between:

```toml
[llm.nvidia]
model = "nvidia/llama-3.1-nemotron-70b-instruct"
base_url = "https://integrate.api.nvidia.com/v1"
api_key = "nv-..."
```

Keys: same as `[global_model]`.

#### `[agent]` — Execution behavior

| Key | Default | Description |
|---|---|---|
| `max_iterations` | `100` | Max tool-call steps per response |
| `timeout_seconds` | `30` | Per-step timeout in seconds |
| `temperature` | `0.7` | LLM temperature |
| `max_tokens` | `4096` | Max tokens per LLM response |
| `circuit_breaker_max_failures` | *(none)* | Failures before circuit breaker opens |
| `circuit_breaker_cooldown_secs` | *(none)* | Cooldown period |
| `rate_limit_capacity` | *(none)* | Token bucket capacity |
| `rate_limit_window_secs` | *(none)* | Rate limit window size |
| `rate_limit_max_retries` | *(none)* | Max rate-limit retries |
| `rate_limit_retry_backoff_secs` | *(none)* | Backoff between retries |
| `rate_limit_auto_wait` | *(none)* | Auto-wait on rate limit hit |

#### `[proxy]` — HTTP proxy

| Key | Default | Description |
|---|---|---|
| `http_proxy` | *(none)* | HTTP proxy URL |
| `https_proxy` | *(none)* | HTTPS proxy URL |

#### `[bus]` — Inter-agent message bus

| Key | Default | Description |
|---|---|---|
| `mode` | `peer` | Bus mode |
| `connect` | `[]` | Endpoints to connect to |
| `listen` | `[]` | Endpoints to listen on |
| `peer` | *(none)* | Single peer endpoint |

#### `[logging]`

| Key | Default | Description |
|---|---|---|
| `level` | `info` | `debug`, `info`, `warn`, `error` |

#### `[[mcp.servers]]` — MCP tool servers

| Key | Required | Description |
|---|---|---|
| `name` | Yes | Namespace identifier |
| `type` | Yes | `stdio` or `http` |
| `command` | For stdio | Executable path |
| `args` | No | Command arguments |
| `url` | For http | HTTP endpoint URL |

#### `[[skills_registry.skills]]` — Remote skill repos

| Key | Required | Description |
|---|---|---|
| `name` | Yes | Registry name |
| `repo` | Yes | Git repo URL |
| `ref` | No | Branch/tag (default `main`) |
| `description` | No | Human-readable label |
| `repos` | No | Alternative: multiple mirror repos |

The BOS config is read at agent startup. Changes require a VS Code window reload.

### 2.6 First Run

1. Open an **empty folder** in VS Code — this becomes your TRP workspace root
2. Press **`Cmd+Shift+C`** (Mac) / **`Ctrl+Shift+C`** (Windows/Linux) to open the Research Assistant panel
3. The panel appears in the left sidebar. Type `/init` and send
4. `/init` scaffolds all 8 phase directories with starter READMEs

**What you should see:**

Status bar (bottom of VS Code) will show:
- Session identifier
- Agent state (idle or 🔄 Running)
- Token count
- MCP connection status

If the panel doesn't open, check:
- Did you set `chat.model.apiKey`? The agent blocks until configured.
- Reload window (`Cmd+Shift+P` → "Developer: Reload Window")
- Check `~/.trinno/logs/trinno.log` for errors

### 2.7 Verifying It Works

Type a message like:
```
search the top-5 recent papers on triboelectric nanogenerators
```

A successful response will:
1. Show 🔄 Running in the status bar
2. Stream text into the chat panel
3. Create files in `01_Discover/`

If you see an error instead, jump to [Troubleshooting](#10-troubleshooting).

---

## 3. The 8-Phase Workspace

```
01_Discover → 02_TRL → 03_Analyze → 04_Synthesize → 05_Deliver → 06_References → 07_Patent → 08_AutoResearch
```

| Phase | When to use | Output |
|---|---|---|
| **01_Discover** | Starting a new topic. Search patents, papers, prior art. | `papers.md`, `patents.md` |
| **02_TRL** | Evaluating a technology's maturity. | `s_curve.svg`, `trl_assessment.md` |
| **03_Analyze** | Identifying contradictions, Su-Field models. | `contradictions.md`, `su_field_analysis.md` |
| **04_Synthesize** | Generating solutions from analysis results. | `solutions.md`, `roadmap.md` |
| **05_Deliver** | Writing the final research paper. | `paper.md` |
| **06_References** | Storing downloaded papers and citations. | PDFs, `library.md`, `目录.md` |
| **07_Patent** | Drafting a patent incrementally. | `patent.md` |
| **08_AutoResearch** | Autonomous iterative experimentation. | `scope.md`, `eval.md`, `experiments/log_N.md` |

### Best Practice: Phase Discipline

Complete phases in order. Each phase feeds into the next:
- Skip 01_Discover if you already know the prior art
- Skip 02_TRL if maturity isn't relevant
- Always do 03_Analyze before 04_Synthesize (analysis before solutions)

Don't jump to patent drafting without completing prior phases — the agent needs that context.

---

## 4. Slash Commands Reference

### Workspace

| Command | Effect |
|---|---|
| `/init` | Scaffold missing phase directories + READMEs. Safe to re-run (never overwrites). |
| `/goal <text>` | Set a persistent research goal. Agent decomposes it on next message. |
| `/compact` | Compress conversation history to save context window space. |

### Search & Download

| Command | Effect |
|---|---|
| `/search <query>` | Multi-source prior art search (Semantic Scholar, OpenAlex, Google Patents). EN + ZH in parallel. |
| `/download <DOI>` | Download paper by DOI/arXiv/PMID/URL. 9+ sources raced, auto-format detection. |
| `/get <query>` | Search + auto-download the top match. One-step. |
| `/papers` | List all downloaded papers with metadata. |

### TRIZ Analysis

| Command | Effect |
|---|---|
| `/contradiction <param_i> vs <param_j>` | TRIZ contradiction matrix → recommended inventive principles. |
| `/principles list\|<n>\|search <q>` | Browse 40 inventive principles by number or keyword. |
| `/s-curve <topic> <param> <TRL>` | Technology maturity S-curve + Gartner Hype Cycle overlay. Exports SVG. |
| `/ideality <benefits> <costs> <harms>` | Ideality score = B/(C+H). |
| `/su-field <s1> <s2> <field>` | Substance-Field analysis. |

### Writing

| Command | Effect |
|---|---|
| `/patent <title>` | Incremental patent drafting. LLM writes section by section. |
| `/write paper: <title>` | Start a research paper with Typst layout. |

### AutoResearch

| Command | Effect |
|---|---|
| `/auto <hypothesis>` | Start an autonomous research loop. Agent iterates until objective achieved or blocked. |
| `/undo` | Undo the last agent action (jj-based, chainable). |

---

## 5. Workflow Walkthroughs

### 5.1 Patent Drafting

```
/goal 探索固态电解质界面稳定性优化方案
/search 固态电解质 lithium battery    # prior art
/contradiction                         # analyze contradictions
/su-field                              # substance-field model
/s-curve                               # maturity + hype cycle
/download 10.1038/nenergy.2016.141    # key reference
/get interface engineering             # search + auto-download
/patent 一种基于梯度孔隙结构的气体扩散层
```

Best practices:
- Run `/search` before `/patent` — the agent uses search context to ground the patent
- Download key references first — `/patent` enforces real citations
- Let the agent write 1-2 sections per message, review between each
- Use `/undo` if a section goes wrong

### 5.2 Technology Assessment

```
/search 钙钛矿太阳能电池
/s-curve 钙钛矿太阳能电池 转换效率 TRL7
/contradiction 效率 vs 稳定性
/su-field
```

### 5.3 Literature Review

```
/goal 综述事件相机在SLAM中的应用
/search event camera SLAM
/get event camera SLAM survey
/papers                                 # check what we have
# read papers, then ask questions about them
```

---

## 6. AutoResearch Loop Best Practices

### The Loop

```
/auto <hypothesis>
  → Agent reads scope.md + eval.md
  → Writes experiment code to 08_AutoResearch/code/
  → Runs experiment, captures results to 08_AutoResearch/results/
  → Logs to 08_AutoResearch/experiments/log_N.md
  → Auto-chains to next iteration (writes auto_state.json)
  → Stops when objective achieved or blocked
  → Writes 08_AutoResearch/experiments/summary.md
```

### Folder Discipline

```
08_AutoResearch/
├── scope.md              # Research scope (define before starting)
├── eval.md                # Fixed evaluation metric (locked mid-loop)
├── auto_state.json        # Checkpoint — agent writes this to chain
├── code/                  # Scripts only (.py, .sh, .js)
│   └── experiment.py
├── experiments/           # Logs only (no code, no data files)
│   ├── log_1.md
│   ├── log_2.md
│   └── summary.md
├── results/               # Data files (CSV, JSON, charts)
│   └── metrics.csv
└── validation/            # Verification reports
    └── report.md
```

**CRITICAL rules:**
- Code goes in `code/`, not `experiments/`
- Data files go in `results/`, not `experiments/`
- `experiments/` contains ONLY markdown logs and summary
- Agent chains automatically — you don't need to say "go" or re-run `/auto`

### When to Use AutoResearch

Good candidates:
- Optimizing a numeric metric (speed, accuracy, cost)
- Searching a parameter space
- Testing hypotheses with measurable outcomes
- Code optimization / refactoring

Bad candidates:
- Open-ended research questions (use `/goal` instead)
- Tasks requiring human judgment per iteration
- Tasks where each iteration costs significant money (>$1/iter)

### Setting Up scope.md and eval.md

Run `/init` first — it creates templates. Fill them in before running `/auto`:

**scope.md** defines:
- Research question
- Constraints (time, compute, cost)
- Success criteria with metrics and targets
- Which files can be modified (mutation surface)
- Termination conditions

**eval.md** defines:
- Primary metric (name, direction, measurement procedure)
- Secondary metrics
- Validation protocol
- Baseline (current best)
- Accept/reject criteria

---

## 7. Reference Management

`06_References/` is where all downloaded papers live:

```
06_References/
├── library.md             # Index of all references (auto-managed)
├── 目录.md                 # Chinese table of contents
└── papers/
    ├── 10.1038_nenergy.2016.141.pdf
    └── arXiv_2304.12345.pdf
```

### Best Practices

- Use `/get <query>` for one-step search + download
- Use `/download <DOI>` when you know the identifier
- Use `/papers` to list what's downloaded
- The agent enforces real citations: every reference in a patent/paper must exist as a file in `06_References/`
- Update `library.md` with importance ratings after reading papers
- Use `06_References/目录.md` as a living table of contents (add categories manually)

---

## 8. Session & Context Management

### Sessions

- Each conversation is a session. Session name shows in the status bar.
- `Ctrl+N` new session, `Ctrl+Z` delete session
- Sessions persist across VS Code restarts via `chat.history.enabled`

### Context Window

- The agent auto-injects workspace files via `@` references
- Long conversations trigger `/compact` to summarize history
- Set `chat.context.maxTotalTokens` to control context budget
- Use `@<path>` in messages to reference specific files

### Undo

- `/undo` reverts the last agent action (uses `jj` under the hood)
- Chainable: `/undo` multiple times to step back
- Works best when agent writes files or makes changes

---

## 9. How to Get the Best Results

### Prompting Tips

DO:
- Be specific about what you want ("search 2023-2025 papers on Li-S batteries")
- Provide context upfront ("I'm working on a patent for gradient pore structures")
- Use `/goal` for multi-step research objectives
- Read agent output and refine with follow-ups

DON'T:
- Expect the agent to read your mind — tell it which files to use
- Say "hello" — the agent has zero-tolerance anti-greeting rules, it will respond with a single short sentence
- Ask open-ended "write a paper" without a title — use `/write paper: <title>`

### When to Use What Methodology

| Question type | Routing |
|---|---|
| Technical barrier / invention | TRIZ contradiction |
| New technology / market | S-curve + PEST |
| Clinical / biomedical | PICO → PRISMA |
| Strategy / competitive | SWOT + PEST |
| Evidence synthesis | PRISMA |
| Unknown / unstructured | 5W1H first |

---

## 10. Troubleshooting

### Agent not following instructions
- The system prompt is set in `~/.bos/conf/` and VS Code persona settings
- Check `chat.persona.prompt` in VS Code settings if the agent behaves oddly

### AutoResearch not starting
1. Does `08_AutoResearch/scope.md` and `eval.md` exist? If not, run `/init`
2. Is `auto_state.json` present? Delete it to reset
3. Restart the panel (reload VS Code window) if the worker is stale

### Status shows "🔄 Running" but no output
- The LLM is processing — wait for the first token
- Check network connectivity
- Check API key quota

### Paper download fails
- Try `/get <query>` instead of `/download <DOI>` — it retries multiple sources
- Some publishers block automated downloads; try the arXiv version

---

## 11. Commands Quick Reference

```
Workspace     /init, /goal, /compact
Search        /search <q>, /get <q>, /download <DOI>, /papers
TRIZ          /contradiction, /principles, /s-curve, /ideality, /su-field
Writing       /patent <title>, /write paper: <title>
AutoResearch  /auto <hypothesis>, /undo
Utility       /compact
```

---

## 12. Further Reading

- [README](README.md) — project overview, commands, architecture
- [docs/persona.md](docs/persona.md) — agent persona & methodology routing
- [docs/adr/](docs/adr/) — architectural decision records

---

*Last updated: 2026-07-09*
