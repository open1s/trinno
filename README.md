# Trinno Research Assist

<p align="center">
  <strong>AI-powered TRIZ research assistant for VS Code</strong><br>
  7-phase innovation workflow · patent drafting · paper writing · prior-art search
</p>

<p align="center">
  <a href="https://open-vsx.org/extension/Open1s/trinno-research"><img alt="Open Vsx" src="https://img.shields.io/badge/VS%20Code-Install-blue?logo=visualstudiocode"></a>
  <a href="https://github.com/open1s/trinno/actions"><img alt="CI" src="https://github.com/open1s/trinno/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="License" src="https://img.shields.io/badge/license-MIT-green">
</p>

---

## Why Trinno?

Trinno guides you through a structured 8-phase TRIZ innovation analysis — from discovering prior art to drafting a patent to autonomous iterative research. It integrates an AI research assistant directly into your editor, so you never leave your workflow.

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
| **06_References** | Download & organize references | PDFs, `library.md`, `目录.md` |
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

### Walkthrough: 从零到专利草案

```bash
# 1. 初始化工作区
/init

# 2. 搜索现有技术（中英文并行）
/search 固态电解质 lithium battery

# 3. 深度分析：矛盾矩阵 + 物场模型
/contradiction
/su-field

# 4. 探索发明原理
/principles

# 5. 评估技术成熟度
/s-curve

# 6. 下载相关论文
/get solid-state electrolyte interface stability
/download 10.1038/nenergy.2016.141

# 7. 撰写专利（增量撰写，每轮一节）
/patent 一种基于梯度孔隙结构的气体扩散层
```

### 常规对话

直接在聊天框输入问题，Trinno 会自动选择合适的研究方法：

| 问题类型 | 自动匹配 |
|---|---|
| 技术瓶颈 / 发明问题 | TRIZ 矛盾分析 |
| 战略 / 竞品分析 | SWOT + PEST |
| 循证综合 | PRISMA |
| 临床 / 生物医学 | PICO → PRISMA |
| 新技术 / 市场格局 | PEST → SWOT |
| 模糊问题 | 5W1H 结构化 |

### 快捷操作

| 操作 | 方式 |
|---|---|
| 引用文件 | 输入 `@<路径>` 自动补全 |
| 切换模型 | 点击底部状态栏模型按钮 |
| 管理会话 | 点击底部状态栏会话名，`Ctrl+N` 新建，`Ctrl+Z` 删除 |
| 压缩上下文 | `/compact`（对话过长时使用） |
| 撤销插入 | `Cmd+Shift+Z` |
| 中断生成 | 按 `Esc` 或点击 ■ 按钮 |

### 文件引用

在消息中通过 `@` 引用工作区文件，Trinno 会自动读取文件内容并纳入上下文：

```
请分析 @01_Discover/patents.json 中的专利，找出与 @src/main.py 实现的技术矛盾
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
- **Reference management**: `06_References/目录.md` serves as a living table of contents for all downloaded papers, patents, and datasets

### S-Curve Enhancements

- **Exit lifecycle stage**: technology lifecycle now includes `exit` phase after decline — complete obsolescence with archived knowledge
- **Gartner Hype Cycle overlay**: SVG chart includes a Hype Cycle phase bar below the curve, mapping S-curve stages to Hype Cycle phases (Innovation Trigger → Peak → Trough → Slope → Plateau)
- **PhaseWriter SVG output**: S-curve SVG is automatically saved to `02_TRL/` directory

---

## Configuration

### API

| Setting | Default | Description |
|---|---|---|
| `chat.model.provider` | `openai` | `openai`, `anthropic`, or `openai-compatible` |
| `chat.model.name` | `gpt-4o` | Model name |
| `chat.model.baseUrl` | `https://api.openai.com/v1` | API base URL |
| `chat.model.apiKey` | — | API key (stored in VS Code secrets) |

### Behavior

| Setting | Default |
|---|---|
| `chat.context.autoInject` | `true` |
| `chat.context.maxTotalTokens` | `4000` |
| `chat.streaming.showThinking` | `true` |
| `chat.history.enabled` | `true` |
| `chat.history.maxMessages` | `100` |
| `trinno.chat.trpWorkspace` | auto-detect |

### Advanced: `~/.bos/conf/`

Trinno uses two TOML config files and a skills directory under `~/.bos/`:

```
~/.bos/
├── skills/          # user-installed skills (SKILL.md per sub-directory)
└── conf/            # TOML configuration files
```

#### Skills (`~/.bos/skills/`)

Each skill lives in its own sub-directory with a `SKILL.md` file:

```
~/.bos/skills/
├── incremental_write/
│   └── SKILL.md
```

The `SKILL.md` file must contain a YAML frontmatter block with a `description` field:

```markdown
---
name: my-custom-skill
description: My custom analysis workflow
---

# Skill Instructions

...
```

Skills appear as slash commands (e.g., `/incremental_write`, `/my-custom-skill`) and the LLM can invoke them via the `load_skill` tool.

#### Global SOUL (`~/.bos/skills/SOUL.md`)

Place a `SOUL.md` file at `~/.bos/skills/SOUL.md` to inject core behavioral guidelines into every conversation. This is merged into the system prompt automatically. You can also place a project-level `SOUL.md` in your workspace root — it takes precedence over the global one.

#### BrainOS Core Config (`~/.bos/conf/config.toml`)

BrainOS reads LLM providers, proxy, agent, and logging settings:

```toml
[global_model]
model = "nvidia/minimaxai/minimax-m2.7"
base_url = "http://127.0.0.1:11436/v1"
api_key = "<stored in secrets>"

[llm.nvidia|openai|google|openrouter]
# per-provider model/base_url/api_key overrides

[proxy]
http_proxy = "http://127.0.0.1:9981"
https_proxy = "http://127.0.0.1:9981"

[agent]
max_iterations = 100
timeout_seconds = 30

[logging]
level = "debug"
```

#### Remote Skills (`~/.bos/conf/config.toml`)

Trinno can discover and load skills from remote git repos. Configure one or more repos under `skills_registry.skills`:

```toml
[[skills_registry.skills]]
name = "awesome-journal-skills"
repo = "https://github.com/user/awesome-journal-skills.git"
description = "Journal-specific paper writing skills"
ref = "main"

[[skills_registry.skills]]
name = "scientific-agent-skills"
repo = "https://github.com/user/scientific-agent-skills.git"
description = "Scientific agent workflows"
ref = "main"
```

Each repo is cloned to `.bos/skills-remote/<name>/` and scanned for `SKILL.md` files with YAML frontmatter. Sub-skills are addressed as `<name>/<subpath>`. Use `/find_skill <keyword>` in the chat to search across all configured repos.

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