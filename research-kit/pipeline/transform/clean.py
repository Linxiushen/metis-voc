"""Silver 清洗 + 实体解析：Bronze 贴源记录 → 规范化 / 去重 / 品牌与商品归一 / 合规标记。

驱动配置：config/entity-resolution-rules.yaml（品牌归一 steps、product_key 回退优先级、
map_asin_product 桥接维表）。这是所有下游分析的地基（"跨站点是不是同一品牌 / 同一 SKU"）。

清洗做四件事：
  1. 规范化：去多余空白、货币/数字解析、品牌 lowercase+trim（alias_map 待接 brand-alias.yaml）
  2. 去重：listing 按 (marketplace, asin)；review 按 review_id
  3. 实体解析：按 GTIN→UPC→EAN→brand_model_fingerprint→parent_asin 回退生成稳定 product_key
  4. 过滤/合规：空/垃圾评论过滤（合规红旗见 pipeline/compliance.py）
"""
from __future__ import annotations

import hashlib
import re

from ..config_loader import entity_rules

_WS = re.compile(r"\s+")
_PRICE = re.compile(r"[^\d.]")


def _norm_text(s) -> str:
    return _WS.sub(" ", str(s or "").strip())


def _norm_brand(s) -> str:
    # entity-resolution-rules.brand_normalization.steps: lowercase, trim_whitespace, alias_map_lookup
    return _WS.sub(" ", str(s or "").strip().lower())


def _to_price(x):
    if x is None or x == "":
        return None
    try:
        return round(float(_PRICE.sub("", str(x))), 2)
    except ValueError:
        return None


def _to_int(x):
    try:
        return int(float(x))
    except (TypeError, ValueError):
        return None


def product_key(rec: dict, rules: dict) -> str:
    """按 entity-resolution priority 回退，生成跨站点/跨变体稳定的商品实体键。"""
    ident = {k.upper(): v for k, v in (rec.get("identifiers") or {}).items()}
    for k in ("GTIN", "UPC", "EAN"):
        if ident.get(k):
            return f"{k.lower()}:{ident[k]}"
    brand, model = _norm_brand(rec.get("brand")), _norm_text(rec.get("model_number"))
    if brand and model:
        fp = hashlib.md5(f"{brand}|{model}".encode()).hexdigest()[:12]
        return f"bm:{fp}"
    if rec.get("parent_asin"):
        return f"pa:{rec['parent_asin']}"
    return f"asin:{rec.get('marketplace', '')}:{rec.get('asin', '')}"


def clean_listings(rows: list[dict]) -> tuple[list[dict], list[dict]]:
    """规范化 listing + 去重 + 生成 map_asin_product 桥接维表。"""
    rules = entity_rules()
    seen, out, bridge = set(), [], []
    for r in rows:
        asin, mk = r.get("asin"), r.get("marketplace", "US")
        if not asin or (mk, asin) in seen:
            continue
        seen.add((mk, asin))
        pk = product_key(r, rules)
        out.append({
            "asin": asin, "marketplace": mk, "product_key": pk,
            "brand": _norm_brand(r.get("brand")), "title": _norm_text(r.get("title")),
            "price": _to_price(r.get("price")), "currency": r.get("currency", "USD"),
            "parent_asin": r.get("parent_asin"),
            "attrs": {k: _norm_text(v) for k, v in (r.get("attributes") or {}).items()},
        })
        bridge.append({
            "asin": asin, "marketplace": mk, "product_key": pk,
            "parent_asin": r.get("parent_asin"), "match_rule": pk.split(":")[0],
        })
    return out, bridge


def clean_reviews(rows: list[dict]) -> list[dict]:
    """规范化评论 + 去重(review_id) + 明显垃圾/空评过滤。"""
    seen, out = set(), []
    for r in rows:
        rid = r.get("review_id")
        if not rid or rid in seen:
            continue
        seen.add(rid)
        body = _norm_text(r.get("body") or r.get("text"))
        if len(body) < 4:            # 空/垃圾评论过滤
            continue
        out.append({
            "review_id": rid, "asin": r.get("asin"), "marketplace": r.get("marketplace", "US"),
            "rating": _to_int(r.get("rating")), "body": body,
            "verified": bool(r.get("verified", False)),
            "date": r.get("date"), "source": r.get("source", "dataforseo.reviews"),
        })
    return out
