"""BaseAdapter —— 采集 adapter 抽象基类（模板方法：增量 + 幂等 + 护栏）。"""
from __future__ import annotations

import abc
from pathlib import Path
from typing import Any, Iterable, Iterator, Optional

from ..compliance import ComplianceGuard
from ..models import Cursor, RawRecord

BRONZE_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "bronze"


class BaseAdapter(abc.ABC):
    """所有数据源 adapter 的基类。

    子类只需实现 `fetch()`（产出 RawRecord），基类负责：护栏 preflight、
    落 Bronze（幂等去重）、更新 cursor。
    """

    #: 源标识，如 "keepa" / "sp_api.catalog"；对应 source-registry.yaml
    source_key: str = ""
    #: 该源是否存在官方 API（用于 official_api_first 护栏）
    official_api_available: bool = False
    #: 是否走抓取（vs 官方 API 调用）
    uses_scraper: bool = False

    def __init__(self, marketplace: str, cfg: dict[str, Any]):
        self.marketplace = marketplace
        self.cfg = cfg
        self.guard = ComplianceGuard(
            source_key=self.source_key,
            official_api_available=self.official_api_available,
        )
        self._seen_keys: set[str] = set()  # 进程内去重；生产用 Bronze MERGE 反连接

    # --- 子类实现 ---------------------------------------------------------
    @abc.abstractmethod
    def fetch(self, target: str, cursor: Optional[Cursor]) -> Iterator[RawRecord]:
        """按 target（asin / 品类词）与 cursor 增量拉取，产出 RawRecord。"""

    # --- 模板方法（基类实现）---------------------------------------------
    def run(self, targets: Iterable[str],
            load_cursor, save_cursor) -> int:
        """对一批 target 执行采集，返回写入 Bronze 的新记录数。

        load_cursor(key)->Cursor|None ; save_cursor(Cursor) 由编排层注入
        （MVP 骨架用本地实现；生产接 ingest_cursor 表）。
        """
        written = 0
        for target in targets:
            cursor = load_cursor(self._cursor_key(target))
            self.guard.preflight(using_scraper=self.uses_scraper)
            for rec in self.fetch(target, cursor):
                if self._is_duplicate(rec):
                    continue
                self._write_bronze(rec)
                cursor = self._advance_cursor(cursor, target, rec)
                written += 1
            if cursor:
                save_cursor(cursor)
        return written

    # --- 幂等/去重 --------------------------------------------------------
    def _is_duplicate(self, rec: RawRecord) -> bool:
        key = rec.idempotency_key()
        if key in self._seen_keys:
            return True
        self._seen_keys.add(key)
        return False

    def _write_bronze(self, rec: RawRecord) -> None:
        """MVP：落本地 JSONL。生产：MERGE 写 Paimon/Iceberg bronze_raw_ingest。"""
        BRONZE_DIR.mkdir(parents=True, exist_ok=True)
        out = BRONZE_DIR / f"{self.source_key.replace('.', '_')}.jsonl"
        with out.open("a", encoding="utf-8") as f:
            f.write(rec.to_jsonl() + "\n")

    def _advance_cursor(self, cursor: Optional[Cursor], target: str,
                        rec: RawRecord) -> Cursor:
        cursor = cursor or Cursor(
            source=self.source_key, marketplace=self.marketplace,
            asin=target, entity=self._entity(),
        )
        if rec.event_ts and (cursor.high_watermark is None
                             or rec.event_ts > cursor.high_watermark):
            cursor.high_watermark = rec.event_ts
        if rec.page_token:
            cursor.last_page_token = rec.page_token
        return cursor

    def _cursor_key(self, target: str) -> tuple[str, str, str, str]:
        return (self.source_key, self.marketplace, target, self._entity())

    def _entity(self) -> str:
        return "product"
