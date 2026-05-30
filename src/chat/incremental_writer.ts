/**
 * Incremental paper/patent writer.
 *
 * The .md file on disk is the source of truth (Claude Code pattern).
 * The LLM is the writer: it reads the file, decides the next section,
 * and appends via edit_file using the LLM_ANCHOR marker.
 *
 * The system does NOT prescribe sections, structure, or content. It only:
 *  1. bootstraps the file with a title + an anchor marker
 *  2. sends a "continue" prompt each turn
 *  3. detects when the LLM signals completion
 */

import * as fs from 'fs/promises';
import * as path from 'path';

export const LLM_ANCHOR = '<!-- LLM_WRITE_HERE -->';
export const COMPLETE_MARKER_PAPER = '<!-- PAPER_COMPLETE -->';
export const COMPLETE_MARKER_PATENT = '<!-- PATENT_COMPLETE -->';

const DONE_PATTERNS: RegExp[] = [
  /<!--\s*PAPER_COMPLETE\s*-->/i,
  /<!--\s*PATENT_COMPLETE\s*-->/i,
  /论文\s*(?:撰写|写作)\s*(?:完成|结束|完毕)/i,
  /专利\s*(?:撰写|写作)\s*(?:完成|结束|完毕)/i,
  /全文\s*已完成/i,
];

export type WriteType = 'paper' | 'patent';

export interface WritePlan {
  type: WriteType;
  title: string;
  writePath: string;
}

export function isWriteType(value: string): value is WriteType {
  return value === 'paper' || value === 'patent';
}

export function completeMarkerFor(type: WriteType): string {
  return type === 'patent' ? COMPLETE_MARKER_PATENT : COMPLETE_MARKER_PAPER;
}

export async function bootstrapFile(plan: WritePlan, workspaceRoot: string): Promise<void> {
  const targetPath = path.join(workspaceRoot, plan.writePath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const existing = await fs.readFile(targetPath, 'utf8').catch(() => '');
  if (existing.includes(LLM_ANCHOR)) return;
  if (existing.length > 0) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const bakPath = targetPath.replace(/\.md$/, '') + `.${ts}.bak`;
    await fs.writeFile(bakPath, existing, 'utf8');
  }
  const content = `# ${plan.title}\n\n${LLM_ANCHOR}\n`;
  await fs.writeFile(targetPath, content, 'utf8');
}

export async function readFileTail(filePath: string, maxChars = 800): Promise<string> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    if (content.length <= maxChars) return content;
    return '...[truncated]...\n' + content.slice(-maxChars);
  } catch {
    return '';
  }
}

export async function readFullFile(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

export function isComplete(content: string, type: WriteType): boolean {
  if (content.includes(completeMarkerFor(type))) return true;
  if (type === 'paper' && content.includes(COMPLETE_MARKER_PATENT)) return true;
  if (type === 'patent' && content.includes(COMPLETE_MARKER_PAPER)) return true;
  return false;
}

export function hasAnchor(content: string): boolean {
  return content.includes(LLM_ANCHOR);
}

export function detectDoneInText(text: string): boolean {
  return DONE_PATTERNS.some(p => p.test(text));
}

export function buildContinuePrompt(plan: WritePlan, fileTail: string): string {
  const docLabel = plan.type === 'patent' ? '专利文档' : '论文';
  return [
    `请继续撰写${docLabel}："${plan.title}"`,
    '',
    `目标文件: \`${plan.writePath}\``,
    '',
    '## 工作方式（每轮只追加一节）',
    `1. 用 read_file 读取 \`${plan.writePath}\` 当前状态（下方已附文件末尾供参考）`,
    `2. 决定下一节内容（你自由决定章节、顺序、深度——论文通常涵盖 摘要 / 引言 / 矛盾 / 方案 / 趋势 / 路线图 / TRL / 结论 / 参考文献 等；专利通常涵盖 技术领域 / 背景 / 发明内容 / 附图说明 / 具体实施方式 / 权利要求 等）`,
    `3. **只调用一次 edit_file**，将文件中 \`${LLM_ANCHOR}\` 这一行替换为：新一节的 markdown 内容 + 换行 + \`${LLM_ANCHOR}\` 标记（如果是最后一节，替换为 \`${completeMarkerFor(plan.type)}\`）`,
    '',
    '## 关键约束',
    '- **首选 edit_file 增量追加**（每次一节，便于续写、回滚、避免长文档上下文截断）',
    '- write_file 也可用（适用于内容较短的文档，1 次写完），不会失败',
    '- **绝对不要**一次性输出整篇 markdown 到文本（会失败）',
    '- edit_file 的 oldString 必须是文件中当前存在的 `<!-- LLM_WRITE_HERE -->` 标记',
    '- newString 末尾必须包含下一个标记（`<!-- LLM_WRITE_HERE -->` 继续 / `<!-- PAPER_COMPLETE -->` 结束）',
    '- 遵循 TRIZ 方法论，使用工具查询真实数据，不要编造参数编号',
    `- 中文撰写，markdown 格式`,
    '',
    '## 当前文件末尾（参考，可跳过 read_file）',
    '```',
    fileTail || '(empty)',
    '```',
    '',
    `完成所有节后：在最后一次 edit_file 中，把 \`${LLM_ANCHOR}\` 替换为 \`${completeMarkerFor(plan.type)}\`，然后输出简短确认文字（如"论文撰写完成"）。`,
  ].join('\n');
}

export function buildBootstrapPrompt(plan: WritePlan): string {
  const docLabel = plan.type === 'patent' ? '专利文档' : '论文';
  return [
    `请开始撰写${docLabel}："${plan.title}"`,
    '',
    `目标文件: \`${plan.writePath}\`（已初始化，仅含标题和 \`${LLM_ANCHOR}\` 标记）`,
    '',
    '## 工作方式（每轮只追加一节）',
    `1. 用 read_file 读取 \`${plan.writePath}\` 当前状态`,
    `2. 决定下一节内容（你自由决定章节、顺序、深度）`,
    `3. **只调用一次 edit_file**，将文件中 \`${LLM_ANCHOR}\` 这一行替换为：新一节的 markdown 内容 + 换行 + \`${LLM_ANCHOR}\` 标记`,
    '',
    '## 关键约束',
    '- **绝对不要**调用 write_file 写入整篇内容（会失败）',
    '- **绝对不要**一次性输出整篇 markdown 到文本（会失败）',
    '- edit_file 的 oldString 必须是文件中当前存在的 `<!-- LLM_WRITE_HERE -->` 标记',
    '- newString 末尾必须包含 `<!-- LLM_WRITE_HERE -->` 标记（除非是最后一节）',
    '- 遵循 TRIZ 方法论，使用工具查询真实数据',
    '- 中文撰写，markdown 格式',
    '',
    '## 章节建议（仅供参考，LLM 自行决定）',
    plan.type === 'patent'
      ? '- 技术领域、背景技术、发明内容、附图说明、具体实施方式、权利要求'
      : '- 摘要、引言、技术矛盾分析（TRIZ 39 工程参数 + 40 发明原理）、物场分析与 76 标准解、解决方案设计、S 曲线分析与发展趋势、实施路线图、TRL 技术成熟度评估、结论与展望、参考文献',
    '',
    '请从第一节（如 摘要 / 技术领域）开始。',
  ].join('\n');
}
