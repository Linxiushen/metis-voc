"""Silver/Gold 转换入口：Bronze → 清洗+实体解析(Silver) → ABSA打标签+置信度(Gold) → 汇总。

用法：
    python -m pipeline.run_transform

无真实 Bronze 数据时用内置样例演示（含重复行/垃圾评论/品牌大小写变体/多站点，
以便看清"去重 / 实体归一 / 方面打标签 / 置信度分级"确实发生）。接真实源后把
`load_bronze_or_sample()` 换成读 data/bronze/*.jsonl 即可，clean/label 接口不变。
"""
from __future__ import annotations

import json
from pathlib import Path

from .transform.clean import clean_listings, clean_reviews
from .transform.label import label_reviews, gold_tables
from .transform.to_report import gold_to_module

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data"

# ---- 内置样例（贴源 Bronze 形态：故意含脏数据）--------------------------------
SAMPLE_LISTINGS = [
    {"asin": "B0CHAIRA", "marketplace": "US", "brand": "TrailKeeper ", "model_number": "TK-900",
     "title": "  Folding Camping Chair   Heavy Duty", "price": "$34.99", "identifiers": {"UPC": "0819273"}},
    {"asin": "B0CHAIRA", "marketplace": "US", "brand": "trailkeeper", "title": "dup row", "price": "34.99"},  # 重复 asin → 去重
    {"asin": "B0CHAIRB", "marketplace": "US", "brand": "TRAILKEEPER", "model_number": "TK-900",
     "title": "Folding Camping Chair (UK variant)", "price": "$29.90"},                                       # 同 brand+model → 同 product_key
    {"asin": "B0CHAIRC", "marketplace": "US", "brand": "Coleman", "model_number": "CM-XL",
     "title": "Oversized Padded Camp Chair", "price": "$48.00", "parent_asin": "B0PARENT"},
    {"asin": "B0CHAIRD", "marketplace": "DE", "brand": "TrailKeeper", "model_number": "TK-900",
     "title": "Klappstuhl Camping", "price": "€31,50", "currency": "EUR"},                                    # 跨站点同 SKU
]

SAMPLE_REVIEWS = [
    {"review_id": "r1", "asin": "B0CHAIRA", "rating": 2, "verified": True, "helpful_votes": 12,
     "date": "2026-06-01", "source": "dataforseo.reviews",
     "body": "The frame broke after two camping trips, very flimsy and not durable at all. Fell apart. Returning it."},
    {"review_id": "r1", "asin": "B0CHAIRA", "body": "dup review id", "source": "dataforseo.reviews"},          # 重复 review_id → 去重
    {"review_id": "r2", "asin": "B0CHAIRA", "rating": 5, "verified": True, "helpful_votes": 8,
     "date": "2026-05-20", "source": "sp_api.customer_feedback",
     "body": "Sturdy and well made, worth it. Comfortable for tall people, highly recommend for tailgating."},
    {"review_id": "r3", "asin": "B0CHAIRA", "rating": 1, "verified": False, "helpful_votes": 5,
     "date": "2026-04-15", "source": "dataforseo.reviews",
     "body": "Arrived damaged, packaging was crushed. Also overpriced for the quality."},
    {"review_id": "r4", "asin": "B0CHAIRA", "rating": 3, "verified": False, "helpful_votes": 9,
     "date": "2026-03-10", "source": "helium.reviews",
     "body": "Too small for a big and tall person, sizing runs small. Instructions were confusing to assemble. I wish it had more padding."},
    {"review_id": "r5", "asin": "B0CHAIRC", "rating": 5, "verified": True, "helpful_votes": 6,
     "date": "2026-05-05", "source": "sp_api.customer_feedback",
     "body": "Excellent padded chair, very comfortable and sturdy. Great value for the beach and pool."},
    {"review_id": "r6", "asin": "B0CHAIRC", "rating": 2, "verified": False, "helpful_votes": 3,
     "date": "2026-02-01", "source": "dataforseo.reviews",
     "body": "The cup holder stopped working and the fabric wore out fast. Not durable. Switched from my old Coleman."},
    {"review_id": "r7", "asin": "B0CHAIRA", "body": "ok", "source": "dataforseo.reviews"},                     # 垃圾/过短 → 过滤
    {"review_id": "r8", "asin": "B0CHAIRA", "rating": 5, "verified": False, "helpful_votes": 0,
     "date": "2026-06-10", "source": "dataforseo.reviews",
     "body": "I received this chair for free in exchange for an honest review. It's great and sturdy, love it."},  # 激励评论 → 降权
    {"review_id": "r9", "asin": "B0CHAIRA", "rating": 5, "verified": True, "helpful_votes": 0,
     "date": "2026-05-21", "source": "sp_api.customer_feedback",
     "body": "Sturdy and well made, worth it. Comfortable for tall people, highly recommend for tailgating."},   # 与 r2 雷同 → 刷单去重
]


def load_bronze_or_sample():
    """MVP：优先读 data/bronze/*.jsonl（真实源），否则回落内置样例。"""
    bronze = OUT / "bronze"
    listings, reviews = [], []
    if bronze.exists():
        for fp in bronze.glob("*.jsonl"):
            for line in fp.read_text(encoding="utf-8").splitlines():
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                raw = rec.get("raw", rec)
                src = (rec.get("source") or "").lower()
                if "review" in src:
                    reviews.append({**raw, "source": rec.get("source")})
                elif "catalog" in src or "sp_api" in src or "keepa" in src:
                    listings.append(raw)
    usable = any(l.get("brand") for l in listings) and any((r.get("body") or r.get("text")) for r in reviews)
    if not usable:   # Bronze 为空或仍是 stub（无品牌/无评论正文）→ 回落内置样例演示
        return SAMPLE_LISTINGS, SAMPLE_REVIEWS, True
    return listings, reviews, False


