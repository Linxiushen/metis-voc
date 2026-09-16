"""Gold → 报告模块转换器：把标注管道的 7 张 Gold 表转成前端 renderAny 契约形状，
作为「VOC 证据引擎」模块注入选品决策报告的 MIND_DECODE 之后。打通 清洗→打标签→展示。
"""
from __future__ import annotations

from collections import defaultdict

ASPECT_CN = {
    "QUALITY": "做工质量", "DURABILITY": "耐用性", "BATTERY": "续航/电池", "SIZE": "尺寸/合身",
    "FUNCTIONALITY": "功能", "SHIPPING": "物流/包装", "PRICE": "价格/性价比", "APPEARANCE": "外观",
    "SMELL_NOISE": "气味/噪音", "COMPATIBILITY": "兼容性", "INSTRUCTION": "说明书/安装",
    "CUSTOMER_SERVICE": "客服/售后", "OVERALL": "整体",
}
JTBD_CN = {
    "camping_outdoor": "露营户外", "tailgate_party": "后备箱聚会", "fishing": "钓鱼",
    "beach_pool": "沙滩泳池", "sports_event": "观赛", "backyard_patio": "庭院露台",
    "travel_portable": "便携出行", "office_desk": "居家办公", "gaming": "游戏", "gift_giving": "送礼",
    "everyday_home": "日常家用",
}
KANO_CN = {"must_have": "基本型(必备)", "performance": "期望型(性能)", "delighter": "兴奋型(惊喜)"}


def gold_to_module(g: dict) -> tuple[dict, dict]:
    ac = ASPECT_CN

    # 1) 机会白空间排序 → 横向条(用 sub 承接说明，避免被当 KPI)
    opp = [{"label": f"{o['asin']}·{ac.get(o['target'], o['target'])}",
            "value": round(o["opportunity_score"], 2),
            "sub": f"neg{o['neg_ratio_w']*100:.0f}% · 退货险{o['return_risk_rate']*100:.0f}% · {o['mention']}提及"}
           for o in g.get("gold_opportunity_whitespace_rank", [])[:8]]

    # 2) 差评方面（跨 asin 加权负面占比）→ 横向条
    agg = defaultdict(lambda: [0.0, 0.0])
    for r in g.get("gold_asin_aspect_rollup_weighted", []):
        agg[r["aspect_category"]][0] += r["neg_ratio_w"] * r["eff_mention"]
        agg[r["aspect_category"]][1] += r["eff_mention"]
    negbars = sorted(
        [{"label": ac.get(k, k), "value": round(v[0] / v[1] * 100, 1) if v[1] else 0.0}
         for k, v in agg.items()],
        key=lambda x: -x["value"])

    # 3) 方面重要度（与星级弹性）→ 横向条
    imp = [{"label": ac.get(i["aspect_category"], i["aspect_category"]),
            "value": i["importance_score"], "sub": f"弹性 {i['rating_elasticity']} · {i['role']}"}
           for i in g.get("gold_aspect_importance", [])[:8]]

    # 4) Kano 分类 → 表
    kano = {"columns": ["方面", "正面占比%", "负面占比%", "Kano 类型"],
            "rows": [{"方面": ac.get(k["aspect_category"], k["aspect_category"]),
                      "正面占比%": round(k["pos_share"] * 100), "负面占比%": round(k["neg_share"] * 100),
                      "Kano 类型": KANO_CN.get(k["kano_class"], k["kano_class"])}
                     for k in g.get("gold_kano_classification", [])]}

    # 5) 用途 × 方面 负面热力 → 热力图
    m = g.get("gold_usecase_aspect_matrix", [])
    jts = sorted({x["jtbd"] for x in m})
    asps = sorted({x["aspect_category"] for x in m})
    cellmap = {(x["jtbd"], x["aspect_category"]): x["cell_neg_ratio"] for x in m}
    heat = {"yLabels": [JTBD_CN.get(j, j) for j in jts], "xLabels": [ac.get(a, a) for a in asps],
            "matrix": [[round(cellmap.get((j, a), 0.0), 2) for a in asps] for j in jts],
            "min": 0, "max": 1} if m else {"columns": ["提示"], "rows": [{"提示": "样本不足"}]}

    # 6) 竞品方面 gap → 表
    cg = {"columns": ["ASIN", "方面", "本品加权极性", "竞品均值", "差值(正=占优)"],
          "rows": [{"ASIN": x["asin"], "方面": ac.get(x["aspect_category"], x["aspect_category"]),
                    "本品加权极性": x["my_avg_polarity_w"], "竞品均值": x["comp_avg_polarity_w"],
                    "差值(正=占优)": x["gap"]} for x in g.get("gold_competitor_gap", [])]}

    # 7) 加权 rollup → 表
    rt = {"columns": ["ASIN", "方面", "提及", "加权负面%", "加权极性", "退货险%"],
          "rows": [{"ASIN": r["asin"], "方面": ac.get(r["aspect_category"], r["aspect_category"]),
                    "提及": r["mention_count"], "加权负面%": round(r["neg_ratio_w"] * 100),
                    "加权极性": r["avg_polarity_w"], "退货险%": round(r["return_risk_rate"] * 100)}
                   for r in g.get("gold_asin_aspect_rollup_weighted", [])]}

    module = {
        "opportunity_whitespace": opp,
        "neg_aspect_weighted": negbars,
        "aspect_importance": imp,
        "kano": kano,
        "usecase_aspect_matrix": heat,
        "competitor_gap": cg,
        "weighted_rollup": rt,
    }
    meta = {
        "title": "VOC 证据引擎 · 评论标注 Gold（真实清洗+ABSA标注管道产出）",
        "nav_short": "VOC证据", "icon": "users",
        "subsections": [
            {"id": "opportunity_whitespace", "title": "机会白空间排序（改良切入点：高负面 × 提及 × 退货风险）"},
            {"id": "neg_aspect_weighted", "title": "差评方面（加权负面占比）"},
            {"id": "aspect_importance", "title": "方面重要度（与星级弹性 = 哪个方面最拉低评分）"},
            {"id": "kano", "title": "Kano 方面分类（必备 / 性能 / 惊喜）"},
            {"id": "usecase_aspect_matrix", "title": "用途 × 方面 负面热力（哪个细分在意哪个方面）"},
            {"id": "competitor_gap", "title": "竞品方面 gap（本品 vs 竞品池）"},
            {"id": "weighted_rollup", "title": "加权 rollup（asin × 方面 · 证据权重加权）"},
        ],
    }
    return module, meta
