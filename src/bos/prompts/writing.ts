import { composePrompt, withInvariants } from './contract.js';
import { definePrompt } from './registry.js';

/**
 * Writing-tier prompts: the paper instruction block, the incremental writer
 * (one section per turn) and the conversation-compaction summary.
 */

// ── chat.paper.instructions ──────────────────────────────────────────────
const PAPER_REQUIREMENTS: string[] = [
  "## 要求",
  "1. 所有方法论（TRIZ、PRISMA、SWOT、PEST 等）仅作为分析引擎使用，论文正文中不得出现这些方法论名称。",
  "2. 输出结构：摘要 → 引言 → 问题分析 → 解决方案 → 技术发展趋势 → 路线图 → 风险评估 → 结论 → 参考文献。",
  "3. 内容专业、逻辑清晰、学术规范；evidence 行内注明 score/weight；decision factors 与 risks 显式列出。",
  "4. 不要编造参数编号、案例、数据；不确定时调用 websearch。",
  "5. 所有汉字必须为有效 UTF-8，不可出现乱码、缺字或编码错误。",
  "6. 参考文献只能引用下方提供的数据源；任何无法从提供数据验证的引用不得写入，必须写入时显式标注\"未经源数据验证\"。",
  "7. 文末追加\"## 验证实验\"清单（含验证方法、预期结果、判定标准）。",
];
const PAPER_JOURNAL_RULES: string[] = [
  "请按照该期刊的投稿指南调整论文格式与内容风格：",
  "- 章节划分符合该期刊的常规要求",
  "- 参考文献格式遵循该期刊的引用规范",
  "- 语言风格、摘要长度、关键词数量等符合该期刊惯例",
  "- 在引言中简要说明本研究对该期刊读者群体的价值",
];
const PAPER_INSTRUCTIONS_OUTPUT: string[] = [
  "- 直接输出 markdown 格式的完整论文，不要包含任何 XML 标签或 JSON。",
  "- 只使用下方提供的研究数据；数据中没有的内容不写。",
];
export const buildPaperInstructions = definePrompt(
  {
    id: 'chat.paper.instructions',
    kind: 'writer',
    enforcedBy: ['L1', 'L3'],
    invariants: 'core',
    maxChars: 3600,
    requiredSections: ['## 要求', '## Output Contract'],
    sampleArgs: ['固态电池界面稳定性', '技术论文', 'Journal of Power Sources'],
    namesTools: ['websearch'],
    usedBy: 'src/chat/write_paper.ts buildPaperPrompt — instruction block only; the caller appends the research data',
  },
  (title: string, typeLabel: string, targetJournal?: string) => {
    const body = PAPER_REQUIREMENTS.slice();
    if (targetJournal) {
      body.push('', '### 目标期刊要求', '目标期刊：**' + targetJournal + '**', ...PAPER_JOURNAL_RULES);
    }
    return composePrompt({
      role: 'You are Research Master — self-directed, tool-first research agent。请基于以下研究数据撰写一篇完整的' + typeLabel + '，标题："' + title + '"',
      body: body.join('\n'),
      outputContract: PAPER_INSTRUCTIONS_OUTPUT.join('\n'),
    });
  },
);

// ── chat.incremental.continue ────────────────────────────────────────────
export interface IncrementalPromptArgs {
  docLabel: string;
  title: string;
  writePath: string;
  sectionHint: string;
  completeMarker: string;
  fileTail: string;
}

