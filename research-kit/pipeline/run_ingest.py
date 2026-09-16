"""采集入口：按 source-registry 跑所有 enabled adapter（MVP 骨架）。

用法：
    python -m pipeline.run_ingest --marketplace US --asins B0AAA,B0BBB --category "folding camping chair"

MVP 用本地 JSON 存 cursor；生产接 ingest_cursor 表（Paimon/Hologres）。
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Optional

from .adapters.registry import build_enabled_adapters
from .models import Cursor

_CURSOR_FILE = Path(__file__).resolve().parent.parent / "data" / "cursors.json"


def _load_cursors() -> dict:
    if _CURSOR_FILE.exists():
        return json.loads(_CURSOR_FILE.read_text(encoding="utf-8"))
    return {}


def _save_all(store: dict) -> None:
    _CURSOR_FILE.parent.mkdir(parents=True, exist_ok=True)
    _CURSOR_FILE.write_text(json.dumps(store, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--marketplace", default="US")
    ap.add_argument("--asins", default="", help="逗号分隔的竞品 ASIN")
    ap.add_argument("--category", default="", help="品类关键词（SP-API 候选池）")
    args = ap.parse_args()

    targets = [a for a in args.asins.split(",") if a] or ([args.category] if args.category else [])
    if not targets:
        raise SystemExit("请提供 --asins 或 --category")

    store = _load_cursors()

    def load_cursor(key) -> Optional[Cursor]:
        d = store.get("|".join(key))
        if not d:
            return None
        from dateutil import parser
        return Cursor(
            source=d["source"], marketplace=d["marketplace"], asin=d["asin"],
            entity=d["entity"],
            high_watermark=parser.parse(d["high_watermark"]) if d.get("high_watermark") else None,
            last_review_id=d.get("last_review_id"),
            last_page_token=d.get("last_page_token"),
        )

    def save_cursor(c: Cursor) -> None:
        store["|".join(c.key)] = {
            "source": c.source, "marketplace": c.marketplace, "asin": c.asin,
            "entity": c.entity,
            "high_watermark": c.high_watermark.isoformat() if c.high_watermark else None,
            "last_review_id": c.last_review_id, "last_page_token": c.last_page_token,
        }

    total = 0
    for adapter in build_enabled_adapters(args.marketplace):
        n = adapter.run(targets, load_cursor, save_cursor)
        print(f"[{adapter.source_key}] 写入 Bronze {n} 条")
        total += n

    _save_all(store)
    print(f"完成，共写入 {total} 条。Bronze 目录: data/bronze/")


if __name__ == "__main__":
    main()
