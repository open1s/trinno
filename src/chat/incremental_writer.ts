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
    `目标文件: \`${plan.writePath}\`（系统会自动将你的输出写入此文件）`,
    '',
    '## 工作方式（每轮只输出一节）',
    '1. （可选）用 read_file 读取当前进度',
    '2. （可选）用 TRIZ 工具收集数据',
    `3. **直接输出下一节内容**作为普通文本（系统会自动写入 \`${plan.writePath}\`，替换标记）`,
    '',
    '## 关键约束',
    '- 你的文本输出就是下一节内容，系统会写入文件替换标记',
    '- 每节 ≤ 500 字 markdown（约 150 行）',
    '- 不要调用 edit_file 或 write_file（系统自动处理文件写入）',
    '- 中文撰写，markdown 格式',
    '- 使用 TRIZ 工具查询真实数据，不要编造参数编号',
    '',
    '## 章节建议',
    plan.type === 'patent'
      ? '- 技术领域 → 背景技术 → 发明内容 → 附图说明 → 具体实施方式 → 权利要求'
      : '- 摘要 → 引言 → 技术矛盾分析 → 物场分析 → 解决方案 → S曲线 → 实施路线图 → TRL → 结论 → 参考文献',
    '',
    '## 当前文件末尾（参考）',
    '```',
    fileTail || '(empty)',
    '```',
    '',
    '**完成所有节后**：在最后一段输出末尾包含「本文撰写完成」或「${completeMarkerFor(plan.type)}」，系统会自动结束。',
  ].join('\n');
}

export function buildBootstrapPrompt(plan: WritePlan): string {
  const docLabel = plan.type === 'patent' ? '专利文档' : '论文';
  return [
    `请开始撰写${docLabel}："${plan.title}"`,
    '',
    `目标文件: \`${plan.writePath}\`（已初始化，包含标题和标记。系统会自动将你的输出写入此文件）`,
    '',
    '## 工作方式（每轮只输出一节）',
    '1. （可选）用 read_file 查看当前进度',
    '2. （可选）用 TRIZ 工具收集数据：triz_search, triz_principles, triz_contradiction, triz_su_field, triz_ideality, triz_s_curve',
    '3. **直接输出第一节内容**作为普通文本（系统会自动写入文件替换标记）',
    '',
    '## 关键约束',
    '- 你的文本输出就是第一节内容，系统会自动写入文件',
    '- 每节 ≤ 500 字 markdown',
    '- 不要调用 edit_file 或 write_file（系统自动处理文件写入）',
    '- 中文撰写，markdown 格式',
    '- 使用 TRIZ 工具查询真实数据，不要编造参数编号',
    '',
    '## 章节建议（仅供参考）',
    plan.type === 'patent'
      ? '- 技术领域 → 背景技术 → 发明内容 → 附图说明 → 具体实施方式 → 权利要求'
      : '- 摘要 → 引言 → 技术矛盾分析 → 物场分析 → 解决方案 → S曲线 → 实施路线图 → TRL → 结论 → 参考文献',
    '',
    '请从第一节开始撰写。',
  ].join('\n');
}