const INCREMENTAL_WORKFLOW: string[] = [
  "## 工作方式（每轮只输出一节）",
  "1. （可选）用 read_file 读取当前进度",
  "2. （可选）用 TRIZ 工具收集真实数据：triz_search, triz_principles, triz_contradiction, triz_su_field, triz_ideality, triz_s_curve",
  "3. **直接输出下一节内容**作为普通文本（系统会自动写入目标文件，替换标记）",
  "",
  "## 关键约束",
  "- 你的文本输出就是下一节内容，系统会写入文件替换标记",
  "- 每节 ≤ 500 字 markdown（约 150 行）",
  "- 不要调用 edit_file 或 write_file（系统自动处理文件写入）",
  "- 中文撰写，markdown 格式。所有汉字必须为有效 UTF-8，不可出现乱码、缺字或编码错误",
  "- 使用 TRIZ 工具查询真实数据，不要编造参数编号",
];
export const buildIncrementalContinuePrompt = definePrompt(
  {
    id: 'chat.incremental.continue',
    kind: 'writer',
    enforcedBy: ['L0', 'L1', 'L3'],
    invariants: 'core',
    maxChars: 3200,
    requiredSections: ['## 工作方式（每轮只输出一节）', '## 关键约束', '## Output Contract'],
    sampleArgs: [{ docLabel: '论文', title: '固态电池界面稳定性', writePath: '05_Deliver/paper.md', sectionHint: '- 摘要 → 引言 → 结论', completeMarker: '<!-- DONE -->', fileTail: '## 摘要\n…' }],
    namesTools: ['read_file', 'triz_search', 'triz_principles', 'triz_contradiction', 'triz_su_field', 'triz_ideality', 'triz_s_curve'],
    usedBy: 'src/chat/incremental_writer.ts buildContinuePrompt — one section per turn (L0: the caller owns file writes)',
  },
  (a: IncrementalPromptArgs) =>
    composePrompt({
      role: '请继续撰写' + a.docLabel + '："' + a.title + '"',
      body: [
        '目标文件: `' + a.writePath + '`（系统会自动将你的输出写入此文件）',
        '',
        ...INCREMENTAL_WORKFLOW,
        '',
        '## 章节建议',
        a.sectionHint,
        '',
        '## 当前文件末尾（参考）',
        '```',
        a.fileTail || '(empty)',
        '```',
      ].join('\n'),
      outputContract: '只输出下一节的正文。完成全部章节后，在最后一段末尾包含「本文撰写完成」或 `' + a.completeMarker + '`，系统会自动结束。',
    }),
);

// ── chat.incremental.bootstrap ───────────────────────────────────────────
export const buildIncrementalBootstrapPrompt = definePrompt(
  {
    id: 'chat.incremental.bootstrap',
    kind: 'writer',
    enforcedBy: ['L0', 'L1', 'L3'],
    invariants: 'core',
    maxChars: 3000,
    requiredSections: ['## 工作方式（每轮只输出一节）', '## 关键约束', '## Output Contract'],
    sampleArgs: [{ docLabel: '论文', title: '固态电池界面稳定性', writePath: '05_Deliver/paper.md', sectionHint: '- 摘要 → 引言 → 结论', completeMarker: '<!-- DONE -->', fileTail: '' }],
    namesTools: ['read_file', 'triz_search', 'triz_principles', 'triz_contradiction', 'triz_su_field', 'triz_ideality', 'triz_s_curve'],
    usedBy: 'src/chat/incremental_writer.ts buildBootstrapPrompt — first section of a new document',
  },
  (a: IncrementalPromptArgs) =>
    composePrompt({
      role: '请开始撰写' + a.docLabel + '："' + a.title + '"',
      body: [
        '目标文件: `' + a.writePath + '`（已初始化，包含标题和标记；系统会自动将你的输出写入此文件）',
        '',
        ...INCREMENTAL_WORKFLOW,
        '',
        '## 章节建议（仅供参考）',
        a.sectionHint,
      ].join('\n'),
      outputContract: '只输出第一节的正文。结束标记由系统判定，本节不要提前写「本文撰写完成」。',
    }),
);

// ── chat.compact.summary ─────────────────────────────────────────────────
const COMPACT_HEAD: string[] = [
  "## Output Contract",
  "- A structured markdown summary aligned to the 7-phase pipeline (Problem→Context→Evidence→Modeling→TRIZ→Validation→Execution).",
  "- ≤4 lines per block, copy-ready, no preamble and no closing commentary.",
  "- Cover: user intent and key inputs (and which 7-phase step they live in); assistant actions, especially tool usage (which tool, why, what happened); decision factors and key outcomes; contradictions → solutions surfaced; context, constraints and assumptions; errors, failures and retries; remaining open questions and the next ≤3-day executable steps.",
  "- The transcript may contain user messages, assistant responses, tool calls, tool results and errors.",
  "",
  "Conversation:",
];
export const buildCompactSummaryPrompt = definePrompt(
  {
    id: 'chat.compact.summary',
    kind: 'task',
    enforcedBy: ['L1', 'L3'],
    invariants: 'core',
    maxChars: 4200,
    requiredSections: ['## Output Contract'],
    sampleArgs: ['User: 分析固态电池界面稳定性\nAssistant: 已提取 12 个 S 曲线数据点…'],
    usedBy: 'src/bos/worker.ts handleCompact — conversation compaction',
  },
  (conversationText: string) =>
    withInvariants('You are Research Master compressing a long conversation so that the next turn can continue without the raw transcript.' + '\n\n' + COMPACT_HEAD.join('\n') + '\n' + conversationText, 'core'),
);
