# Trinno Research Assist

<p align="center">
  <strong>AI copilot for patent · paper · academic research.</strong><br>
  TRIZ enabled workflow · AutoResearch loop · patent drafting · paper drafting
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=Open1s.trinno-research"><img alt="VS Code Marketplace" src="https://img.shields.io/badge/VS%20Code-Install-blue?logo=visualstudiocode"></a>
  <a href="https://github.com/open1s/trinno/actions"><img alt="CI" src="https://github.com/open1s/trinno/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="License" src="https://img.shields.io/badge/license-MIT-green">
</p>

---

## Why Trinno?

Trinno guides you through a structured 8-phase TRIZ innovation analysis — from discovering prior art to drafting a patent/paper to autonomous iterative research. It integrates an AI research assistant directly into your editor, so you never leave your workflow.

### Core workflow

```
01_Discover → 02_TRL → 03_Analyze → 04_Synthesize → 05_Deliver → 06_References → 07_Patent → 08_AutoResearch
```

| Phase | What you do | Output |
|---|---|---|
| **01_Discover** | Search patents, papers, technical solutions | `patents.md`, `papers.md` |
| **02_TRL** | Assess technology maturity & S-curve with Hype Cycle overlay | `s_curve.svg`, `trl_assessment.md` |
| **03_Analyze** | Identify contradictions & ideality gaps | `contradictions.md`, `su_field_analysis.md` |
| **04_Synthesize** | Apply 40 TRIZ inventive principles | `solutions.md`, `roadmap.md` |
| **05_Deliver** | Write research paper | `paper.md` |
| **06_References** | Download & organize references | PDFs, `library.md`, `catalog.md` |
| **07_Patent** | Incrementally draft patent | `patent.md` |
| **08_AutoResearch** | Autonomous iterative research (propose→act→evaluate→ratchet) | `scope.md`, `eval.md`, `experiments/log_N.md` |

---

## Quick Start

1. **Install** from [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Open1s.trinno-research)
2. **Open** a workspace folder — Trinno auto-detects or creates the 8-phase directory structure
3. **Set your API key** in VS Code settings: `chat.model.apiKey`
4. **Open the panel** — click the Research Assistant icon in the activity bar or press `Cmd+Shift+C`
5. **Start with `/init`** to scaffold your project, then `/search <topic>` to find prior art

## Usage

### Walkthrough: Zero to Patent Draft

```bash
# 1. Initialize workspace
/init

# 2. Search prior art (EN + ZH in parallel)
/search solid-state electrolyte lithium battery

# 3. Deep analysis: contradiction matrix + su-field
/contradiction
/su-field

# 4. Explore inventive principles
/principles

# 5. Assess technology maturity
/s-curve

# 6. Download relevant papers
/get solid-state electrolyte interface stability
/download 10.1038/nenergy.2016.141

# 7. Draft patent (incremental, one section per turn)
/patent a gas diffusion layer with gradient pore structure
```

### General Chat

Ask questions directly in the chat — Trinno automatically selects the right research methodology:

| Problem Type | Auto-matched Method |
|---|---|
| Technical bottleneck / Inventive problem | TRIZ contradiction analysis |
| Strategic / Competitor analysis | SWOT + PEST |
| Evidence synthesis | PRISMA |
| Clinical / Biomedical | PICO → PRISMA |
| Emerging tech / Market landscape | PEST → SWOT |
| Undefined problem | 5W1H structured inquiry |

### Quick Actions

| Action | How |
|---|---|
| Reference a file | Type `@<path>` for auto-complete |
| Switch model | Click the model button in the status bar |
| Manage sessions | Click the session name in the status bar, `Ctrl+N` new, `Ctrl+Z` delete |
| Compact context | `/compact` (when conversation gets long) |
| Undo insert | `Cmd+Shift+Z` |
| Interrupt generation | Press `Esc` or click the ■ button |

### File References

Reference workspace files in messages with `@` — Trinno automatically reads the file and includes its content in the context:

```
Please analyze the patents in @01_Discover/patents.json and find the technical contradictions with the technology implemented in @src/main.py
```

---

## Features

### Slash Commands

| Command | Description |
|---|---|
| `/init` | Scaffold 8-phase workspace |
| `/search <query>` | Search patents, papers, and solutions |
| `/contradiction` | TRIZ contradiction matrix analysis |
| `/principles` | Browse 40 inventive principles |
| `/s-curve` | Technology maturity assessment with S-curve + Hype Cycle |
| `/ideality` | Evaluate system ideality |
| `/su-field` | Substance-Field model analysis |
| `/patent <title>` | Incremental patent drafting (LLM-driven, section by section) |
| `/download <DOI>` | Download a paper by DOI / arXiv ID / PMID / URL |
| `/get <query>` | Search & auto-download top match |
| `/papers` | List downloaded papers |
| `/auto <hypothesis>` | Start AutoResearch iteration loop (propose→act→evaluate→ratchet) |
| `/undo` | Undo the last AI prompt (jj-based, supports chained undo) |
| `/goal` | Set, view, and track a persistent research goal |

### AI Research Assistant

- **Multi-methodology**: TRIZ, PRISMA, SWOT, PEST, 5W1H, PICO
- **Multilingual search**: EN + ZH queries in parallel, Chinese journal support
- **Context-aware**: automatically reads your notebook and workspace files
- **Tool-augmented**: file read/write/edit, web search, paper download, bash execution
- **Session management**: persistent chat history, compact summaries, multi-session switching

