# 06 /download 下载器：九源竞速把论文稳稳拽到本地

系统综述筛选出的关键文献，必须落到本地才能被引用、批注与归档。TRINNO 的 `/download` 下载器以**并发竞速（race）多数据源**的策略，把"找全文"这一高频痛点变成一行命令。

## 一、九源竞速架构

`/download` 按优先级并发请求 **9+ 数据源**，取最先成功返回的可用结果：

1. arXiv
2. bioRxiv
3. OpenAlex
4. Zenodo
5. 出版商直连（Frontiers / MDPI / PLOS / PeerJ，按 DOI 前缀路由）
6. Crossref
7. Semantic Scholar
8. Europe PMC
9. Unpaywall

竞速（race）而非串行重试，使**成功率与延迟同时优化**：任一源可用即可交付，弱源拖慢不会阻塞整体。Unpaywall 需配置联系邮箱（其服务条款要求），用于兜底开放获取链接。

## 二、标识符识别

`/download` 接受多种入口，自动归一化：

- **DOI**：`10.1038/s41467-020-15478-4`
- **arXiv ID**：`arXiv:2201.12345`
- **PMID**：医学文献标识
- **URL**：出版页、PDF 直链，甚至开放镜像入口（如 PubScholar 的 `file.scholarin.cn/...`）

智能体在证据检索（`/search`）后，可直接把命中条目的标识符交给 `/download`，无需手工复制。

## 三、格式自动探测

下载内容按多层特征判定格式，而非仅看扩展名：

- **Magic bytes**：`%PDF-`（PDF）、`PK\x03\x04`（DOCX/ZIP）、`{\rtf1`（RTF）；
- **Content-Type** 与 **URL 扩展名** 交叉验证；
- 接受 PDF、DOCX、DOC、EPUB、HTML、RTF、TXT、ZIP 等。

探测失败或落空时，可改用 `/get <query>`（检索 + 自动下载首选）以多源重试。

## 四、归档与实证闭环

下载物默认写入工作区 `06_References/papers/`，并登记进 `library.md` 索引。这一落盘动作是 TRINNO **实证闭环**的关键一环：后续 `/patent`、`/write paper` 强制要求引用文献以 `06_References/` 中的真实文件存在为前提，杜绝"编造引用"。

## 五、小结

`/download` 以工程化的冗余竞速，把文献获取的"看运气"变为"高可用服务"。下一期进入 TRIZ 内核第一站：用 S 曲线与 TRL 给技术做成熟度体检。

---

*TRINNO 技术系列 · 第 6 期 / 共 20 期。*
