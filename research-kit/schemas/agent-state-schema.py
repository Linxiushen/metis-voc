"""GraphGoldState —— 跨境选品 Agent 系统的 LangGraph 共享状态定义。

对齐《跨境选品-Agent系统详细设计-v1.0.md》§2.2。
设计要点：
- TypedDict + Annotated reducer：append 类字段用累加 reducer（防并行 worker 覆盖），
  各节点结论用 per-node 覆盖写 node_outputs[node_id]。
- 这是骨架/契约定义，字段类型可按实际实现细化。
"""
from __future__ import annotations

import operator
from typing import Annotated, Any, Literal, Optional, TypedDict

# ---- 枚举 ------------------------------------------------------------------
ConfidenceLevel = Literal["High", "Medium", "Low"]
RunStatus = Literal["PLANNING", "AWAIT_CLARIFY", "EXECUTING",
                    "AWAIT_HITL", "EARLY_EXIT", "DONE", "FAILED"]
NodeId = Literal["OP_SCAN", "MKT_STRUCT", "MIND_DECODE", "CPT_VERIFY", "GTM_PLAN"]
RoutingMode = Literal["single", "orchestrator_worker"]
GateDecision = Literal["AUTO_PASS", "HITL_REQUIRED", "HARD_BLOCK"]


# ---- 子结构 ----------------------------------------------------------------
class InputSpec(TypedDict, total=False):
    mode: Literal["asin_list", "category_keyword", "shop_sp_api"]
    asin_list: list[str]
    category_terms: list[str]
    marketplace: str            # 如 ATVPDKIKX0DER (US)
    data_window_days: int       # 默认 90
    tenant_id: str
    view_profile: Literal["P1", "P4"]
    data_scope: Literal["private_only", "public_ok"]


class ResearchScope(TypedDict, total=False):
    confirmed_categories: list[str]
    seed_competitor_asins: list[str]
    analysis_dimensions: list[str]      # 勾选的节点/维度
    confirmed_by: str
    confirmed_at: str


class Candidate(TypedDict, total=False):
    asin: str
    product_key: str
    role: Literal["seed", "competitor", "derived", "concept"]
    price_band: str
    bsr_avg30: float
    sales_point: Optional[int]
    sales_ci_low: Optional[int]
    sales_ci_high: Optional[int]
    confidence_level: ConfidenceLevel
    in_quant_ranking: bool              # Low → False（业务红线）
    source_flags: list[str]
    anomaly_flags: list[str]
    hitl_required: bool


class Metric(TypedDict, total=False):
    name: str
    point: float
    ci_low: Optional[float]
    ci_high: Optional[float]
    confidence_level: ConfidenceLevel
    source_refs: list[str]              # claim→source 审计链


class NodeOutput(TypedDict, total=False):
    conclusion_struct: dict[str, Any]
    key_metrics: list[Metric]
    reflect_flag: Literal["evidence_sufficient", "evidence_insufficient"]
    section_markdown: str


class EvidenceRef(TypedDict, total=False):
    claim_id: str
    claim_text: str
    source_tag: str                     # [REV-####] / [Keepa-#] / [ABA-#]
    source_table: str
    source_record_id: str
    node_id: str
    evidence_layer: Literal["Bronze", "RAG"]


class BudgetLedger(TypedDict, total=False):
    total_token_cap: int
    total_credit_cap: float
    consumed_token: int
    consumed_credit: float
    per_node_consumed: dict[str, int]
    model_tier: str                     # 当前档：opus/sonnet/qwen...
    degrade_events: list[dict[str, Any]]


class RoutingDecision(TypedDict, total=False):
    node_id: str
    mode: RoutingMode
    fan_out: int
    reason: str


class ReplanEntry(TypedDict, total=False):
    node_id: str
    action: Literal["CONTINUE", "EARLY_EXIT", "REPLAN", "ESCALATE_HITL"]
    reason: str
    replan_count: int


class HitlItem(TypedDict, total=False):
    touchpoint: Literal["clarify", "low_confidence", "compliance", "final_review"]
    payload_ref: str
    status: Literal["pending", "approved", "rejected", "edited"]
    lark_approval_id: Optional[str]
    reasons: list[str]


class HardGate(TypedDict, total=False):
    opportunity_score: float
    top3_competitor_review_max: int
    hard_gate_pass: bool


class CheckpointMeta(TypedDict, total=False):
    last_completed_node: Optional[str]
    graph_version: str                  # rainbow deployment 锁定版本
    external_memory_ref: Optional[str]


# ---- 主状态 ----------------------------------------------------------------
class GraphGoldState(TypedDict, total=False):
    run_id: str                                  # = thread_id，长任务主键
    input_spec: InputSpec
    research_scope: ResearchScope                # Gate-0 (HITL#1) 回写
    candidate_asin_pool: Annotated[list[Candidate], operator.add]
    plan_dag: dict[str, Any]
    # 各节点结论：per-node 覆盖写（并行 worker 写各自子键，见下方 merge 说明）
    node_outputs: dict[str, NodeOutput]
    # append reducer 累加，防并行覆盖
    evidence_refs: Annotated[list[EvidenceRef], operator.add]
    routing_decisions: Annotated[list[RoutingDecision], operator.add]
    replan_log: Annotated[list[ReplanEntry], operator.add]
    hitl_queue: Annotated[list[HitlItem], operator.add]
    confidence_summary: dict[str, Any]           # {high_cnt, medium_cnt, low_cnt, low_excluded[]}
    budget_ledger: BudgetLedger
    hard_gate: HardGate
    run_status: RunStatus
    checkpoint_meta: CheckpointMeta


# ---- 并行 worker 写 node_outputs 的 merge reducer -------------------------
def merge_node_outputs(left: dict[str, NodeOutput],
                       right: dict[str, NodeOutput]) -> dict[str, NodeOutput]:
    """按 node_id 合并；同一 node 的并行 worker 写不同子键时深合并，避免整体覆盖。"""
    out = dict(left or {})
    for node_id, val in (right or {}).items():
        if node_id in out and isinstance(out[node_id], dict) and isinstance(val, dict):
            out[node_id] = {**out[node_id], **val}
        else:
            out[node_id] = val
    return out

# 使用示例（LangGraph 构图时）：
#   node_outputs: Annotated[dict[str, NodeOutput], merge_node_outputs]
# 若在类定义处无法用函数注解，可在 StateGraph(state_schema=...) 外部包装。
