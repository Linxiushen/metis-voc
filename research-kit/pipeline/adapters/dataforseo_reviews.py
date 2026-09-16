"""DataForSEO 适配器（竞品评论逐条全文 —— 主力性价比首选）。

对齐 source-registry.yaml review_scrapers.primary.dataforseo。
异步任务模型：task_post → tasks_ready → task_get/advanced。
增量：sort=recent + cutoff，只拉 last_run 之后；首采全量回填。
去重：原生 review_id 优先，无则复合键 hash（见 base 幂等 + 详细设计 §5.3）。
合规：出网前过 ComplianceGuard；GDPR 丢弃 reviewer 个人字段。
成本：$0.75–1.5 / 千条。
"""
from __future__ import annotations

import hashlib
import os
from datetime import datetime, timezone
from typing import Iterator, Optional

from ..models import Cursor, RawRecord
from .base import BaseAdapter


class DataForSeoReviewsAdapter(BaseAdapter):
    source_key = "dataforseo.reviews"
    official_api_available = False    # 抓取型数据商（评论无官方全文途径）
    uses_scraper = True               # 走 preflight 抓取护栏

    def __init__(self, marketplace: str, cfg: dict):
        super().__init__(marketplace, cfg)
        self.login = os.getenv("DATAFORSEO_LOGIN")
        self.password = os.getenv("DATAFORSEO_PASSWORD")

    def _entity(self) -> str:
        return "review"

    def fetch(self, target: str, cursor: Optional[Cursor]) -> Iterator[RawRecord]:
        """target = 竞品 ASIN。产出去 PII 的评论 RawRecord（增量）。"""
        if not (self.login and self.password):
            raise RuntimeError("缺少 DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD")

        # preflight（uses_scraper=True → 校验非自有账号、robots 等）
        self.guard.preflight(using_scraper=True, using_seller_account=False)
        self.guard.throttle()

        cutoff = cursor.high_watermark if cursor else None
        reviews = self._poll_reviews(target, cutoff)   # <- stub；TODO 异步轮询

        for r in reviews:
            review_ts = _parse_ts(r.get("timestamp"))
            if cutoff and review_ts and review_ts <= cutoff:
                continue                              # 增量边界
            clean = self.guard.sanitize_review(r)     # GDPR 脱敏
            review_id = clean.get("review_id") or _synth_review_id(target, self.marketplace, clean)
            yield RawRecord(
                source=self.source_key,
                natural_key=review_id,
                raw={**clean, "review_id": review_id, "asin": target,
                     "marketplace": self.marketplace},
                event_ts=review_ts,
            )

    # --- 内部（stub）-----------------------------------------------------
    def _poll_reviews(self, asin: str, cutoff: Optional[datetime]) -> list[dict]:
        # TODO: POST merchant/amazon/reviews/task_post (sort_by=recent, depth=..)
        #       轮询 merchant/amazon/reviews/tasks_ready
        #       GET  merchant/amazon/reviews/task_get/advanced/{id}
        return [{
            "review_id": "R-STUB-001", "rating": 2,
            "title": "Legs cracked", "review_text": "焊点第二次用就裂了",
            "timestamp": "2026-06-30 10:00:00 +00:00",
            "verified": True, "reviewer_name": "John D.",  # ← 会被 GDPR 丢弃
            "reviewer_id": "amzn1.account.STUB",           # ← 会被哈希脱敏
            "_note": "STUB；接入真实 DataForSEO 后替换 _poll_reviews",
        }]


def _parse_ts(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        from dateutil import parser
        return parser.parse(s).astimezone(timezone.utc)
    except Exception:
        return None


def _synth_review_id(asin: str, marketplace: str, r: dict) -> str:
    """无原生 id 时的稳定复合键：hash(asin|marketplace|date|rating|substr(text,0,120))。"""
    text = (r.get("review_text") or "")[:120]
    date = (r.get("timestamp") or "")[:10]
    basis = f"{asin}|{marketplace}|{date}|{r.get('rating')}|{text}"
    return "syn_" + hashlib.sha256(basis.encode()).hexdigest()[:20]
