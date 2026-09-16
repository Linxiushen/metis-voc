"""销量估算三源交叉 + 置信区间（核心差异化模块）。

对齐 config/sales-estimation.yaml 与《数据管道详细设计》§6。
输入：单个 ASIN 的三源信号；输出：point / ci / confidence_level / flags。

⚠️ BSR↔销量是「分类目、非线性」关系，无通用公式：
   `bsr_to_units` 的 anchors 必须每个顶级类目用真实订单回归标定后再插值。
   本文件给出可运行的融合/分级骨架，anchors 用占位，接入真实校准后替换。
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from statistics import mean, pstdev
from typing import Optional

from ..config_loader import sales_estimation_cfg


@dataclass
class SourceSignals:
    """三源信号（缺失填 None，不要填 0）。"""
    bsr: Optional[int] = None                 # 当前 BSR（类目内排名）
    category: str = "default"
    inventory_delta_month: Optional[int] = None   # 库存流转累计月销
    review_delta_month: Optional[int] = None      # 月新增评论数
    keepa_monthly_sold: Optional[int] = None      # 最高置信锚（月销≥50 才有）
    anomalies: list[str] = field(default_factory=list)  # promo/stockout/bulk/thin_data


@dataclass
class SalesEstimate:
    point: Optional[int]
    ci_low: Optional[int]
    ci_high: Optional[int]
    confidence_level: str          # High / Medium / Low
    source_flags: list[str]
    anomaly_flags: list[str]
    include_in_ranking: bool


def estimate(sig: SourceSignals) -> SalesEstimate:
    cfg = sales_estimation_cfg()
    estimates: dict[str, float] = {}
    flags: list[str] = []

    # 源A：BSR 换算
    if sig.bsr is not None:
        estimates["bsr"] = _bsr_to_units(sig.bsr, sig.category)
        flags.append("bsr")
    # 源B：库存流转（断货/FBM 时应为 None → 不参与）
    if sig.inventory_delta_month is not None:
        estimates["inventory"] = float(sig.inventory_delta_month)
        flags.append("inventory")
    # 源C：评论增速 ÷ 类目留评率
    if sig.review_delta_month is not None:
        rate = cfg["sources"]["C_review_velocity"]["default_review_rate"]
        estimates["review_velocity"] = sig.review_delta_month / max(rate, 1e-6)
        flags.append("review_velocity")
    # 最高置信锚
    if sig.keepa_monthly_sold is not None:
        estimates["monthly_sold"] = float(sig.keepa_monthly_sold)
        flags.append("monthly_sold")

    if not estimates:
        return SalesEstimate(None, None, None, "Low", flags, sig.anomalies, False)

    point = _fuse(estimates)
    level = _confidence_level(sig, estimates, point)
    band = _error_band(sig.bsr, cfg)
    ci_low, ci_high = _interval(point, estimates, band)

    include = level != "Low" and not _hard_block(sig.anomalies)
    return SalesEstimate(
        point=round(point),
        ci_low=round(ci_low) if include else None,
        ci_high=round(ci_high) if include else None,
        confidence_level=level,
        source_flags=flags,
        anomaly_flags=sig.anomalies,
        include_in_ranking=include,
    )


# --- 内部 -----------------------------------------------------------------
def _bsr_to_units(bsr: int, category: str) -> float:
    """类目 × BSR 分段幂律/对数插值。TODO: anchors 用真实订单回归标定。"""
    # 占位幂律：units ≈ a * bsr^(-b)，a/b 应按类目校准（此处 default 占位）
    a, b = 90000.0, 0.62
    return max(a * (bsr ** (-b)), 0.0)


def _fuse(estimates: dict[str, float]) -> float:
    """加权几何均值；monthlySold 命中时权重最高，其余仅校验。"""
    if "monthly_sold" in estimates:
        weights = {k: (3.0 if k == "monthly_sold" else 1.0) for k in estimates}
    else:
        # 简化权重（生产应按「该源在该 BSR 段/类目的历史命中率」）
        base = {"inventory": 2.0, "bsr": 1.5, "review_velocity": 1.0}
        weights = {k: base.get(k, 1.0) for k in estimates}
    num = sum(w * math.log(max(v, 1.0)) for k, v in estimates.items() for w in [weights[k]])
    den = sum(weights.values())
    return math.exp(num / den)


def _confidence_level(sig: SourceSignals, estimates: dict[str, float], point: float) -> str:
    if _hard_block(sig.anomalies):
        return "Low"
    strong_sources = [k for k in estimates if k in ("bsr", "inventory", "monthly_sold")]
    agree = _sources_agree(estimates)
    if (agree and "monthly_sold" in estimates) or \
       (sig.bsr is not None and sig.bsr < 10_000 and "inventory" in estimates):
        return "High"
    if len(strong_sources) == 1 or (sig.bsr and 10_000 <= sig.bsr <= 100_000):
        return "Medium"
    if sig.bsr and sig.bsr > 100_000 and len(estimates) == 1:
        return "Low"
    return "Medium"


def _sources_agree(estimates: dict[str, float], tol: float = 0.20) -> bool:
    vals = list(estimates.values())
    if len(vals) < 2:
        return False
    m = mean(vals)
    return all(abs(v - m) / m < tol for v in vals) if m else False


def _error_band(bsr: Optional[int], cfg: dict) -> tuple[float, float]:
    if bsr is None:
        return (0.30, 0.40)
    if bsr < 1000:
        return (0.10, 0.15)
    if bsr < 10_000:
        return (0.15, 0.20)
    if bsr < 100_000:
        return (0.20, 0.25)
    return (0.30, 0.40)


def _interval(point: float, estimates: dict[str, float], band: tuple[float, float]) -> tuple[float, float]:
    """区间宽度 = max(源离散度 CV, 误差带上界)。"""
    cv = 0.0
    if len(estimates) >= 2:
        vals = list(estimates.values())
        m = mean(vals)
        cv = (pstdev(vals) / m) if m else 0.0
    width = max(cv, band[1])
    return point * (1 - width), point * (1 + width)


def _hard_block(anomalies: list[str]) -> bool:
    return any(a in ("bulk", "thin_data") for a in anomalies)
