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
    return { title: cleaned, phase, writePath: `${phase}/${slugifyPatentTitle(cleaned)}.md` };
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
    return { title: body, phase: '07_Patent', writePath: `07_Patent/${slugifyPatentTitle(body)}.md` };
  }

  const pattern = /^(?:撰写|写|起草)?\s*专利(?:\s*(?:申请书|申请|书))?(?:\s*[:：]|\s+)([\s\S]+)$|^(?:write\s+(?:a\s+)?patent(?:\s+application)?|patent(?:\s+application)?)\s*[:：]?\s*([\s\S]+)$/i;
  const m = t.match(pattern);
  if (!m) return null;
  const body = (m[1] ?? m[2] ?? '').trim();
  if (!body) return null;
  return { title: body, phase: '07_Patent', writePath: `07_Patent/${slugifyPatentTitle(body)}.md` };
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
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')); } catch { return null; }
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

export function composeWritePaper(title: string, phase: string, data: {
  reportMd: string | null; synthesisMd: string | null;
  contradictions: any[]; solutions: any[]; trends: any[];
  roadmap: any[]; trl: any; sCurve: any; references: any;
}): string {
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
    `为工程化应用提供理论与技术支撑。` +
    (data.contradictions.length > 0
      ? `本项目共识别 ${data.contradictions.length} 项核心技术矛盾，生成 ${data.solutions.length} 项候选方案，识别 ${data.trends.length} 项技术发展趋势。`
      : '')
  );
  out.push('');
  out.push('**关键词：** TRIZ；技术矛盾；GDL；发明原理；技术成熟度评估');
  out.push('');

  if (data.synthesisMd && data.synthesisMd.length > 0) {
    out.push('## 1 引言');
    out.push('');
    const intro = data.synthesisMd.split('\n').filter((l: string) => l.trim().length > 0).slice(0, 5).join(' ');
    out.push(intro || `${title} 是当前工程与学术研究的关键问题之一。`);
    out.push('');
  }

  if (data.contradictions.length > 0) {
    out.push('## 2 技术矛盾分析');
    out.push('');
    out.push(`基于 TRIZ 39 项工程参数 × 40 条发明原理的映射关系，本研究共识别 ${data.contradictions.length} 项核心技术矛盾。`);
    out.push('');
    data.contradictions.slice(0, 10).forEach((c: any, i: number) => {
      const desc = c.description || c.problem || c.title || JSON.stringify(c);
      const improve = c.improvingParameter || c.improving || c.improving_parameter || 'N/A';
      const worsen = c.worseningParameter || c.worsening || c.worsening_parameter || 'N/A';
      out.push(`### 矛盾 ${i + 1}`);
      out.push(`- **改善参数:** ${improve}`);
      out.push(`- **恶化参数:** ${worsen}`);
      out.push(`- **描述:** ${desc}`);
      out.push('');
    });
  }

  if (data.solutions.length > 0) {
    out.push('## 3 解决方案设计');
    out.push('');
    out.push(`基于上述矛盾分析，应用 TRIZ 40 条发明原理及物-场分析与 76 个标准解，得到 ${data.solutions.length} 项候选方案。`);
    out.push('');
    data.solutions.slice(0, 5).forEach((s: any, i: number) => {
      const name = s.title || s.name || s.solution || `方案 ${i + 1}`;
      const principles = Array.isArray(s.appliedPrinciples)
        ? s.appliedPrinciples.map((p: any) => p?.index ?? p).join(', ')
        : (s.principles || '');
      const desc = s.description || s.summary || '';
      out.push(`### 方案 ${i + 1}: ${name}`);
      if (principles) out.push(`- **应用原理:** ${principles}`);
      if (desc) out.push(`- **描述:** ${desc}`);
      out.push('');
    });
  }

  if (data.trends.length > 0) {
    out.push('## 4 技术发展趋势');
    out.push('');
    data.trends.slice(0, 8).forEach((t: any, i: number) => {
      const trend = t.trend || t.name || `趋势 ${i + 1}`;
      const horizon = t.horizon || t.timing || 'N/A';
      const drivers = Array.isArray(t.drivers) ? t.drivers.join('; ') : (t.drivers || t.description || '');
      out.push(`### 趋势 ${i + 1}: ${trend}`);
      out.push(`- **时间窗口:** ${horizon}`);
      if (drivers) out.push(`- **驱动因素:** ${drivers}`);
      out.push('');
    });
  }

  if (data.roadmap.length > 0) {
    out.push('## 5 实施路线图');
    out.push('');
    data.roadmap.slice(0, 6).forEach((p: any, i: number) => {
      const phaseName = p.phase || p.name || `阶段 ${i + 1}`;
      const focus = p.focus || p.objective || '';
      const actions = Array.isArray(p.actions) ? p.actions.join('; ') : (p.actions || '');
      out.push(`### 阶段 ${i + 1}: ${phaseName}`);
      if (focus) out.push(`- **核心目标:** ${focus}`);
      if (actions) out.push(`- **关键行动:** ${actions}`);
      out.push('');
    });
  }

  if (data.trl) {
    out.push('## 6 技术成熟度评估');
    out.push('');
    const lvl = data.trl.trlLevel || data.trl.level || data.trl.trl || 'N/A';
    out.push(`**当前 TRL 等级:** ${lvl}`);
    if (Array.isArray(data.trl.trlLevelBreakdown) && data.trl.trlLevelBreakdown.length > 0) {
      out.push('');
      out.push('各子维度评估:');
      data.trl.trlLevelBreakdown.forEach((b: any) => {
        out.push(`- ${b.dimension || b.name || b.aspect}: ${b.level ?? b.value ?? 'N/A'}`);
      });
    }
    out.push('');
  }

  if (data.reportMd && data.reportMd.length > 0) {
    out.push('## 7 综合分析');
    out.push('');
    const summary = data.reportMd.split('\n').filter((l: string) => l.trim().length > 0).slice(0, 20).join('\n');
    out.push(summary);
    out.push('');
  }

  out.push('## 8 结论与展望');
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
    if (Array.isArray(data.references.entries)) {
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
  return `已写入 \`${cmd.writePath}\`（${content.length} 字符）。包含 ${data.contradictions.length} 项矛盾、${data.solutions.length} 项方案、${data.trends.length} 项趋势。`;
}

