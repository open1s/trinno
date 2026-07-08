/**
 * Write-paper pre-processor: parses user input and composes paper content.
 * No vscode dependency — pure functions, fully testable.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

export interface WriteCommand {
  title: string;
  phase: string;
  writePath: string;
}

export function parseWriteCommand(text: string): WriteCommand | null {
  const t = text.trim();
  if (!t) return null;

  const phaseMatch = (s: string) => s.match(/,\s*refer(?:ring)?\s+(?:the\s+)?research\s+([0-9]{2}_\w+)/i);
  const stripPhase = (s: string) => s.replace(/,\s*refer(?:ring)?\s+(?:the\s+)?research\s+[0-9]{2}_\w+/i, '').trim();
  const finalize = (body: string) => {
    const cleaned = stripPhase(body);
    if (!cleaned) return null;
    const phase = phaseMatch(body)?.[1] ?? '05_Deliver';
    return { title: cleaned, phase, writePath: `${phase}/${slugifyPatentTitle(cleaned)}.typ` };
  };

  // Form 1: "write paper: <title>" / "write a paper: <title>" / "write the paper: <title>" (explicit colon)
  const withColon = t.match(/^(?:write\s+(?:a\s+|the\s+)?paper|写\s*论文)\s*[:：]\s*(.+)$/i);
  if (withColon) return finalize(withColon[1]!.trim());

  // Form 2: requires a clear title after the keyword — either:
  //   (a) explicit preposition after paper: "write paper on/about/covering/regarding <topic>"
  //       "write a paper on <topic>" / "write the paper regarding <topic>"
  //   (b) "as paper" with title after: "write as paper <topic>" / "write it as a paper <topic>"
  //       ("as" appears before paper; the next non-space word after paper is the title)
  //   (c) "write paper, <topic>" (comma after keyword is also a clear boundary)
  // A bare "write as paper" with no topic is intentionally rejected — too ambiguous to guess a title.
  const explicit = t.match(/^(?:write|writing)\s+(?:it\s+)?(?:as\s+)?(?:a\s+|the\s+)?paper\s+(?:on|about|covering|regarding)\s+(.+)$/i);
  if (explicit) {
    const body = explicit[1]!.trim();
    if (body) return finalize(body);
  }
  // "write as paper <topic>" / "write it as a paper <topic>" — "as" appears before paper
  const asPaper = t.match(/^(?:write|writing)\s+(?:it\s+)?as\s+(?:a\s+|the\s+)?paper\s+(.+)$/i);
  if (asPaper) {
    const body = asPaper[1]!.trim();
    if (body) return finalize(body);
  }
  const comma = t.match(/^(?:write|writing)\s+(?:it\s+)?(?:as\s+)?(?:a\s+|the\s+)?paper\s*,\s*(.+)$/i);
  if (comma) {
    const body = comma[1]!.trim();
    if (body) return finalize(body);
  }

  // Form 2b: Chinese — "写论文：<topic>" (colon required, consistent with English Form 1)
  //          "写一篇论文：<topic>" / "写个论文：<topic>" / "把它写成论文：<topic>" / "写成论文：<topic>"
  //          "请写论文：<topic>"
  // Bare "写论文 GDL" is rejected (no colon) — matches the English "no colon returns null" contract.
  const cn = t.match(/^(?:请)?(?:把(?:它|这(?:篇|个|份)?)?\s*)?(?:写|写成|撰写)\s*(?:成\s*)?(?:一\s*[篇个份]?|这\s*[篇个份]?|个)?\s*论文\s*[:：]\s*(.+)$/);
  if (cn && cn[1] && cn[1].trim()) return finalize(cn[1].trim());

  return null;
}

export function slugifyPatentTitle(title: string): string {
  const normalized = title.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  const slug = normalized
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  const capped = slug.slice(0, 100);
  return capped.length > 0 ? capped : 'patent';
}

export function parseWritePatent(text: string): WriteCommand | null {
  const t = text.trim();
  if (!t) return null;

  const slashMatch = t.match(/^\/patent\s+([\s\S]+)$/i);
  if (slashMatch) {
    const body = (slashMatch[1] ?? '').trim();
    if (!body) return null;
    return { title: body, phase: '07_Patent', writePath: `07_Patent/${slugifyPatentTitle(body)}.typ` };
  }

  const pattern = /^(?:撰写|写|起草)?\s*专利(?:\s*(?:申请书|申请|书))?(?:\s*[:：]|\s+)([\s\S]+)$|^(?:write\s+(?:a\s+)?patent(?:\s+application)?|patent(?:\s+application)?)\s*[:：]?\s*([\s\S]+)$/i;
  const m = t.match(pattern);
  if (!m) return null;
  const body = (m[1] ?? m[2] ?? '').trim();
  if (!body) return null;
  return { title: body, phase: '07_Patent', writePath: `07_Patent/${slugifyPatentTitle(body)}.typ` };
}

export function parseWriteAny(text: string): { type: 'paper' | 'patent'; cmd: WriteCommand } | null {
  const t = text.trim();
  if (!t) return null;
  const patentCmd = parseWritePatent(t);
  if (patentCmd) return { type: 'patent', cmd: patentCmd };
  const paperCmd = parseWriteCommand(t);
  return paperCmd ? { type: 'paper', cmd: paperCmd } : null;
}

export type WriteIntent =
  | { kind: 'match'; type: 'paper' | 'patent'; cmd: WriteCommand }
  | { kind: 'needs-topic'; type: 'paper' | 'patent' };

const BARE_PAPER_PATTERNS: RegExp[] = [
  /^(?:write|writing)\s+(?:it\s+)?(?:as\s+)?(?:a\s+|the\s+)?paper\s*$/i,
  /^(?:write|writing)\s+(?:it\s+)?(?:as\s+)?(?:a\s+|the\s+)?paper\s+(?:on|about|covering|regarding)\s*$/i,
  /^(?:write|writing)\s+(?:it\s+)?(?:as\s+)?(?:a\s+|the\s+)?paper\s*,\s*$/i,
  /^(?:write|writing)\s+(?:it\s+)?as\s+(?:a\s+|the\s+)?paper\s*$/i,
];

const BARE_PAPER_CN_PATTERNS: RegExp[] = [
  /^(?:请)?(?:把(?:它|这(?:篇|个|份)?)?\s*)?(?:写|写成|撰写)\s*(?:成\s*)?(?:一\s*[篇个份]?|这\s*[篇个份]?|个)?\s*论文\s*[:：]?\s*$/,
  /^(?:请)?(?:把(?:它|这(?:篇|个|份)?)?\s*)?(?:写|写成|撰写)\s*(?:成\s*)?(?:一\s*[篇个份]?|这\s*[篇个份]?|个)?\s*论文$/,
];

const BARE_PATENT_PATTERNS: RegExp[] = [
  /^(?:write|writing)\s+(?:a\s+)?patent(?:\s+application)?\s*[:：]?\s*$/i,
  /^(?:撰写|写|起草)?\s*专利(?:\s*(?:申请书|申请|书))?\s*[:：]?\s*$/,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

export function parseWriteIntent(text: string): WriteIntent | null {
  const t = text.trim();
  if (!t) return null;

  const matched = parseWriteAny(t);
  if (matched) return { kind: 'match', type: matched.type, cmd: matched.cmd };

  if (matchesAny(t, BARE_PAPER_PATTERNS) || matchesAny(t, BARE_PAPER_CN_PATTERNS)) {
    return { kind: 'needs-topic', type: 'paper' };
  }
  if (matchesAny(t, BARE_PATENT_PATTERNS)) {
    return { kind: 'needs-topic', type: 'patent' };
  }

  return null;
}

export async function readJsonFileSafe(filePath: string): Promise<any> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    try {
      return JSON.parse(raw);
    } catch {
      // Try extracting JSON from markdown code fence
      const fenceMatch = raw.match(/```(?:json)?\s*\n([\s\S]*?)```/);
      if (fenceMatch) {
        const extracted = fenceMatch[1]!.trim();
        return JSON.parse(extracted);
      }
      // Try stripping leading markdown lines before first { or [
      const firstBrace = raw.search(/[{[]/);
      if (firstBrace >= 0) {
        return JSON.parse(raw.slice(firstBrace));
      }
      return null;
    }
  } catch { return null; }
}

export async function readTextFileSafe(filePath: string, maxLines = 2000): Promise<string | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return raw.split('\n').slice(0, maxLines).join('\n');
  } catch { return null; }
}

export function normalizeArr(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    for (const key of ['contradictions', 'analyses', 'principles', 'items', 'solutions', 'trends', 'roadmap', 'entries']) {
      if (Array.isArray(value[key])) return value[key];
    }
  }
  return [];
}

export function composeWritePaper(title: string, phase: string, data: ResearchData): string {
  const out: string[] = [];
  out.push(`# ${title}`);
  out.push('');
  out.push('## A TRIZ-Based Technical Research Paper');
  out.push('');
  out.push('---');
  out.push('');
  out.push('## 摘要');
  out.push('');
  out.push(
    `本研究聚焦 "${title}" 这一技术问题，基于 TRIZ（发明问题解决理论）方法论，` +
    `对相关技术矛盾、瓶颈与解决路径进行系统分析。` +
    `通过文献检索、S 曲线分析、技术成熟度评估（TRL）以及 TRIZ 矛盾矩阵与 40 条发明原理的应用，` +
    `识别核心技术瓶颈并提出创新方案。` +
    `研究覆盖从专利与论文检索、矛盾识别、原理映射到方案设计与实施路线图的全流程，` +
    `为工程化应用提供理论与技术支撑。`
  );
  out.push('');
  out.push('**关键词：** TRIZ；技术矛盾；GDL；发明原理；技术成熟度评估');
  out.push('');

  if (data.synthesisMd) {
    out.push('## 1 引言');
    out.push('');
    out.push(data.synthesisMd);
    out.push('');
  }

  if (data.contradictions) {
    out.push('## 2 技术矛盾分析');
    out.push('');
    out.push(data.contradictions);
    out.push('');
  }

  if (data.solutions) {
    out.push('## 3 解决方案设计');
    out.push('');
    out.push(data.solutions);
    out.push('');
  }

  if (data.trends) {
    out.push('## 4 技术发展趋势');
    out.push('');
    out.push(data.trends);
    out.push('');
  }

  if (data.roadmap) {
    out.push('## 5 实施路线图');
    out.push('');
    out.push(data.roadmap);
    out.push('');
  }

  if (data.trl) {
    out.push('## 6 技术成熟度评估');
    out.push('');
    out.push(data.trl);
    out.push('');
  }

  if (data.sCurve) {
    out.push('## 7 S-Curve 分析');
    out.push('');
    out.push(data.sCurve);
    out.push('');
  }

  if (data.reportMd) {
    out.push('## 8 综合分析');
    out.push('');
    out.push(data.reportMd);
    out.push('');
  }

  out.push('## 9 结论与展望');
  out.push('');
  out.push(
    `本研究通过 TRIZ 方法论系统分析了 "${title}" 的核心技术问题，` +
    `给出了基于发明原理的解决方案与实施路线图。` +
    `后续工作将聚焦于实验验证、原型迭代与跨领域应用迁移。`
  );
  out.push('');

  if (data.references) {
    out.push('## 参考文献');
    out.push('');
    if (Array.isArray(data.references?.entries)) {
      data.references.entries.forEach((e: any, i: number) => {
        out.push(`[${i + 1}] ${e.title || e.citation || JSON.stringify(e)}`);
      });
    } else if (typeof data.references === 'string') {
      out.push(data.references);
    }
    out.push('');
  }

  return out.join('\n');
}

export async function executeWriteCommand(cmd: WriteCommand, workspaceRoot: string): Promise<string> {
  const data = await loadResearchData(cmd, workspaceRoot);
  const content = composeWritePaper(cmd.title, cmd.phase, data);
  await writePaperToFile(content, cmd.writePath, workspaceRoot);
  const parts = [];
  if (data.contradictions) parts.push('矛盾分析');
  if (data.solutions) parts.push('方案');
  if (data.trends) parts.push('趋势');
  const summary = parts.length > 0 ? `包含${parts.join('、')}` : '';
  return `已写入 \`${cmd.writePath}\`（${content.length} 字符）。${summary}`;
}

export interface ResearchData {
  reportMd: string | null;
  synthesisMd: string | null;
  contradictions: string | null;
  solutions: string | null;
  trends: string | null;
  roadmap: string | null;
  trl: string | null;
  sCurve: string | null;
  references: any;
}

export async function loadResearchData(cmd: WriteCommand, workspaceRoot: string): Promise<ResearchData> {
  const phaseDir = path.join(workspaceRoot, cmd.phase);

  const [reportMd, synthesisMd, contradictions, solutions, trends, roadmap, trl, sCurve, references] = await Promise.all([
    readTextFileSafe(path.join(phaseDir, 'report.md'), 3000),
    readTextFileSafe(path.join(workspaceRoot, '04_Synthesize', 'synthesis_report.md'), 1000),
    readTextFileSafe(path.join(workspaceRoot, '03_Analyze', 'contradictions.md'), 500),
    readTextFileSafe(path.join(workspaceRoot, '04_Synthesize', 'solutions.md'), 500),
    readTextFileSafe(path.join(workspaceRoot, '04_Synthesize', 'trends.md'), 500),
    readTextFileSafe(path.join(workspaceRoot, '04_Synthesize', 'roadmap.md'), 500),
    readTextFileSafe(path.join(workspaceRoot, '02_TRL', 'trl_assessment.md'), 200),
    readTextFileSafe(path.join(workspaceRoot, '02_TRL', 's_curve.svg'), 200),
    readJsonFileSafe(path.join(workspaceRoot, '06_References', 'library.md')),
  ]);

  return { reportMd, synthesisMd, contradictions, solutions, trends, roadmap, trl, sCurve, references };
}

export async function writePaperToFile(content: string, writePath: string, workspaceRoot: string): Promise<void> {
  const targetPath = path.join(workspaceRoot, writePath);
  const targetDir = path.dirname(targetPath);
  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(targetPath, content, 'utf8');
}

export function buildPaperPrompt(title: string, data: ResearchData): string {
  const sections: string[] = [];

  sections.push(`你是 Research Master — self-directed, tool-first research agent。请基于以下研究数据撰写一篇完整的技术论文（7-phase pipeline: Problem→Context→Evidence→Modeling→TRIZ→Validation→Execution），标题："${title}"\n`);
  sections.push('要求：');
  sections.push('1. 用 39 个工程参数、40 条发明原理、76 个标准解驱动 contradictions→solutions，importance-weighted KPIs，evidence 评分');
  sections.push('2. 使用 PEST + SWOT + 5W1H + PICO + PRISMA 框架组织背景、证据、PRISMA 流程');
  sections.push('3. 输出结构：摘要 → 引言 → 矛盾分析 → 物场分析 → 解决方案 → S 曲线 → 路线图 → TRL → 风险与≤3 天可执行验证 → 结论 → 参考文献');
  sections.push('4. 内容专业、逻辑清晰、学术规范；evidence 行内注明 score/weight；decision factors 与 risks 显式列出');
  sections.push('5. 不要编造参数编号、案例、数据；不确定时调用 websearch');
  sections.push('6. 所有汉字必须为有效 UTF-8，不可出现乱码、缺字或编码错误\n');

  if (data.synthesisMd) {
    sections.push('## 综合研究报告\n' + data.synthesisMd + '\n');
  }

  if (data.contradictions) {
    sections.push('## 技术矛盾分析\n');
    sections.push(data.contradictions);
    sections.push('\n');
  }

  if (data.solutions) {
    sections.push('## 解决方案\n');
    sections.push(data.solutions);
    sections.push('\n');
  }

  if (data.trends) {
    sections.push('## 技术发展趋势\n');
    sections.push(data.trends);
    sections.push('\n');
  }

  if (data.roadmap) {
    sections.push('## 实施路线图\n');
    sections.push(data.roadmap);
    sections.push('\n');
  }

  if (data.trl) {
    sections.push('## 技术成熟度评估\n');
    sections.push(data.trl);
    sections.push('\n');
  }

  if (data.reportMd) {
    sections.push('## 阶段报告\n' + data.reportMd + '\n');
  }

  sections.push('\n请基于以上数据撰写完整论文，直接输出 markdown 格式内容（≤4 行/段、importance-weighted、copy-ready），不要包含任何 XML 标签或 JSON。文末追加"## ≤3-Day Validation 实验"清单。');
  return sections.join('\n');
}
