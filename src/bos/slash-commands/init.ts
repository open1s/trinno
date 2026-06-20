import * as fs from 'fs';
import * as path from 'path';
import { SlashCommand } from './registry.js';
import { TrizDeps } from '../infrastructure/config/di.js';

const PHASE_DIRS = [
  '01_Discover',
  '02_TRL',
  '03_Analyze',
  '04_Synthesize',
  '05_Deliver',
  '06_References',
  '07_Patent',
  '08_TData',
] as const;

type PhaseDir = typeof PHASE_DIRS[number];

interface PhaseReadmeContent {
  title: string;
  purpose: string;
  workflow: string[];
  outputFiles: string[];
  extraTitle?: string;
  extraContent: string[];
  notes: string[];
}

const PHASE_README: Record<PhaseDir, PhaseReadmeContent> = {
  '01_Discover': {
    title: '01_Discover — 文献检索与发现',
    purpose: '通过多源检索收集领域相关文献（论文、专利、技术报告），建立证据基础。',
    workflow: [
      '使用 `scansci_pdf_search` / `triz_search` 检索相关文献',
      '使用 `papers_download` / `scansci_pdf_batch_download` 下载全文',
      '将下载的文献保存至 `../06_References/` 目录',
      '更新 `../06_References/library.json` 记录元数据',
    ],
    outputFiles: [
      '`papers.json` — 论文检索结果（含标题、作者、年份、DOI、重要性评分）',
      '`patents.json` — 专利检索结果',
      '`search_queries.md` — 本次检索使用的查询词（便于复现）',
    ],
    extraTitle: '重要性评分标准',
    extraContent: [
      '| 分数 | 含义 |',
      '|------|------|',
      '| 0.9–1.0 | 核心文献，直接相关方法/理论 |',
      '| 0.7–0.8 | 密切相关，提供重要背景 |',
      '| 0.5–0.6 | 中度相关，辅助理解 |',
      '| < 0.5 | 边缘相关，仅作参考 |',
    ],
    notes: [
      '中英文检索词并行，提高覆盖率',
      '优先下载开放获取（OA）论文',
      '专利检索使用 `triz_search` target=patents',
    ],
  },
  '02_TRL': {
    title: '02_TRL — 技术成熟度评估',
    purpose: '评估目标技术在 S-curve 中的位置，判断当前发展阶段与潜力。',
    workflow: [
      '使用 `triz_s_curve` 分析技术演进曲线',
      '填写 `trl_assessment.json` 评估技术成熟度等级（TRL 1-9）',
      '结合文献证据确定技术所处阶段',
    ],
    outputFiles: [
      '`trl_assessment.json` — TRL 评估结果与依据',
      '`s_curve.json` — S-curve 数据点与技术阶段标注',
    ],
    extraTitle: 'TRL 定义速查',
    extraContent: [
      '| 等级 | 阶段 | 说明 |',
      '|------|------|------|',
      '| TRL 1–3 | 基础研究 | 观察到原理，提出概念，实验验证 |',
      '| TRL 4–6 | 开发验证 | 实验室验证，原型演示，真实环境测试 |',
      '| TRL 7–9 | 商业化 | 系统原型，示范系统，实际运行 |',
    ],
    notes: [
      'S-curve 数据点需标注年份 + 性能指标（如效率、成本、精度）',
      'TRL 评估需引用文献中的证据',
    ],
  },
  '03_Analyze': {
    title: '03_Analyze — 矛盾分析与瓶颈识别',
    purpose: '从文献和评估结果中提炼技术矛盾、物理矛盾与关键瓶颈。',
    workflow: [
      '使用 `triz_contradiction` 分析技术矛盾（改善参数 vs 恶化参数）',
      '使用 `triz_su_field` 进行 Su-Field 分析',
      '汇总瓶颈到 `bottlenecks.json`',
      '将矛盾记录到 `contradictions.json`',
    ],
    outputFiles: [
      '`contradictions.json` — 技术矛盾与物理矛盾列表',
      '`su_field_analysis.json` — Su-Field 模型分析',
      '`bottlenecks.json` — 关键技术瓶颈（按重要性排序）',
    ],
    extraTitle: '矛盾记录格式',
    extraContent: [
      '```json',
      '{',
      '  "id": "TC-001",',
      '  "type": "technical|physical",',
      '  "improvingParameter": 27,  // TRIZ 参数编号',
      '  "worseningParameter": 5,',
      '  "description": "矛盾描述",',
      '  "evidence": ["文献引用"],',
      '  "importance": 0.9',
      '}',
      '```',
    ],
    notes: [
      '每条矛盾需附重要性权重（0–1）',
      '技术矛盾使用 TRIZ 39 参数；物理矛盾使用分离原理',
      '瓶颈分析需结合 TRL 阶段判断优先级',
    ],
  },
  '04_Synthesize': {
    title: '04_Synthesize — 解决方案合成与路线图',
    purpose: '基于矛盾分析，应用 TRIZ inventive principles 生成解决方案，制定技术路线图。',
    workflow: [
      '对每个矛盾应用 `triz_contradiction` action=analyze 获取 inventive principles',
      '使用 `triz_ideality` 评估方案理想度',
      '汇总解决方案到 `solutions.json`',
      '制定 roadmap.json（短期/中期/长期任务）',
    ],
    outputFiles: [
      '`solutions.json` — 解决方案列表（含原理映射、验证计划）',
      '`principles_applied.json` — 各矛盾应用的 TRIZ 原理',
      '`trends.json` — 技术趋势分析',
      '`roadmap.json` — 研发路线图（≤3天可执行任务优先）',
    ],
    extraTitle: '理想度评估',
    extraContent: [
      '```',
      'Ideality = Σ(Benefits) / (Σ(Costs) + Σ(Harms))',
      '```',
      '- 分数越高方案越优',
      '- 需为每个 benefit/cost 赋重要性权重',
    ],
    notes: [
      '每条解决方案需链接到对应的矛盾 ID',
      '路线图任务粒度：≤3天可完成',
      '验证计划需包含具体实验或仿真方案',
    ],
  },
  '05_Deliver': {
    title: '05_Deliver — 成果交付物',
    purpose: '将研究分析结果整理为可交付的正式文档（论文、报告、演示文稿）。',
    workflow: [
      '根据需求选择输出格式（Typst 论文 / Markdown 报告）',
      '调用 `load_skill("paper-writer")` 或 `load_skill("patent-writer")` 获取写作指引',
      '使用 `todowrite` 规划章节，逐步撰写',
      '交叉验证各章节与 03_Analyze、04_Synthesize 结论的一致性',
    ],
    outputFiles: [
      '`paper.typ` / `paper.md` — 论文全文',
      '`report.md` — 技术报告',
      '`presentation.md` — 演示文稿大纲',
    ],
    extraTitle: '论文结构建议（TRIZ主题）',
    extraContent: [
      '1. 引言（问题背景、技术现状）',
      '2. 文献综述（01_Discover 证据）',
      '3. 技术矛盾分析（03_Analyze）',
      '4. TRIZ 解决方案（04_Synthesize）',
      '5. 实验验证（08_TData 数据）',
      '6. 结论与展望',
    ],
    notes: [
      '所有结论需引用对应 phase 的 JSON 文件作为证据',
      '矛盾→解决方案映射需清晰呈现',
      '验证实验需包含风险评估',
    ],
  },
  '06_References': {
    title: '06_References — 文献库',
    purpose: '集中存储所有下载的文献全文与元数据，便于检索与引用。',
    workflow: [
      '01_Discover 下载文献后自动存入此目录',
      '使用 `papers_list_downloaded` 查看已下载文献',
      '定期更新 library.json 补充 importance 和 tags',
    ],
    outputFiles: [
      '`library.json` — 文献索引（元数据 + 文件路径）',
      '`papers/` — 论文 PDF/DOCX/EPUB',
      '`patents/` — 专利 PDF',
      '`supplementary/` — 补充材料',
    ],
    extraTitle: 'library.json 格式',
    extraContent: [
      '```json',
      '[',
      '  {',
      '    "id": "REF-001",',
      '    "type": "paper|patent|report",',
      '    "title": "文献标题",',
      '    "authors": ["作者列表"],',
      '    "year": 2024,',
      '    "doi": "10.xxxx/xxxxx",',
      '    "file": "papers/xxx.pdf",',
      '    "importance": 0.9,',
      '    "tags": ["关键词"],',
      '    "notes": "个人备注"',
      '  }',
      ']',
      '```',
    ],
    notes: [
      '文件命名规范：`{第一作者}_{年份}_{关键词}.pdf`',
      'DOI 作为唯一标识符，避免重复下载',
      '使用 `scansci_pdf_import_bib` 从 .bib 文件批量导入',
    ],
  },
  '07_Patent': {
    title: '07_Patent — 专利撰写',
    purpose: '将 TRIZ 解决方案转化为专利申请文件（权利要求书 + 说明书）。',
    workflow: [
      '调用 `load_skill("patent-writer")` 获取专利写作指引',
      '使用 `todowrite` 规划专利结构',
      '撰写权利要求书（独立权利要求 + 从属权利要求）',
      '撰写说明书（技术领域、背景、发明内容、附图说明、具体实施方式）',
    ],
    outputFiles: [
      '`patent_disclosure.typ` — 专利说明书（Typst 格式）',
      '`claims.md` — 权利要求书',
      '`abstract.md` — 摘要',
    ],
    extraTitle: '专利核心要素',
    extraContent: [
      '| 部分 | 内容要求 |',
      '|------|----------|',
      '| 技术领域 | 简洁定义本发明所属领域 |',
      '| 背景技术 | 引用现有技术缺点，引出本发明要解决的问题 |',
      '| 发明内容 | 技术方案 + 有益效果 |',
      '| 权利要求 | 独立权利要求（broadest）+ 从属权利要求 |',
      '| 实施方式 | 具体例子，支持独立权利要求的可实现性 |',
    ],
    notes: [
      '权利要求需覆盖核心原理 + 变体实施例',
      '引用 04_Synthesize 的 solutions.json 作为技术方案来源',
      '避免使用功能性描述，优先用结构/步骤限定',
    ],
  },
  '08_TData': {
    title: '08_TData — 实验数据与代码',
    purpose: '存储验证实验数据、仿真代码、测试结果，支持 04_Synthesize 的解决方案验证。',
    workflow: [
      '根据 04_Synthesize 的验证计划设计实验',
      '将实验代码保存在 `code/` 目录',
      '记录实验数据与结果到 `experiments/`',
      '撰写验证报告到 `validation/`',
    ],
    outputFiles: [
      '`experiments/` — 实验记录与原始数据',
      '`code/` — 仿真/分析代码',
      '`results/` — 处理后的结果',
      '`validation/` — 验证报告',
    ],
    extraTitle: '数据记录规范',
    extraContent: [
      '每条实验记录需包含：',
      '- 实验目的（链接到 solutions.json 中的验证计划）',
      '- 实验条件（参数设置、环境）',
      '- 原始数据文件路径',
      '- 分析结果与结论',
      '- 与预期对比（PASS/FAIL）',
    ],
    notes: [
      '命名规范：`exp_{日期}_{序号}_{描述}.md`',
      '大型数据文件（如 CSV、JSON）单独存放，实验记录引用路径',
      '验证报告需量化对比改善参数与恶化参数',
    ],
  },
};

