import { PhaseId } from './types.js';

export function getReadmeTemplate(phaseId: PhaseId, projectName: string): string {
  const templates: Record<PhaseId, () => string> = {
    '00_Init': () => `# 00 — 初始化与规划 (Init & Planning)

## 本阶段目标

明确研究问题、选择研究方法论、创建项目结构、制定全流程研究计划。

## 输入

- 研究问题描述（用户提供）

## 输出

| 文件 | 说明 |
|------|------|
| \`research_question.md\` | 研究问题正式定义 |
| \`methodology_plan.md\` | 方法论选择与理由 |
| \`../TODOS.yaml\` | 全流程任务分解 |

## 可选研究方法

- **问题定义**: 5W1H, PICO (循证研究), TRIZ 初始形势分析
- **方法论选择**: 定量/定性/混合方法 / TRIZ / 设计研究
- **研究框架**: 系统综述 (PRISMA), 设计科学研究 (DSR), 行动研究

## 使用方法

1. 编辑 \`research_question.md\` 明确研究问题
2. 查看 \`methodology_plan.md\` 确认方法论
3. 运行 \`/trp survey\` 进入下一阶段
`,
    '01_Survey': () => `# 01 — 调研扫描 (Survey & Search)

## 本阶段目标

系统检索学术文献、专利、技术方案，构建研究的知识基础。

## 输入

- \`../00_Init/research_question.md\` — 研究问题
- \`../00_Init/methodology_plan.md\` — 方法论选择

## 输出

| 文件 | 说明 |
|------|------|
| \`keywords.md\` | 检索关键词和检索策略 |
| \`search_results/patents.json\` | 专利搜索结果 |
| \`search_results/papers.json\` | 学术论文搜索结果 |
| \`search_results/tech_solutions.json\` | 技术方案搜索结果 |
| \`search_summary.md\` | 搜索结果汇总与质量评估 |

## 可选研究方法

- **系统文献综述**: PRISMA 流程（筛选 → 合格性 → 纳入）
- **专利景观分析**: IPC 分类聚类、专利地图
- **技术扫描**: STEEP 框架（社会/技术/经济/生态/政治）
- **TRIZ**: 功能分析、因果链分析

## 使用方法

1. 运行 \`/trp survey\` — AI 自动提取关键词并搜索
2. 检查搜索结果，可补充或修改关键词后重新运行
3. 满意后运行 \`/trp trl\` 进入 TRL 评估阶段
`,
    '02_TRL': () => `# 02 — TRL 技术成熟度评估 (TRL Assessment)

## 本阶段目标

评估技术的就绪水平（TRL 1-9）、判断 S 曲线阶段、识别技术生命周期位置。

## 输入

- \`../01_Survey/search_results/\` — 搜索结果
- \`../01_Survey/search_summary.md\` — 搜索汇总

## 输出

| 文件 | 说明 |
|------|------|
| \`trl_assessment.json\` | TRL 1-9 逐级评估结果 |
| \`s_curve.json\` | S 曲线参数与阶段判断 |
| \`maturity_evidence.md\` | 成熟度证据与来源 |

## 评估方法

- **TRL**: 技术就绪水平 1-9 级（NASA/DOE 标准），证据驱动
- **S 曲线**: Logistic 模型拟合，4 阶段判断（婴儿期/成长期/成熟期/衰退期）
- **技术生命周期**: 发明年 → 增长 → 成熟 → 峰值 → 衰退
- **证据要求**: TRL 1-3 需基础研究论文，TRL 4-6 需实验室/中试验证，TRL 7-9 需工程/商业化证据

## 使用方法

1. 确保 01_Survey 已完成并有搜索结果
2. 运行 \`/trp trl\` — AI 评估 TRL 等级并生成 S 曲线
3. 审查评估结果，可补充资料后重新评估
4. 满意后运行 \`/trp analyze\` 进入分析阶段
`,
    '03_Analyze': () => `# 03 — 分析解构 (Analyze & Deconstruct)

## 本阶段目标

从搜索结果中提取技术矛盾、识别瓶颈，为创新提供依据。

## 输入

- \`../01_Survey/search_results/\` — 搜索结果
- \`../02_TRL/trl_assessment.json\` — TRL 评估结果
- \`../02_TRL/s_curve.json\` — S 曲线分析

## 输出

| 文件 | 说明 |
|------|------|
| \`contradictions.json\` | TRIZ 矛盾分析结果 |
| \`bottlenecks.json\` | 技术瓶颈与根因分析 |
| \`analysis_summary.md\` | 分析综合报告 |

## 可选研究方法

- **TRIZ 矛盾矩阵**: 39 工程参数 × 39 参数矩阵查询
- **物场分析 (Su-Field)**: 76 个标准解匹配
- **根因分析**: 5-Why, 因果链分析
- **文献综合**: 主题聚类、引用网络分析

## 使用方法

1. 运行 \`/trp analyze\` — AI 综合分析所有搜索结果
2. 检查分析结果，可补充资料后重新运行
3. 满意后运行 \`/trp synthesize\` 进入创新阶段
`,
    '04_Synthesize': () => `# 04 — 创新综合 (Synthesize & Innovate)

## 本阶段目标

基于分析结果生成创新方案、比较不同技术路线、预测发展趋势。

## 输入

- \`../00_Init/init_doc.json\` — 研究问题与方法论
- \`../02_TRL/trl_assessment.json\` — TRL 技术成熟度
- \`../02_TRL/s_curve.json\` — S 曲线分析
- \`../03_Analyze/contradictions.json\` — 矛盾分析
- \`../03_Analyze/bottlenecks.json\` — 瓶颈与根因分析
- \`../03_Analyze/su_field_analysis.json\` — Su-Field 分析
- 用户 amendments — 用户补充说明

## 输出

| 文件 | 说明 |
|------|------|
| \`solutions.json\` | 生成的创新方案列表 |
| \`comparison.json\` | 方案比较矩阵 |
| \`trends.json\` | 技术趋势预测 |
| \`roadmap.json\` | 技术路线图 |
| \`principles_applied.json\` | 应用的 TRIZ 原理 |
| \`ai_raw_response.txt\` | AI 原始响应备份 |

## 可选研究方法

- **TRIZ 40 发明原理**: 矛盾 → 原理匹配与具体化
- **ARIZ 算法**: 系统性创新问题解决算法
- **技术进化趋势**: TRIZ 8 大进化趋势分析
- **理想度评估**: Benefits / (Costs + Harms)
- **多准则决策**: AHP 层次分析、TOPSIS

## 使用方法

1. 运行 \`/trp synthesize\` — AI 基于分析结果生成方案
2. 审查方案，可调整参数后重新生成
3. 满意后运行 \`/trp deliver\` 进入输出阶段
`,
    '05_Deliver': () => `# 05 — 输出交付 (Deliver & Report)

## 本阶段目标

将所有阶段成果综合为最终输出：学术论文、技术报告、可行性分析等。

## 输入

- 所有先前阶段的输出文件

## 输出

| 文件 | 说明 |
|------|------|
| \`report.md\` | 主要报告/论文 |
| \`executive_summary.md\` | 执行摘要 |
| \`presentation/\` | 演示材料 |
| \`appendix/\` | 附录（数据、图表、代码） |

## 可选输出模板

- **学术论文**: IMRaD 格式（引言 → 方法 → 结果 → 讨论）
- **技术报告**: 问题 → 方法 → 分析 → 结论 → 建议
- **可行性分析**: 市场 → 技术 → 经济 → 风险 → 建议
- **TRIZ 技术预测报告**: 专利景观 → 矛盾分析 → 进化趋势 → 路线图

## 使用方法

1. 运行 \`/trp deliver\` 生成报告
2. 编辑生成的报告，AI 辅助完善各部分
3. 最终输出到 \`report.md\`
`,
    '06_References': () => `# 06 — 文献资料管理 (References Management)

## 本阶段目标

集中管理所有引用文献、参考资料和原文附件，确保引用规范。

## 管理规范

- 所有引用统一使用 BibTeX 格式 (\`library.bib\`)
- 结构化元数据存储在 \`library.json\`
- 阅读笔记放在 \`annotations/\` 目录
- 原文 PDF 放在 \`fulltext/\` 目录

## 文件说明

| 文件 | 说明 |
|------|------|
| \`library.bib\` | BibTeX 文献数据库 |
| \`library.json\` | 结构化引用元数据 |
| \`annotations/\` | 文献阅读笔记 |
| \`fulltext/\` | 原文 PDF 附件 |

## 引用格式

- 学术论文: GB/T 7714 (中文) / APA / IEEE / MLA
- 专利: 专利号 + 标题 + 申请人 + 公开日
- 技术报告: 机构 + 报告编号 + 年份

## 使用建议

- 所有引用在纳入时即添加 BibTeX 条目
- 阅读笔记标注关键发现、方法、局限性
- 定期检查重复引用
`,
  };

  const templateFn = templates[phaseId];
  if (!templateFn) return `# ${phaseId}\n\nPhase description not available.\n`;
  return templateFn();
}

