-- ============================================================================
-- 跨境选品数据管道 — Medallion 三层表结构 DDL
-- 语义：Apache Paimon / Iceberg（字段名可直接用；类型按引擎微调）
-- 层次：Bronze/ODS(贴源) -> Silver/DWD(清洗归一) -> Gold/DWS-ADS(消费就绪)
-- ============================================================================

-- ===================== BRONZE / ODS（贴源，原样落 JSON）=====================
-- 所有源统一模式：原始 payload + 采集元数据；append-only；供回溯重放
-- 幂等键 = (source, natural_key, event_ts / page_token)
CREATE TABLE bronze_raw_ingest (
    source        STRING,          -- keepa / sp_api.catalog / dataforseo.reviews / ...
    natural_key   STRING,          -- asin / review_id / query_id 等
    event_ts      TIMESTAMP,       -- 源事件时间（无则用采集时间）
    page_token    STRING,          -- 分页/任务令牌（幂等用）
    batch_id      STRING,
    raw           STRING,          -- 原始 JSON payload
    ingest_ts     TIMESTAMP,
    ingest_dt     DATE             -- 分区列
) PARTITIONED BY (ingest_dt);
-- 说明：也可按 source 拆多张贴源表；此处用统一表 + source 区分，便于统一回放。


-- ============================ SILVER / DWD ==================================

-- 商品主数据（SCD2 缓变维）：品牌/类目/变体结构 随时间变化留痕
CREATE TABLE dim_asin_scd2 (
    marketplace         STRING,
    asin                STRING,
    parent_asin         STRING,
    product_key         STRING,          -- 跨站点跨变体归一键（见 map_asin_product）
    brand               STRING,
    title               STRING,
    root_category       STRING,
    category_path       ARRAY<STRING>,
    variation_theme     STRING,          -- size/color/style/flavor（类目相关）
    attr_color          STRING,
    attr_size           STRING,
    attr_style          STRING,
    attributes          MAP<STRING,STRING>,   -- 半结构化，吸收未知/演进的变体轴
    buybox_seller_id    STRING,
    review_sharing_policy STRING,         -- 记录 2026-02~05 评论共享政策口径切换点
    valid_from          TIMESTAMP,
    valid_to            TIMESTAMP,
    is_current          BOOLEAN,
    hash_diff           STRING,           -- 变更检测
    ingest_ts           TIMESTAMP
    -- 逻辑主键 (marketplace, asin, valid_from)
) PARTITIONED BY (marketplace);
-- 排序键建议 (product_key, asin)；MERGE 原子 upsert 更新 SCD2

-- 跨站点跨变体归一桥接维（每 ASIN 一行）
CREATE TABLE map_asin_product (
    asin         STRING,          -- 主键
    marketplace  STRING,
    product_key  STRING,
    parent_asin  STRING,
    match_rule   STRING,          -- gtin / upc / ean / brand_model / parent
    gtin         STRING,
    updated_at   TIMESTAMP
);

-- 变点事实表：BSR/价格/评分/评论数 高频时序（贴合 Keepa csv 变点，只在值变时落点）
CREATE TABLE fact_price_history (
    asin         STRING,
    metric_type  STRING,          -- AMAZON/NEW/USED/SALES(BSR)/RATING/COUNT_REVIEWS/BUYBOX...
    event_ts     TIMESTAMP,
    value_int    BIGINT,
    prev_value   BIGINT,
    source       STRING,
    ingest_ts    TIMESTAMP
    -- 主键 (asin, metric_type, event_ts)
) PARTITIONED BY (month(event_ts));
-- Z-order/sort (asin, metric_type, event_ts)；MoR 引擎；支持精确回放任意时刻状态
-- Keepa 时间换算：unixMillis = (keepaMinute + 21564000) * 60000；价格整数分(4900=$49.00)；-1=缺失
-- Keepa CsvType 常量：0=AMAZON,1=NEW,2=USED,3=SALES(BSR),4=LISTPRICE,8=LIGHTNING_DEAL,
--   9=WAREHOUSE,10=NEW_FBA,11-14=COUNT_*,16=RATING(0-50),17=COUNT_REVIEWS,18=BUY_BOX_SHIPPING

-- 评论主表
CREATE TABLE dwd_review (
    review_id         STRING,      -- 主键；原生 id 优先，无则复合键 hash
    asin              STRING,
    parent_asin       STRING,
    product_key       STRING,
    marketplace       STRING,
    reviewer_id_hash  STRING,      -- ⚠️ GDPR：哈希脱敏，不落 reviewer_name/profile/avatar
    rating            TINYINT,
    title             STRING,
    body              STRING,
    review_ts         TIMESTAMP,
    verified_purchase BOOLEAN,
    helpful_votes     INT,
    variant_color     STRING,
    variant_size      STRING,
    is_vine           BOOLEAN,
    lang              STRING,
    source            STRING,      -- 溯源：dataforseo/brightdata/...
    ingest_ts         TIMESTAMP,
    embedding         ARRAY<FLOAT> -- 语义检索/近似聚类（可移至 Hologres/Milvus）
) PARTITIONED BY (dt(review_ts));
-- 去重 MERGE ON review_id；跨源合并以复合键去重，保留 source 血缘