export const initCommand: SlashCommand = {
  name: 'init',
  description: 'Initialize a Trinno research workspace (creates 7 phase folders, each with a README)',
  usage: '/init [project name] [optional one-line goal]',
  async execute(args, deps, emit, _signal) {
    const root = deps.phaseWriter.getWorkspaceRoot();
    if (!root) {
      emit('token', {
        tokenType: 'Text',
        text: [
          '**Trinno workspace is not set.**',
          '',
          '1. Open the folder where you want to run your research (Command Palette → **File: Open Folder**).',
          '2. Run **Trinno: Set Workspace** from the Command Palette, or set `trinno.chat.trpWorkspace` in VS Code settings to that folder\'s absolute path.',
          '3. Re-run `/init` from the Trinno chat panel.',
        ].join('\n'),
      });
      emit('done', {});
      return;
    }

    const parsed = parseInitArgs(args.trim());
    const projectName = parsed.name || path.basename(root) || 'Untitled Project';
    const goal = parsed.goal || '';

    const created: string[] = [];
    const existing: string[] = [];
    for (const dir of PHASE_DIRS) {
      const full = path.join(root, dir);
      if (fs.existsSync(full)) {
        existing.push(dir);
      } else {
        fs.mkdirSync(full, { recursive: true });
        created.push(dir);
      }
    }

    const today = new Date().toISOString().slice(0, 10);
    const rootReadmePath = path.join(root, 'README.md');
    const rootReadmeExisted = fs.existsSync(rootReadmePath);
    if (!rootReadmeExisted) {
      fs.writeFileSync(rootReadmePath, buildRootReadme(projectName, goal, today, root), 'utf-8');
    }

    const phaseReadmes: { phase: string; created: boolean }[] = [];
    for (const phase of PHASE_DIRS) {
      const phaseReadmePath = path.join(root, phase, 'README.md');
      const phaseExisted = fs.existsSync(phaseReadmePath);
      if (!phaseExisted) {
        fs.writeFileSync(phaseReadmePath, buildPhaseReadme(phase, projectName, rootReadmeExisted), 'utf-8');
      }
      phaseReadmes.push({ phase, created: !phaseExisted });
    }

    const initRecord = {
      projectName,
      goal,
      workspaceRoot: root,
      createdDirs: created,
      existingDirs: existing,
      rootReadmeCreated: !rootReadmeExisted,
      phaseReadmes,
      initializedAt: new Date().toISOString(),
    };
    deps.phaseWriter.write({
      phase: '01_Discover',
      name: 'init',
      data: initRecord,
      format: 'json',
    });

    const lines: string[] = [];
    lines.push('## Trinno workspace initialized\n');
    lines.push(`**Project:** ${projectName}`);
    if (goal) lines.push(`**Goal:** ${goal}`);
    lines.push(`**Workspace:** \`${root}\``);
    lines.push('');
    lines.push('**Folders:**');
    if (created.length) lines.push(`- created: ${created.map(d => `\`${d}\``).join(', ')}`);
    if (existing.length) lines.push(`- already existed: ${existing.map(d => `\`${d}\``).join(', ')}`);
    lines.push(`- root README: ${rootReadmeExisted ? 'kept existing' : 'created'}`);
    const phaseReadmeCreated = phaseReadmes.filter(p => p.created).map(p => `\`${p.phase}\``).join(', ');
    const phaseReadmeKept = phaseReadmes.filter(p => !p.created).map(p => `\`${p.phase}\``).join(', ');
    if (phaseReadmeCreated) lines.push(`- phase READMEs created: ${phaseReadmeCreated}`);
    if (phaseReadmeKept) lines.push(`- phase READMEs kept: ${phaseReadmeKept}`);
    lines.push('');
    lines.push('### Suggested next steps');
    lines.push('1. Edit `README.md` to fill in the problem statement and success criteria.');
    lines.push('2. Chat with the AI to scope the problem — anything you say goes into `01_Discover/`.');
    lines.push('3. Run `/s-curve "<topic>" <param> <TRL>` to place your topic on the maturity curve.');
    lines.push('4. Use `/contradiction`, `/ideality`, `/su-field` as the problem crystallizes.');
    lines.push('5. `/search` to pull literature into `06_References/`; `/download <doi>` to grab a paper.');
    lines.push('6. `/patent "<topic>"` drafts a patent into `07_Patent/` when you\'re ready.');
    lines.push('');
    lines.push('Re-running `/init` is safe — it will not overwrite anything.');

    emit('token', { tokenType: 'Text', text: lines.join('\n') });
    emit('done', {});
  },
};