### Patent & Paper Writing

- **Incremental**: LLM writes section by section (marker-anchored), preventing context overflow
- **Grounded**: uses TRIZ tools (`triz_contradiction`, `triz_principles`, etc.) to base content on real data
- **Controllable**: up to 20 auto-write turns per document, abort at any time
- **Reference enforcement**: every citation must correspond to a real file downloaded to `06_References/` — no phantom references

### AutoResearch Loop (Karpathy Pattern)

- **Iterative research**: propose a hypothesis → modify code/files → evaluate against fixed metric → ratchet (keep or revert)
- **Scope & eval files**: `08_AutoResearch/scope.md` defines the research boundaries; `08_AutoResearch/eval.md` defines the locked evaluation metric
- **Experiment logging**: every iteration is logged to `08_AutoResearch/experiments/log_{N}.md` with hypothesis, before/after metrics, and verdict
- **jj-backed undo**: each iteration is snapshot with jj; failed experiments auto-revert
- **Reference management**: `06_References/catalog.md` serves as a living table of contents for all downloaded papers, patents, and datasets

### S-Curve Enhancements

- **Exit lifecycle stage**: technology lifecycle now includes `exit` phase after decline — complete obsolescence with archived knowledge
- **Gartner Hype Cycle overlay**: SVG chart includes a Hype Cycle phase bar below the curve, mapping S-curve stages to Hype Cycle phases (Innovation Trigger → Peak → Trough → Slope → Plateau)
- **PhaseWriter SVG output**: S-curve SVG is automatically saved to `02_TRL/` directory

---

## Configuration

### Advanced: `~/.bos/conf/`

Trinno uses TOML config files and a skills directory under `~/.bos/`:

```
~/.bos/
├── skills/          # user-installed skills (SKILL.md per sub-directory)
└── conf/            # TOML configuration files
    ├── config.toml   # BrainOS core config
    └── app.toml      # Trinno-specific MCP servers
```

#### BrainOS Core Config (`~/.bos/conf/config.toml`)

```toml
[general]
name = "TRINNO"
version = "1.4.10"
environment = "release"

[global_model]
model = "nvidia/minimaxai/minimax-m2.7"
base_url = "http://127.0.0.1:11436/v1"
api_key = "<stored in secrets>"

# Additional LLM providers
[llm.minimax]
model = "nvidia/minimaxai/minimax-m2.7"
base_url = "https://integrate.api.nvidia.com/v1"
api_key = "<stored in secrets>"

[llm.glm]
model = "nvidia/z-ai/glm-5.2"
base_url = "http://127.0.0.1:11436/v1"
api_key = "<stored in secrets>"

[llm.deepseek]
model = "nvidia/deepseek-ai/deepseek-v4-pro"
base_url = "http://127.0.0.1:11436/v1"
api_key = "<stored in secrets>"

[agent]
max_iterations = 100
timeout_seconds = 30

[proxy]
http_proxy = "http://127.0.0.1:9981"
https_proxy = "http://127.0.0.1:9981"

[logging]
level = "trace"
console = false

[bus]
max_queue_size = 1000

[sandbox]
enabled = false
```

#### Remote Skills (`~/.bos/conf/config.toml`)

Trinno can discover and load skills from remote git repos. Configure repos under `skills_registry.skills`:

```toml
[[skills_registry.skills]]
name = "Awesome-Journal-Scholar-Skills"
description = "Research topic selection, core progress identification, strategy planning, tables and figures specs, replication and data availability prep, submission and revision"
repo = "https://gitee.com/open1s/Awesome-Journal-Skills.git"
ref = "main"

[[skills_registry.skills]]
name = "scientific-agent-skills"
description = "Accelerate Your Research"
repo = "https://gitee.com/open1s/scientific-agent-skills.git"
ref = "main"
```

For repo mirrors or multi-source aggregation, use the `repos` array:

```toml
[[skills_registry.skills]]
name = "multi-source-skills"
repos = [
  "https://github.com/mirror/skills.git",
  "https://gitee.com/mirror/skills.git",
]
description = "Skills aggregated from multiple mirrors"
ref = "main"
```

#### MCP Servers (`~/.bos/conf/app.toml`)

Trinno-specific MCP server definitions. VS Code `chat.mcp.servers` takes precedence over this file.

```toml
[[mcp.servers]]
name = "devel"
type = "stdio"
command = "npx"
args = ["-y", "chrome-devtools-mcp@latest", "--slim", "--headless"]

# stdio servers spawn locally via command + args
# http servers use url instead of command/args
# [[mcp.servers]]
# name = "hello"
# type = "http"
# url = "http://127.0.0.1:8000/mcp"
```

MCP status is shown in the bottom status bar. Connected servers' tools are available to the LLM as regular function calls.

---

## Development

```bash
npm ci
npm run compile     # build to dist/
npm run watch       # incremental build
npm run lint        # eslint
npm run test:pipeline  # fast pipeline tests (no VS Code)
npm run test        # full suite (launches VS Code via @vscode/test-electron)
```

### Project structure

```
src/
  extension.ts       # entry point
  chat/              # sidebar panel, webview, agent process, session storage
  papers/            # paper downloader (9+ sources raced concurrently)
  bos/               # BOS framework: slash commands, TRIZ domain, AI infra
    worker.ts         # agent process (JSON-over-stdio)
    slash-commands/   # /init, /search, /contradiction, /patent, ...
    infrastructure/   # AI tools, config, persistence, search
```

---

## License

MIT © Open1s