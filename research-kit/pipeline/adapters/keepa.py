"""Keepa 适配器（竞品 BSR/价格/评分/评论数 时序 —— 补 SP-API 竞品缺口）。

对齐 source-registry.yaml competitor_intel.keepa。
产出：把 Keepa csv 二维数组解析为 fact_price_history 的「变点行」（只在值变时落点）。

⚠️ 已知坑（写进 caveats）：
- ratingCount 历史自 2025-04-09 停更 → 评论数趋势须切第三方逐条统计或 monthlySold
- monthlySold 仅月销≥50 才显示
- token 制：1 商品 = 1 token，1h 过期；按 tier 限 tokens/min，需退避
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Iterator, Optional

from ..models import Cursor, RawRecord
from .base import BaseAdapter

# Keepa csv 索引 → metric_type（详见 ddl-medallion.sql 注释）
CSV_METRIC = {0: "AMAZON", 1: "NEW", 2: "USED", 3: "SALES_BSR",
              4: "LISTPRICE", 16: "RATING", 17: "COUNT_REVIEWS", 18: "BUY_BOX"}
KEEPA_EPOCH_MIN = 21564000     # unixMillis = (keepaMinute + 21564000) * 60000


def keepa_minute_to_dt(keepa_minute: int) -> datetime:
    return datetime.fromtimestamp((keepa_minute + KEEPA_EPOCH_MIN) * 60, tz=timezone.utc)


class KeepaAdapter(BaseAdapter):
    source_key = "keepa"
    official_api_available = True     # 官方数据商 API（非抓取）
    uses_scraper = False

    def __init__(self, marketplace: str, cfg: dict):
        super().__init__(marketplace, cfg)
        self.api_key = os.getenv("KEEPA_API_KEY")

    def _entity(self) -> str:
        return "timeseries"

    def fetch(self, target: str, cursor: Optional[Cursor]) -> Iterator[RawRecord]:
        """target = 竞品 ASIN。产出各 metric_type 的变点行。"""
        if not self.api_key:
            raise RuntimeError("缺少 KEEPA_API_KEY 环境变量")
        self.guard.throttle()

        product = self._call_keepa(target)     # <- stub；TODO 真实 /product 请求
        wm = cursor.high_watermark if cursor else None

        csv = product.get("csv") or []
        for idx, metric in CSV_METRIC.items():
            # 真实 Keepa csv 为 list-of-lists（按 CsvType 位置索引，缺失为 None）；
            # 兼容 dict 形态（stub / 稀疏）。
            if isinstance(csv, dict):
                series = csv.get(idx)
            else:
                series = csv[idx] if idx < len(csv) else None
            if not series:
                continue
            # Keepa csv 交替存 [keepaMinute, value, keepaMinute, value, ...]，-1=缺失
            for i in range(0, len(series) - 1, 2):
                ts = keepa_minute_to_dt(series[i])
                value = series[i + 1]
                if value == -1:
                    continue
                if wm and ts <= wm:          # 增量：只取 watermark 之后的变点
                    continue
                yield RawRecord(
                    source=self.source_key,
                    natural_key=f"{target}|{metric}",
                    raw={"asin": target, "metric_type": metric,
                         "event_ts": ts.isoformat(), "value_int": value,
                         "parentAsin": product.get("parentAsin"),
                         "monthlySold": product.get("monthlySold")},
                    event_ts=ts,
                )

    # --- 内部（stub）-----------------------------------------------------
    def _call_keepa(self, asin: str) -> dict:
        # TODO: GET https://api.keepa.com/product?key=..&domain=1&asin=..&stats=90&history=1
        #   注意 token 退避：tokensLeft 不足时按 refillRate 等待
        return {
            "asin": asin, "parentAsin": None, "monthlySold": 2450,
            "csv": {  # STUB：真实为 list-of-lists，索引即 CSV_METRIC
                3: [3_500_000, 12345, 3_500_060, 11800],   # SALES_BSR 两个变点
                18: [3_500_000, 3299],                      # BUY_BOX $32.99
            },
            "_note": "STUB；接入真实 Keepa 后替换 _call_keepa（csv 为 list-of-lists）",
        }
