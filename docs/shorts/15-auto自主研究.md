# 15 /auto 自主研究：让智能体自己跑"假设—验证"循环

前述各框架解决"想清楚、找证据、出方案"。但当目标是**优化一个可量化指标**（如速度、精度、成本）或**搜索参数空间**时，TRINNO 提供更激进的能力——`/auto` 自主研究：智能体在约束下自己迭代"提出假设 → 执行 → 评估 → 修正"，直到目标达成或受阻。

## 一、自治循环的结构

```
/auto <hypothesis>
  → 读取 scope.md（研究范围）+ eval.md（固定评估指标）
  → 编写实验代码至 08_AutoResearch/code/
  → 运行实验，结果写入 08_AutoResearch/results/
  → 日志写入 08_AutoResearch/experiments/log_N.md
  → 自动链式进入下一轮（写入 auto_state.json 检查点）
  → 目标达成或受阻时停止，产出 experiments/summary.md
```

智能体**自动续跑**，无需每轮手动"继续"。检查点 `auto_state.json` 使其可中断、可恢复。

## 二、前置：scope.md 与 eval.md

运行 `/auto` 前需先 `/init` 生成模板并填好两份定义：

- **scope.md**：研究问题、约束（时间/算力/成本）、成功标准与指标目标、可修改文件范围（mutation surface）、终止条件；
- **eval.md**：主指标（名称/方向/测量方法）、次级指标、验证协议、基线（当前最佳）、接受/拒绝准则。

`eval.md` 在循环中途**锁定**，防止智能体为"刷分"偷偷改判标准——这是自主研究可靠性的关键护栏。

## 三、文件夹纪律

`08_AutoResearch/` 有严格分区，避免产物混杂：

```
code/          仅放脚本（.py/.sh/.js）
experiments/   仅放 markdown 日志与 summary
results/       数据文件（CSV/JSON/图表）
validation/    验证报告
```

代码不进 `experiments/`、数据不进 `experiments/`——分区使复盘与审计清晰。

## 四、适用与不适用

- **适合**：数值指标优化、参数空间搜索、可量化假设的验证、代码优化/重构；
- **不适合**：开放式研究问题（改用 `/goal`）、每轮需人工判断、单轮成本过高的任务（>$1/iter）。

## 五、小结

`/auto` 把"研究"从单轮问答升级为可长期自驱、可恢复、受 eval 锁定的闭环智能体。下一期看更轻量的目标治理——`/goal` 与 `/compact`。

---

*TRINNO 技术系列 · 第 15 期 / 共 20 期。*
