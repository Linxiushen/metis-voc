# pipeline — 跨境选品数据管道 MVP 采集骨架

基于 `config/source-registry.yaml` 驱动的可插拔采集 adapter 骨架。**这是骨架（skeleton），真实 API 调用处标注 `TODO`。**

## 目录结构

```
pipeline/
├── README.md
├── requirements.txt
├── config_loader.py          # 加载 config/*.yaml
├── compliance.py             # 合规护栏（robots/限速/GDPR脱敏）— 不可绕过
├── models.py                 # RawRecord / Cursor 数据类
├── run_ingest.py             # 入口：按 registry 跑所有 enabled adapter
├── adapters/
│   ├── base.py               # BaseAdapter 抽象基类（增量+幂等+护栏模板方法）
│   ├── registry.py           # 读 source-registry.yaml → 实例化 enabled adapter
│   ├── sp_api_catalog.py     # SP-API Catalog Items（自有基座）
│   ├── keepa.py              # Keepa 竞品 BSR/价格/评分时序（csv 变点解析）
│   └── dataforseo_reviews.py # DataForSEO 竞品评论全文（异步任务）
└── transform/
    └── sales_estimation.py   # 销量估算三源交叉 + 置信区间（core 差异化）
```

## 设计约束（与 config 对齐）

1. **官方 API 优先**：有官方 API 的源禁止抓取（`compliance.enforce_official_first`）。
2. **自有账号绝不抓取竞品**：SP-API adapter 只拉自有数据 + 公开快照。
3. **增量幂等**：每 adapter 用 `ingest_cursor` 维护 watermark；写 Bronze 用 MERGE 幂等键。
4. **合规内建**：所有出网请求过 `ComplianceGuard`（robots/限速/UA/GDPR 字段丢弃）。
5. **可回放**：Bronze append-only，原样落 JSON。

## 快速开始

从仓库根目录运行。此命令只检查原型的控制流，适配器真实 HTTP 调用仍待实现；不要据此认为已取得真实数据。Python 环境与网页应用独立。

```bash
cd research-kit
python -m venv .venv
# Activate your virtual environment before installing these optional dependencies.
python -m pip install -r pipeline/requirements.txt
python -m pipeline.run_ingest --marketplace US --category "folding camping chair"
```

## 待接入（TODO 优先级）

- [ ] SP-API LWA 鉴权与 RDT（若涉 PII）
- [ ] Keepa csv 二维数组 → `fact_price_history` 变点行解析
- [ ] DataForSEO 异步 task_post → tasks_ready → task_get 轮询
- [ ] Bronze 落地到 Paimon/Iceberg（当前骨架落本地 JSONL）
- [ ] 类目留评率校准回归（sales-estimation.yaml `default_review_rate`）
