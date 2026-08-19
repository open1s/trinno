# 04 PICO 与证据检索：把界定结果编译成可检索的研究问句

问题界定清楚之后，下一步往往不是立刻动手，而是**先看清前人做过什么**。TRINNO 用 **PICO** 把 5W1H 的拆解结果编译为结构化的证据检索骨架，再落到 `/search`、`/get` 等检索能力上，形成可复现的先验证据采集。

## 一、PICO / PICOS 框架

PICO 将研究问题形式化为四要素：

- **P — Population（人群/对象）**：谁或什么系统，含条件、设置（如" adults with T2DM, HbA1c 7–10% "）；
- **I — Intervention（干预）**：施加什么（如" GLP-1 agonist semaglutide 1mg weekly "）；
- **C — Comparison（对照）**：对照或基线（如" placebo + standard care "）；
- **O — Outcome（结局）**：测量效应（如" % HbA1c reduction at 26 weeks "）。

临床与循证场景可扩展为 **PICOS**，追加 **S — Study design**（RCT、队列、病例对照等）。标准模板：

```
PICO : In [P], does [I] vs [C] affect [O]?
PICOS: In [P], does [I] vs [C] affect [O]? (Study: [S])
```

## 二、在 TRINNO 中的角色：证据检索的骨架

PICO 的产出直接定义"要找什么证据"，使检索式与目标一一对应、可证伪、边界清晰。它也是 **PRISMA** 的上游输入——先用 PICO 框定问题，再用 PRISMA 的筛选级联去系统综述（见第 5 期）。

对工程/技术类问题，PICO 同样适用：把"对象"换成技术系统、"干预"换成待评估方案、"对照"换成基准方案、"结局"换成性能指标即可。

## 三、检索能力：多源、双语、去重

TRINNO 的先验检索（`/search`）覆盖 **Semantic Scholar、OpenAlex、Google Patents、USPTO** 等真实数据库，并遵循两条工程化原则：

- **双语并行**：对任一主题同时发起 **英文（EN）与中文（ZH）** 查询，覆盖中文期刊（如《自动化学报》《控制与决策》《机器人》），并以 **DOI / arXiv ID 去重**；
- **专利 + 论文同检**：一次检索兼顾科学与技术两条证据线。

示例：

```
/search event camera SLAM
/get interface engineering          # 检索并自动下载首选命中
/papers                             # 列出已下载文献与元数据
```

`/get` 是"检索 + 自动下载首选"的一步式入口；`/papers` 对工作区内的文献做元数据索引，便于回溯。

## 四、方法论路由

| 问题类型 | 路由 |
|---|---|
| 临床 / 生物医学循证 | **PICO** 界定 → **PRISMA** 综述 |
| 证据综合 / 文献综述 | **PRISMA**（PICO 已框定问题） |
| 技术壁垒 / 发明 | **TRIZ**（PICO 可辅助先验检索） |

## 五、小结

PICO 把"我想了解 X"升级为"我要找的是满足 P/I/C/O 的证据"，让检索从漫无目的变为可审计。下一期，我们顺着这条线索进入 PRISMA 的系统综述流程与 `/search` 的工程细节。

---

*TRINNO 技术系列 · 第 4 期 / 共 20 期。*