export function getProjectReadmeTemplate(projectName: string, problem: string): string {
  return `# ${projectName} — 研究项目

## 研究问题

${problem}

## 目录结构

\`\`\`
${projectName}/
├── TODOS.yaml          # 任务进度（程序读写）
├── TODOS.md            # 任务进度（人类可读，自动生成）
├── README.md           # 本文件
├── 00_Init/            # 初始化与规划
├── 01_Survey/          # 调研扫描
├── 02_TRL/             # TRL 技术成熟度评估
├── 03_Analyze/         # 分析解构
├── 04_Synthesize/      # 创新综合
├── 05_Deliver/         # 输出交付
└── 06_References/      # 文献资料管理
\`\`\`

## 使用方法

\`\`\`
/trp init            — 初始化项目（已执行）
/trp survey          — 运行调研阶段
/trp trl             — 运行 TRL 评估阶段
/trp analyze         — 运行分析阶段
/trp synthesize      — 运行创新阶段
/trp deliver         — 生成最终输出
/trp status          — 查看进度
/trp suggest         — AI 建议下一步
\`\`\`

## 阶段流程

每个阶段的 README 文件包含：阶段目标、输入输出、可选方法、使用说明。
运行下一阶段前请确认当前阶段所有 TODO 已完成。
`;
}
