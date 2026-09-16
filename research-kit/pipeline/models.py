"""数据类：贯穿采集层的原始记录与增量游标。"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, Optional
import json


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class RawRecord:
    """落 Bronze/ODS 的贴源记录，对齐 schemas/ddl-medallion.sql: bronze_raw_ingest。"""
    source: str                      # keepa / sp_api.catalog / dataforseo.reviews ...
    natural_key: str                 # asin / review_id / query_id
    raw: dict[str, Any]              # 原始 payload（原样保留，供回放）
    event_ts: Optional[datetime] = None   # 源事件时间（无则用采集时间）
    page_token: Optional[str] = None      # 分页/任务令牌（幂等用）
    batch_id: Optional[str] = None
    ingest_ts: datetime = field(default_factory=_utcnow)

    def idempotency_key(self) -> str:
        """Bronze 幂等键 = (source, natural_key, event_ts/page_token)。"""
        stamp = (self.event_ts.isoformat() if self.event_ts else None) or self.page_token or ""
        return f"{self.source}|{self.natural_key}|{stamp}"

    def to_jsonl(self) -> str:
        d = asdict(self)
        d["event_ts"] = self.event_ts.isoformat() if self.event_ts else None
        d["ingest_ts"] = self.ingest_ts.isoformat()
        return json.dumps(d, ensure_ascii=False)


@dataclass
class Cursor:
    """增量去重游标，对齐 ddl: ingest_cursor。"""
    source: str
    marketplace: str
    asin: str
    entity: str                      # product / review / timeseries
    high_watermark: Optional[datetime] = None
    last_review_id: Optional[str] = None
    last_page_token: Optional[str] = None
    updated_at: datetime = field(default_factory=_utcnow)

    @property
    def key(self) -> tuple[str, str, str, str]:
        return (self.source, self.marketplace, self.asin, self.entity)