export interface ResearchData {
  reportMd: string | null;
  synthesisMd: string | null;
  contradictions: any[];
  solutions: any[];
  trends: any[];
  roadmap: any[];
  trl: any;
  sCurve: any;
  references: any;
}

export async function loadResearchData(cmd: WriteCommand, workspaceRoot: string): Promise<ResearchData> {
  const phaseDir = path.join(workspaceRoot, cmd.phase);

  const [reportMd, synthesisMd, contradictions, solutions, trends, roadmap, trl, sCurve, references] = await Promise.all([
    readTextFileSafe(path.join(phaseDir, 'report.md'), 3000),
    readTextFileSafe(path.join(workspaceRoot, '04_Synthesize', 'synthesis_report.md'), 1000),
    normalizeArr(await readJsonFileSafe(path.join(workspaceRoot, '03_Analyze', 'contradictions.json'))),
    normalizeArr(await readJsonFileSafe(path.join(workspaceRoot, '04_Synthesize', 'solutions.json'))),
    normalizeArr(await readJsonFileSafe(path.join(workspaceRoot, '04_Synthesize', 'trends.json'))),
    normalizeArr(await readJsonFileSafe(path.join(workspaceRoot, '04_Synthesize', 'roadmap.json'))),
    readJsonFileSafe(path.join(workspaceRoot, '02_TRL', 'trl_assessment.json')),
    readJsonFileSafe(path.join(workspaceRoot, '02_TRL', 's_curve.json')),
    readJsonFileSafe(path.join(workspaceRoot, '06_References', 'library.json')),
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

  sections.push(`请基于以下研究数据撰写一篇完整的TRIZ技术论文，标题为："${title}"\n`);
  sections.push('要求：');
  sections.push('1. 深度分析技术矛盾和解决方案');
  sections.push('2. 结合TRIZ理论（39个工程参数、40条发明原理、76个标准解）');
  sections.push('3. 内容专业、逻辑清晰、学术规范');
  sections.push('4. 输出完整论文（摘要、引言、矛盾分析、解决方案、发展趋势、路线图、结论）');
  sections.push('5. 用中文撰写\n');

  if (data.synthesisMd) {
    sections.push('## 综合研究报告\n' + data.synthesisMd + '\n');
  }

  if (data.contradictions.length > 0) {
    sections.push('## 技术矛盾分析\n');
    sections.push(`共识别 ${data.contradictions.length} 项核心技术矛盾：\n`);
    data.contradictions.forEach((c: any, i: number) => {
      sections.push(`${i + 1}. 矛盾描述: ${c.description || c.problem || c.title || 'N/A'}`);
      sections.push(`   改善参数: ${c.improvingParameter || c.improving || 'N/A'}`);
      sections.push(`   恶化参数: ${c.worseningParameter || c.worsening || 'N/A'}`);
      if (c.principles && Array.isArray(c.principles)) {
        const principleNames = c.principles.map((p: any) => p.name || `原则#${p.index || 'N/A'}`).join(', ');
        sections.push(`   推荐原理: ${principleNames}`);
      }
      sections.push('');
    });
  }

  if (data.solutions.length > 0) {
    sections.push('## 解决方案\n');
    sections.push(`共 ${data.solutions.length} 项候选方案：\n`);
    data.solutions.forEach((s: any, i: number) => {
      sections.push(`${i + 1}. ${s.title || s.name || `方案${i + 1}`}`);
      sections.push(`   描述: ${s.description || s.summary || 'N/A'}`);
      if (s.appliedPrinciples && Array.isArray(s.appliedPrinciples)) {
        const principles = s.appliedPrinciples.map((p: any) => {
          if (typeof p === 'string') return p;
          return p.index ? `原则#${p.index}: ${p.name || ''}` : (p.name || JSON.stringify(p));
        }).join('; ');
        sections.push(`   应用原理: ${principles}`);
      }
      sections.push(`   可行性: ${s.feasibility || 'N/A'}, 影响度: ${s.impact || 'N/A'}`);
      sections.push('');
    });
  }

  if (data.trends.length > 0) {
    sections.push('## 技术发展趋势\n');
    data.trends.forEach((t: any, i: number) => {
      sections.push(`${i + 1}. ${t.trend || t.name || `趋势${i + 1}`}`);
      sections.push(`   时间窗口: ${t.horizon || t.timing || 'N/A'}`);
      sections.push(`   驱动因素: ${Array.isArray(t.drivers) ? t.drivers.join('; ') : (t.drivers || t.description || 'N/A')}`);
      sections.push('');
    });
  }

  if (data.roadmap.length > 0) {
    sections.push('## 实施路线图\n');
    data.roadmap.forEach((p: any, i: number) => {
      sections.push(`${i + 1}. ${p.phase || p.name || `阶段${i + 1}`}`);
      sections.push(`   核心目标: ${p.focus || p.objective || 'N/A'}`);
      sections.push(`   关键行动: ${Array.isArray(p.actions) ? p.actions.join('; ') : (p.actions || 'N/A')}`);
      sections.push('');
    });
  }

  if (data.trl) {
    sections.push('## 技术成熟度评估\n');
    const lvl = data.trl.trlLevel || data.trl.level || data.trl.trl || 'N/A';
    sections.push(`当前TRL等级: ${lvl}\n`);
    if (Array.isArray(data.trl.trlLevelBreakdown) && data.trl.trlLevelBreakdown.length > 0) {
      data.trl.trlLevelBreakdown.forEach((b: any) => {
        sections.push(`- ${b.dimension || b.name || b.aspect}: ${b.level ?? b.value ?? 'N/A'}`);
      });
    }
    sections.push('');
  }

  if (data.reportMd) {
    sections.push('## 阶段报告\n' + data.reportMd + '\n');
  }

  sections.push('\n请基于以上数据撰写完整论文，直接输出markdown格式内容，不要包含任何XML标签或JSON。');
  return sections.join('\n');
}
