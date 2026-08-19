# 02 TRP 工作区与 /init：把方法论固化成可复现的工程基座

方法论的落地，首先取决于"工作产物放在哪里"。TRINNO 以 **TRP（Trinno Research Project）八阶段工作区** 将创新流程结构化，使每一阶段的方法论产出都有确定的落盘位置，从而实现过程可追溯、可复盘、可交接。

## 一、八阶段目录与产出映射

TRP 工作区由八个阶段目录构成，方向为"发现 → 评估 → 分析 → 综合 → 交付 → 证据 → 专利 → 自主研究"：

```
01_Discover  → 文献检索与发现：papers.md, patents.md, web_results.md
02_TRL       → 技术成熟度：s_curve.svg, trl_assessment.md
03_Analyze   → 矛盾/物场分析：contradictions.md, su_field_analysis.md, bottlenecks.md
04_Synthesize→ 方案综合：solutions.md, principles_applied.md, trends.md, roadmap.md
05_Deliver   → 交付物：paper.md, report.md
06_References→ 参考文献：下载 PDF、library.md、目录.md
07_Patent    → 专利草稿：patent.md
08_AutoResearch → 自主研究：scope.md, eval.md, experiments/, results/, validation/
```

关键设计：**每条斜杠命令都映射到工作区中的具体产物文件**。例如 `/contradiction` 的结果写入 `03_Analyze/contradictions.md`，`/download` 的文献落入 `06_References/papers/`。这让"对话"与"产物"不再割裂——智能体的推理最终沉淀为项目资产。

## 二、/init：一键脚手架

在 VS Code 中以空文件夹作为工作区根，打开 Research Assistant 面板（`Cmd+Shift+C` / `Ctrl+Shift+C`），输入 `/init` 即可：

- 为缺失的阶段目录创建标准骨架与起步 README；
- **安全可重跑**：已存在的目录与文件绝不被覆盖（never overwrites），可放心反复执行以补齐遗漏目录；
- 为 `08_AutoResearch` 生成 `scope.md` / `eval.md` 模板，供后续 `/auto` 使用。

工作区根可通过 `trinno.chat.trpWorkspace` 显式指定，或自动探测首个含 3+ 阶段目录的文件夹。

## 三、阶段纪律（Phase Discipline）

TRINNO 强调**按序推进、上游喂下游**：

- 各阶段可酌情跳过（已掌握先验知识可略过 01_Discover；成熟度无关可略过 02_TRL）；
- **分析先于综合**：务必先完成 03_Analyze 再做 04_Synthesize；
- **不跳级交付**：未完成前序阶段不要直接进入 07_Patent——智能体需要前序上下文才能产出有据可依的草稿。

这一纪律使八阶段不是装饰，而是约束智能体行为的"认知流水线"。

## 四、小结

TRP 工作区是整套方法论的载体：`/init` 在数秒内搭好舞台，后续所有框架（5W1H、PICO、PRISMA、TRIZ、SWOT、PEST）的产出均有归属。下一期从最前端的入口——5W1H 问题界定——讲起。

---

*TRINNO 技术系列 · 第 2 期 / 共 20 期。*