-- ABSA 四元组（方面级情感）：一条评论按句展开多行
CREATE TABLE dwd_review_absa (
    review_id       STRING,
    asin            STRING,
    product_key     STRING,
    sentence_idx    INT,
    aspect_term     STRING,        -- 如 "battery life"
    aspect_category STRING,        -- QUALITY/DURABILITY/BATTERY/SIZE/SHIPPING/PRICE/... 见 review-absa-taxonomy.yaml
    opinion_term    STRING,
    polarity        STRING,        -- pos / neg / neu
    polarity_score  FLOAT,         -- -1..1 连续
    confidence      FLOAT,
    model_version   STRING,        -- 幂等键：模型升级只回填新版本行
    extract_ts      TIMESTAMP
    -- 主键 (review_id, sentence_idx, aspect_term, model_version)
) PARTITIONED BY (aspect_category);

-- 官方 Customer Feedback 聚合主题（校准锚）
CREATE TABLE dwd_review_topics (
    asin              STRING,
    browse_node_id    STRING,
    topic_label       STRING,
    sentiment         STRING,      -- pos / neg
    mentions_count    INT,
    star_rating_impact FLOAT,
    customer_snippet  STRING,
    sort_by           STRING,      -- MENTIONS | STAR_RATING_IMPACT
    refreshed_week    DATE
);

-- 增量去重游标
CREATE TABLE ingest_cursor (
    source          STRING,
    marketplace     STRING,
    asin            STRING,
    entity          STRING,        -- product / review / timeseries
    last_review_ts  TIMESTAMP,
    last_review_id  STRING,
    last_page_token STRING,
    high_watermark  TIMESTAMP,
    updated_at      TIMESTAMP
    -- 主键 (source, marketplace, asin, entity)
);


-- ============================ GOLD / DWS-ADS ================================

-- forward-fill 规整日频时序（供 BI/特征），由 fact_price_history 变点补齐
CREATE TABLE fact_asin_metric_daily (
    asin         STRING,
    product_key  STRING,
    metric_type  STRING,
    dt           DATE,
    value        DECIMAL(18,4),
    value_ffill  DECIMAL(18,4),   -- 前值填充
    day_change   DECIMAL(18,4),
    ma7          DECIMAL(18,4),
    ma30         DECIMAL(18,4)
    -- 主键 (asin, metric_type, dt)
) PARTITIONED BY (dt);
-- CoW 引擎（读多写少规整表）

-- 选品指标宽表（Agent 主消费）
CREATE TABLE dws_asin_daily (
    asin             STRING,
    product_key      STRING,
    dt               DATE,
    bsr_avg30        DECIMAL(18,2),
    bsr_slope30      DECIMAL(18,6),   -- 30 日 BSR 斜率（趋势）
    price_volatility30 DECIMAL(18,4),
    buybox_win_rate  DECIMAL(9,4),
    rating_avg       DECIMAL(4,2),
    rating_trend     DECIMAL(9,4),
    review_growth7   INT,             -- 7 日新增评论
    neg_aspect_top5  ARRAY<STRUCT<category:STRING, neg_ratio:DECIMAL(5,4), mentions:INT>>,  -- 差评方面 TopN
    sales_point      INT,             -- 月销点估计（units/month）
    sales_ci_low     INT,
    sales_ci_high    INT,
    confidence_level STRING,          -- High / Medium / Low（Low 不进定量排序）
    source_flags     ARRAY<STRING>,   -- bsr / inventory / review_velocity / monthlySold
    anomaly_flags    ARRAY<STRING>    -- promo / stockout / bulk / thin_data
    -- 主键 (asin, dt)
) PARTITIONED BY (dt);

-- 利基机会分（OP_SCAN 主消费）
CREATE TABLE ads_niche_opportunity (
    niche_id            STRING,
    category            STRING,
    price_band          STRING,       -- 如 "15-25" / "25-50"
    demand_score        DECIMAL(5,4),
    growth_score        DECIMAL(5,4),
    competition_score   DECIMAL(5,4), -- 减项
    monetization_score  DECIMAL(5,4),
    season_score        DECIMAL(5,4),
    opportunity_score   DECIMAL(6,2), -- 0-100
    hard_gate_pass      BOOLEAN,      -- 分≥70 且 Top3评论<500 且合规低风险
    review_wall_top3    INT,          -- Top3 竞品评论墙高度
    scored_week         DATE
    -- 主键 (niche_id, scored_week)
) PARTITIONED BY (scored_week);