interface InitArgs {
  name: string;
  goal: string;
}

function parseInitArgs(raw: string): InitArgs {
  if (!raw) return { name: '', goal: '' };
  const m = raw.match(/^"([^"]+)"(?:\s+(.+))?$/);
  if (m) return { name: m[1] ?? '', goal: (m[2] ?? '').trim() };
  const tokens = raw.split(/\s+/);
  return { name: tokens[0] ?? '', goal: tokens.slice(1).join(' ').trim() };
}

function buildRootReadme(name: string, goal: string, today: string, root: string): string {
  return [
    `# ${name}`,
    '',
    goal ? `> ${goal}` : '> _One-line problem statement / research goal goes here._',
    '',
    `Trinno research workspace — initialized ${today}.`,
    '',
    '## Phase folders',
    '',
    '| Folder | Purpose | Read me |',
    '|---|---|---|',
    '| `01_Discover/` | Free-form exploration, problem framing. | [`01_Discover/README.md`](01_Discover/README.md) |',
    '| `02_TRL/` | S-curve / TRL maturity assessments. | [`02_TRL/README.md`](02_TRL/README.md) |',
    '| `03_Analyze/` | Contradictions, ideality scores, Su-Field decompositions. | [`03_Analyze/README.md`](03_Analyze/README.md) |',
    '| `04_Synthesize/` | Inventive principles, solution candidates. | [`04_Synthesize/README.md`](04_Synthesize/README.md) |',
    '| `05_Deliver/` | Selected concepts, prototype plans. | [`05_Deliver/README.md`](05_Deliver/README.md) |',
    '| `06_References/` | Literature search results, downloaded papers. | [`06_References/README.md`](06_References/README.md) |',
    '| `07_Patent/` | Patent drafts. | [`07_Patent/README.md`](07_Patent/README.md) |',
    '| `08_TData/` | 实验数据与代码. | [`08_TData/README.md`](08_TData/README.md) |',
    '',
    '## Problem statement',
    '',
    '_Describe the technical problem in 1–3 paragraphs. What are the stakes? Who is affected?_',
    '',
    '## Success criteria',
    '',
    '_What does "solved" look like? Quantitative targets, constraints, and non-goals._',
    '',
    '## Stakeholders',
    '',
    '_Who cares about the outcome? End users, regulators, suppliers, internal sponsors._',
    '',
    '## Constraints & assumptions',
    '',
    '_Cost, weight, environment, regulation, available materials, prior art to avoid._',
    '',
    '## Notes',
    '',
    `- Workspace path: \`${root}\``,
    '- Each `/command` you run writes a timestamped file into the matching phase folder.',
    '- Each phase folder has its own `README.md` describing what it\'s for and which commands populate it.',
    '- Re-run `/init` to add missing folders or READMEs — it never overwrites existing files.',
    '',
  ].join('\n');
}

function buildPhaseReadme(phase: PhaseDir, projectName: string, rootReadmeExisted: boolean): string {
  const info = PHASE_README[phase];
  const rootLink = rootReadmeExisted
    ? '[← Back to workspace root](../README.md)'
    : '[← Back to workspace root](../)';
  const lines: string[] = [
    `# ${info.title}`,
    '',
    `_项目: **${projectName}**_`,
    '',
    '## 目的',
    '',
    info.purpose,
    '',
    '## 工作流',
    '',
    ...info.workflow.map((w, i) => `${i + 1}. ${w}`),
    '',
    '## 输出文件',
    '',
    ...info.outputFiles.map(f => `- ${f}`),
    '',
  ];
  if (info.extraTitle) {
    lines.push(
      `## ${info.extraTitle}`,
      '',
      ...info.extraContent,
      '',
    );
  }
  lines.push(
    '## 注意事项',
    '',
    ...info.notes.map(n => `- ${n}`),
    '',
    rootLink,
    '',
  );
  return lines.join('\n');
}
