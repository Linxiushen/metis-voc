"""合规护栏 —— 所有出网请求必须过这里，不可绕过。

对齐 config/source-registry.yaml `defaults` 与《数据管道详细设计》§8.3：
- 官方 API 优先（有官方 API 的源禁抓）
- 自有卖家账号绝不跑抓取
- robots.txt 遵守 + 请求限速 + 随机抖动
- GDPR：丢弃 reviewer 个人标识（昵称/头像/位置），reviewer_id 哈希脱敏
"""
from __future__ import annotations

import hashlib
import random
import time
import urllib.robotparser
from dataclasses import dataclass
from typing import Any

from .config_loader import source_registry

# GDPR 默认丢弃的评论个人字段
_GDPR_DROP_FIELDS = {
    "reviewer_name", "reviewer_profile", "reviewer_avatar",
    "reviewer_url", "reviewer_location", "profile_id",
}


class ComplianceError(RuntimeError):
    """违反合规护栏时抛出，中止该源采集。"""


@dataclass
class ComplianceGuard:
    source_key: str
    official_api_available: bool = False

    def __post_init__(self) -> None:
        self._defaults = source_registry().get("defaults", {})
        self._last_request_ts: float = 0.0
        self._robots_cache: dict[str, urllib.robotparser.RobotFileParser] = {}

    # --- 采集前检查 -------------------------------------------------------
    def preflight(self, url: str | None = None, using_scraper: bool = False,
                  using_seller_account: bool = False) -> None:
        # 1) 自有账号绝不跑抓取
        if using_scraper and using_seller_account:
            raise ComplianceError(
                f"[{self.source_key}] 禁止用自有卖家账号跑抓取（会牵连店铺封号/限速）")
        # 2) 官方 API 优先：有官方 API 的源禁抓
        if using_scraper and self.official_api_available and \
                self._defaults.get("official_api_first", True):
            raise ComplianceError(
                f"[{self.source_key}] 该源存在官方 API，禁止抓取（official_api_first）")
        # 3) robots.txt
        if using_scraper and url and self._defaults.get("respect_robots", True):
            if not self._robots_allows(url):
                raise ComplianceError(f"[{self.source_key}] robots.txt 禁止抓取: {url}")

    # --- 限速 -------------------------------------------------------------
    def throttle(self) -> None:
        """请求间隔 ≥ min_request_interval_ms + 随机抖动。"""
        min_gap = self._defaults.get("min_request_interval_ms", 1000) / 1000.0
        jitter = random.uniform(0, self._defaults.get("jitter_ms", 500) / 1000.0)
        elapsed = time.monotonic() - self._last_request_ts
        wait = (min_gap + jitter) - elapsed
        if wait > 0:
            time.sleep(wait)
        self._last_request_ts = time.monotonic()

    # --- GDPR 脱敏 --------------------------------------------------------
    def sanitize_review(self, review: dict[str, Any]) -> dict[str, Any]:
        """丢弃个人标识字段；reviewer_id 哈希脱敏。"""
        if not self._defaults.get("gdpr_drop_personal_fields", True):
            return review
        clean = {k: v for k, v in review.items() if k not in _GDPR_DROP_FIELDS}
        if "reviewer_id" in clean and clean["reviewer_id"]:
            clean["reviewer_id_hash"] = hashlib.sha256(
                str(clean.pop("reviewer_id")).encode()).hexdigest()[:16]
        return clean

    # --- 内部 -------------------------------------------------------------
    def _robots_allows(self, url: str) -> bool:
        from urllib.parse import urlparse
        base = urlparse(url)
        root = f"{base.scheme}://{base.netloc}"
        rp = self._robots_cache.get(root)
        if rp is None:
            rp = urllib.robotparser.RobotFileParser()
            rp.set_url(f"{root}/robots.txt")
            try:
                rp.read()
            except Exception:
                return False  # 读不到 robots 时保守拒绝抓取
            self._robots_cache[root] = rp
        return rp.can_fetch("*", url)
