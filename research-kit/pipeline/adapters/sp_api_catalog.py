"""SP-API Catalog Items 适配器（自有数据基座）。

⚠️ 硬边界：SP-API 只返回授权卖家自有数据 + 公开 ASIN 的「当前」快照。
   竞品历史销量/BSR/评论 拿不到 → 由 Keepa/DataForSEO adapter 补齐。

对齐 source-registry.yaml sp_api.endpoints.catalog_items（v2022-04-01）。
限流：searchCatalogItems / getCatalogItem 2 rps / burst 2。
计费：2026-01-31 起第三方开发者 GET 计费 → 逐 ASIN GET 压最低，优先批量。
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Iterator, Optional

from ..models import Cursor, RawRecord
from .base import BaseAdapter

INCLUDED_DATA = ["attributes", "identifiers", "images", "relationships",
                 "salesRanks", "summaries", "dimensions"]


class SpApiCatalogAdapter(BaseAdapter):
    source_key = "sp_api.catalog"
    official_api_available = True     # 本身即官方 API
    uses_scraper = False

    def __init__(self, marketplace: str, cfg: dict):
        super().__init__(marketplace, cfg)
        self.refresh_token = os.getenv("SP_API_REFRESH_TOKEN")
        self._access_token: Optional[str] = None

    def _entity(self) -> str:
        return "product"

    def fetch(self, target: str, cursor: Optional[Cursor]) -> Iterator[RawRecord]:
        """target = ASIN 或 品类关键词。产出 catalog 主数据 RawRecord。"""
        self._ensure_token()
        self.guard.throttle()

        # TODO: 真实调用 —— identifier 搜索（不占 keyword 50rps 限额）优先
        #   GET /catalog/2022-04-01/items/{asin}?marketplaceIds=..&includedData=..
        #   或 searchCatalogItems(keywords=target) 拉候选 ASIN 池
        payload = self._call_catalog(target)   # <- stub

        for item in payload.get("items", []):
            yield RawRecord(
                source=self.source_key,
                natural_key=item.get("asin", target),
                raw=item,
                event_ts=datetime.now(timezone.utc),
            )

    # --- 内部（stub）-----------------------------------------------------
    def _ensure_token(self) -> None:
        if self._access_token:
            return
        # TODO: LWA 换取 access_token（grant_type=refresh_token）
        if not self.refresh_token:
            raise RuntimeError("缺少 SP_API_REFRESH_TOKEN 环境变量")
        self._access_token = "TODO_LWA_ACCESS_TOKEN"

    def _call_catalog(self, target: str) -> dict:
        # TODO: 用 requests/httpx + SigV4/LWA header 真实请求
        #   注意：includedData=salesRanks 是 Catalog 唯一「接近公开」的热度信号（仅排名，无绝对销量）
        return {"items": [{
            "asin": target if target.startswith("B0") else "B0STUB0001",
            "summaries": [{"brand": "STUB", "itemName": target,
                           "modelNumber": "M-STUB"}],
            "salesRanks": [{"classificationRanks": [{"rank": 12345}]}],
            "identifiers": [{"identifiers": [{"identifierType": "UPC",
                                              "identifier": "000000000000"}]}],
            "relationships": [{"parentAsins": []}],
            "_note": "STUB 数据；接入真实 SP-API 后替换 _call_catalog",
        }]}