def _write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows), encoding="utf-8")


def _write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    raw_listings, raw_reviews, is_sample = load_bronze_or_sample()
    print(f"数据源：{'内置样例' if is_sample else 'data/bronze'} | 原始 listing {len(raw_listings)} · review {len(raw_reviews)}")

    # ---- Silver：清洗 + 实体解析 --------------------------------------------
    listings, bridge = clean_listings(raw_listings)
    reviews = clean_reviews(raw_reviews)
    _write_jsonl(OUT / "silver" / "listings.jsonl", listings)
    _write_jsonl(OUT / "silver" / "map_asin_product.jsonl", bridge)
    _write_jsonl(OUT / "silver" / "reviews.jsonl", reviews)
    keys = sorted({b["product_key"] for b in bridge})
    print(f"Silver 清洗：listing {len(raw_listings)}→{len(listings)}（去重 {len(raw_listings)-len(listings)}）"
          f" · review {len(raw_reviews)}→{len(reviews)}（去重/过滤 {len(raw_reviews)-len(reviews)}）")
    print(f"  实体解析 product_key（{len(keys)} 个稳定商品实体）：")
    from collections import defaultdict
    by_key = defaultdict(list)
    for b in bridge:
        by_key[b["product_key"]].append(f"{b['marketplace']}:{b['asin']}")
    for k, asins in by_key.items():
        merged = "  ⇐ 归并多 ASIN" if len(asins) > 1 else ""
        print(f"    {k:26s} = {', '.join(asins)}{merged}")

    # ---- Gold：专业标注（ABSA四元组 + 多维标签 + 可信度加权 + 7表聚合）------
    labeled = label_reviews(reviews)
    _write_jsonl(OUT / "gold" / "reviews_labeled.jsonl", labeled)
    g = gold_tables(labeled)
    for name, rows in g.items():
        _write_json(OUT / "gold" / f"{name}.json", rows)

    # 打通到前端：Gold → 报告模块（renderAny 形状），写入 SaaS 数据目录，供 engine 注入报告
    voc_module, voc_meta = gold_to_module(g)
    saas_data = ROOT / "saas" / "webapp" / "data"
    if saas_data.exists():
        _write_json(saas_data / "voc_gold.json", voc_module)
        _write_json(saas_data / "voc_gold_meta.json", voc_meta)
        print("  → 已写 saas/webapp/data/voc_gold.json（VOC 证据模块，报告 MIND_DECODE 之后可视化）")

    nquad = sum(len(r["quadruples"]) for r in labeled)
    conf = defaultdict(int)
    for r in labeled:
        conf[r["trust"]["source_conf_level"]] += 1
    spam = sum(1 for r in labeled if r["trust"]["spam_flags"])
    excl = sum(1 for r in labeled if not r["trust"]["in_quant_rollup"])
    print(f"Gold 标注：{len(labeled)} 评论 → {nquad} 条 ABSA 四元组 | 源置信 High {conf['High']}·Medium {conf['Medium']}·Low {conf['Low']}"
          f" | 反刷单命中 {spam} | 不进定量排序 {excl}")
    print(f"  Gold 表：加权rollup {len(g['gold_asin_aspect_rollup_weighted'])} · 方面重要度 {len(g['gold_aspect_importance'])}"
          f" · Kano {len(g['gold_kano_classification'])} · 用途×方面 {len(g['gold_usecase_aspect_matrix'])} · 竞品gap {len(g['gold_competitor_gap'])}")
    print("  机会白空间 Top（高负面×提及×退货风险 → 改良切入点）:")
    for o in g["gold_opportunity_whitespace_rank"][:4]:
        print(f"    #{o['rank']} {o['asin']}·{o['target']}  opp={o['opportunity_score']}"
              f"（neg {o['neg_ratio_w']*100:.0f}% · 退货险 {o['return_risk_rate']*100:.0f}% · {o['mention']}提及）")
    print("  方面重要度 Top（与星级弹性 = 哪个方面最拉低评分）:")
    for im in g["gold_aspect_importance"][:4]:
        print(f"    {im['aspect_category']:14s} importance={im['importance_score']} elasticity={im['rating_elasticity']} [{im['role']}]")
    ex = next((r for r in labeled if r["quadruples"] and r["labels"].get("intent")), labeled[0])
    L = ex["labels"]
    print(f"  标注样例 {ex['review_id']}（源置信 {ex['trust']['source_conf_level']} · 证据权重 {ex['trust']['evidence_weight']}"
          f"{' · 刷单标记 '+str(ex['trust']['spam_flags']) if ex['trust']['spam_flags'] else ''}）:")
    for q in ex["quadruples"][:3]:
        print(f"    ACOS [{q['aspect_category']}] 方面『{q['aspect_term'] or '隐式'}』/ 观点『{q['opinion_term']}』"
              f" → {q['polarity']} {q['polarity_score']}（conf {q['confidence']}{' ·退货险' if q['signals_return_risk'] else ''}）")
    print(f"    标签: 意图={L.get('intent')} 场景={L.get('use_case_jtbd')} 人群={L.get('persona')} "
          f"缺陷={L.get('defect_mode')} 未满足={L.get('feature_request')} 竞品={L.get('competitor')} 严重度={L.get('severity')} 情绪={L.get('emotion')}")
    print(f"\n[完成] 写出 data/silver/* · data/gold/(reviews_labeled + 6 张 Gold 表 + neg_aspect_top5)")


if __name__ == "__main__":
    main()
