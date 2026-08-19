# 05 PRISMA 综述流程：从海量文献到受控证据集

检索到文献只是开始。真正的科研严谨性在于——**你如何决定哪些文献该被纳入、依据什么、偏倚在哪里**。TRINNO 用 **PRISMA** 把这一过程规范为可复现的流水线，并与 `/search` 的检索能力打通。

## 一、PRISMA 的四级筛选级联

PRISMA（Preferred Reporting Items for Systematic Reviews and Meta-Analyses）以四级流程图界定系统综述的可复现性：

```
Identification（识别）  →  从多源数据库召回候选文献
Screening（筛选）       →  按标题/摘要排除明显不相关
Eligibility（合格性）   →  按纳入/排除标准全文审读
Included（纳入）        →  进入最终证据集
```

每一级都应有明确、事先定义的判定标准，而非临场主观取舍。这保证了"为什么这篇被排除"随时可回答。

## 二、偏倚风险表（risk-of-bias table）

PRISMA 不只在"收"，还在"评"。TRINNO 配套 **偏倚风险表**，对纳入文献的方法学质量做结构化评估（如随机化、盲法、失访、选择性报告等维度），使最终结论的可靠性可量化、可披露。

## 三、在 TRINNO 中的落点

PRISMA 是 01_Discover 与 06_References 的方法论底座：

- `/search` 负责 **Identification** 阶段的跨源召回（见第 4 期）；
- 检索结果写入 `01_Discover/papers.md`、`patents.md`，作为筛选与合格性审读的工作台；
- 最终纳入文献落入 `06_References/`，由 `library.md` 建索引、`目录.md` 做分类目录；
- 去重规则（DOI / arXiv ID）贯穿多级筛选，避免重复计数。

## 四、为什么 PRISMA 体现"智能"

机械的检索工具只管"找回来"，而 PRISMA 让智能体具备**元认知**：它知道自己在"筛选"而非"堆砌"，知道每一步的排除需要理由，知道最终集合存在偏倚。这种对过程本身的约束，是 AI 研究助手区别于搜索引擎的本质特征。

## 五、小结

PRISMA 把"我读了几篇相关文献"升级为"我按可审计流程得到了一个受控证据集"。下一期，我们看证据集如何落地到本地——`/download` 论文下载器的九源竞速机制。

---

*TRINNO 技术系列 · 第 5 期 / 共 20 期。*
