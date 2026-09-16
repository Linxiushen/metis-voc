"""根据 source-registry.yaml 实例化 enabled adapter。"""
from __future__ import annotations

from typing import Any

from ..config_loader import source_registry
from .base import BaseAdapter
from .sp_api_catalog import SpApiCatalogAdapter
from .keepa import KeepaAdapter
from .dataforseo_reviews import DataForSeoReviewsAdapter

# 源标识 → adapter 类。新增源在此登记即可插拔。
_ADAPTER_MAP: dict[str, type[BaseAdapter]] = {
    "sp_api.catalog": SpApiCatalogAdapter,
    "keepa": KeepaAdapter,
    "dataforseo.reviews": DataForSeoReviewsAdapter,
}


def build_enabled_adapters(marketplace: str) -> list[BaseAdapter]:
    """读 registry，返回所有 enabled 且已实现的 adapter 实例。"""
    reg = source_registry()
    adapters: list[BaseAdapter] = []

    # SP-API（自有基座）
    if reg.get("sp_api", {}).get("enabled"):
        cfg = reg["sp_api"]["endpoints"].get("catalog_items", {})
        adapters.append(SpApiCatalogAdapter(marketplace, cfg))

    # 竞品情报
    ci = reg.get("competitor_intel", {})
    if ci.get("keepa", {}).get("enabled"):
        adapters.append(KeepaAdapter(marketplace, ci["keepa"]))

    # 评论抓取（主力 DataForSEO）
    rs = reg.get("review_scrapers", {})
    if rs.get("primary", {}).get("dataforseo", {}).get("enabled"):
        adapters.append(DataForSeoReviewsAdapter(marketplace, rs["primary"]["dataforseo"]))

    return adapters
