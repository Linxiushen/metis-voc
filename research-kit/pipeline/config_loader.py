"""加载 config/*.yaml 与 schemas，供采集与转换复用。"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any
import yaml

# 项目根：pipeline/ 的上一级
ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = ROOT / "config"


@lru_cache(maxsize=None)
def load(name: str) -> dict[str, Any]:
    """按文件名（不含扩展名）加载 config/<name>.yaml。"""
    path = CONFIG_DIR / f"{name}.yaml"
    if not path.exists():
        raise FileNotFoundError(f"缺少配置文件: {path}")
    with path.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def source_registry() -> dict[str, Any]:
    return load("source-registry")


def sales_estimation_cfg() -> dict[str, Any]:
    return load("sales-estimation")


def opportunity_cfg() -> dict[str, Any]:
    return load("opportunity-scoring")


def absa_taxonomy() -> dict[str, Any]:
    return load("review-absa-taxonomy")


def entity_rules() -> dict[str, Any]:
    return load("entity-resolution-rules")
