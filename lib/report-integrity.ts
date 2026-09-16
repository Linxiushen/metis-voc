type JsonObject = Record<string, unknown>;

export const REPORT_INTEGRITY_CONTRACT_VERSION = "metis.report-integrity.v1";

export type ReportIntegrityIssue = {
  code: string;
  path: string;
  message: string;
};

export type ReportEvidenceDeclaration = {
  path: string;
  state: "pending" | "unavailable" | "hypothesis" | "interpretation";
  marker: string;
  reason: string;
  required_inputs?: string[];
};

export type ReportDataBinding = {
  block_id: string;
  page: number;
  status: "available" | "pending" | "unavailable" | "hypothesis" | "interpretation" | "missing";
  source_path: string | null;
  tried_source_paths?: string[];
};

export type ReportIntegritySummary = {
  contract_version: typeof REPORT_INTEGRITY_CONTRACT_VERSION;
  status: "complete" | "complete_with_declared_gaps" | "incomplete";
  structural_status: "complete" | "incomplete";
  evidence_status: "verified" | "declared_limited" | "declared_gaps" | "unknown";
  required_module_count: number;
  populated_module_count: number;
  page_contract: {
    validation_scope: "backend_source_path_resolution";
    render_status: "not_evaluated";
    expected_pages: number;
    actual_pages: number;
    required_blocks: number;
    source_resolved_required_blocks: number;
  };
  errors: ReportIntegrityIssue[];
  repairs: string[];
  evidence_register: ReportEvidenceDeclaration[];
  missing_required_blocks: ReportDataBinding[];
};

export class ReportIntegrityError extends Error {
  readonly integrity: ReportIntegritySummary;

  constructor(integrity: ReportIntegritySummary) {
    const first = integrity.errors[0]?.message || "报告数据合同不完整";
    super(`报告数据完整性校验失败：${first}`);
    this.name = "ReportIntegrityError";
    this.integrity = integrity;
  }
}

function record(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function nonEmptyText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

const EMPTY_TEXT = /^(?:-|—|–|n\/?a|na|null|undefined|pending|待补充|暂无|未知|未填写|无数据)$/i;

export function hasMeaningfulReportData(value: unknown, depth = 0): boolean {
  if (value == null || depth > 18) return false;
  if (typeof value === "string") {
    const text = value.trim();
    return Boolean(text) && !EMPTY_TEXT.test(text);
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.some((item) => hasMeaningfulReportData(item, depth + 1));
  const object = record(value);
  if (!object) return false;

  if (
    Array.isArray(object.rows) &&
    object.rows.some((row) => hasMeaningfulReportData(row, depth + 1))
  ) {
    return true;
  }
  if (Object.hasOwn(object, "value") && hasMeaningfulReportData(object.value, depth + 1)) {
    return true;
  }

  const markerOnly = new Set([
    "status",
    "tag",
    "evidence_status",
    "hypothesis_label",
    "kind",
    "type",
    "columns",
  ]);
  return Object.entries(object).some(([key, item]) =>
    !markerOnly.has(key) && hasMeaningfulReportData(item, depth + 1)
  );
}

export function resolveReportPath(report: JsonObject, path: string): unknown {
  const parts = String(path || "").split(".").filter(Boolean);
  if (parts[0] === "report") parts.shift();
  return parts.reduce<unknown>((value, part) => {
    if (Array.isArray(value) && /^\d+$/.test(part)) return value[Number(part)];
    return record(value)?.[part];
  }, report);
}

function evidenceMarker(value: unknown): string {
  const object = record(value);
  if (!object) return typeof value === "string" ? value.trim() : "";
  return [object.status, object.evidence_status, object.hypothesis_label, object.tag]
    .map(nonEmptyText)
    .find(Boolean) || "";
}

function evidenceState(marker: string): ReportEvidenceDeclaration["state"] | null {
  if (!marker) return null;
  if (/unavailable|not[_ -]?available|missing|缺失|不可用/i.test(marker)) return "unavailable";
  if (/pending|insufficient|blocked|待验证|待补/i.test(marker)) return "pending";
  if (/hypothesis|假设/i.test(marker)) return "hypothesis";
  if (/interpretation|coded|编码|解释/i.test(marker)) return "interpretation";
  return null;
}

function boundedReason(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(nonEmptyText).filter(Boolean).slice(0, 6).join("；").slice(0, 600);
  }
  return nonEmptyText(value).slice(0, 600);
}

function declarationReason(value: JsonObject, marker: string): string {
  for (const key of [
    "reason",
    "note",
    "body",
    "evidence_boundary",
    "stop_line",
    "missing_data_rule",
    "insufficient_evidence_rule",
    "validation_gate",
    "method",
  ]) {
    const reason = boundedReason(value[key]);
    if (reason) return reason;
  }
  const required = boundedReason(value.required_inputs);
  if (required) return `待接入或验证：${required}`;
  return `证据状态已显式标记为 ${marker}`;
}

function evidenceDeclarations(report: JsonObject, order: string[]): ReportEvidenceDeclaration[] {
  const modules = record(report.modules) || {};
  const declarations: ReportEvidenceDeclaration[] = [];
  const seen = new WeakSet<object>();

  const visit = (value: unknown, path: string, depth: number): void => {
    if (!value || typeof value !== "object" || depth > 18 || seen.has(value)) return;
    seen.add(value);
    const object = record(value);
    if (object) {
      const marker = evidenceMarker(object);
      const state = evidenceState(marker);
      if (state) {
        const requiredInputs = Array.isArray(object.required_inputs)
          ? object.required_inputs.map(nonEmptyText).filter(Boolean).slice(0, 12)
          : [];
        declarations.push({
          path,
          state,
          marker,
          reason: declarationReason(object, marker),
          ...(requiredInputs.length ? { required_inputs: requiredInputs } : {}),
        });
      }
    }
    for (const [key, child] of Object.entries(value)) {
      visit(child, `${path}.${key}`, depth + 1);
    }
  };

  for (const moduleId of order) {
    visit(modules[moduleId], `modules.${moduleId}`, 0);
  }
  return declarations;
}

function pagePlanFrom(report: JsonObject): JsonObject[] {
  return Array.isArray(report.reference_page_plan)
    ? report.reference_page_plan.filter((page): page is JsonObject => Boolean(record(page)))
    : [];
}

function orderFrom(report: JsonObject): string[] {
  return Array.isArray(report.order)
    ? report.order.map(nonEmptyText).filter(Boolean)
    : [];
}

function pageModuleOrder(pages: JsonObject[]): string[] {
  const result: string[] = [];
  for (const page of pages) {
    const moduleId = nonEmptyText(page.module_id);
    if (moduleId && result.at(-1) !== moduleId && !result.includes(moduleId)) result.push(moduleId);
  }
  return result;
}

function layoutModuleOrder(report: JsonObject): string[] {
  const layout = record(report.reference_layout);
  const explicit = Array.isArray(layout?.module_order)
    ? layout.module_order.map(nonEmptyText).filter(Boolean)
    : [];
  if (explicit.length) return explicit;
  const spans = Array.isArray(layout?.module_page_spans) ? layout.module_page_spans : [];
  return spans.map((span) => nonEmptyText(record(span)?.module_id)).filter(Boolean);
}

function compatibilityAliases(report: JsonObject, repairs: string[]): void {
  const modules = record(report.modules);
  if (!modules) return;
  const sources: Record<string, unknown> = {
    board_decision: record(modules.exec_summary_decision_scorecard)?.board_decision,
    board_concept: record(modules.pd_concept_matrix)?.product_concept,
    market_signal: record(modules.OP_SCAN)?.market_signal,
    competitive_raw_data: record(modules.MKT_STRUCT)?.competitive_sample_register,
    voc_raw_data: modules.voc_evidence,
    product_definition: record(modules.CPT_VERIFY)?.product_definition,
    financial_model: modules.output_unit_economics_finance,
    logistics_advantage: record(modules.output_unit_economics_finance)?.logistics_assumptions ||
      record(modules.gtm_plan)?.logistics_execution,
    compliance_risk: record(modules.CPT_VERIFY)?.compliance_review,
    action_plan: record(modules.gtm_plan)?.action_plan,
    strategy_frameworks: record(modules.strategy_map)?.strategy_frameworks ||
      record(modules.exec_summary_decision_scorecard)?.strategy_frameworks,
    evidence_downloads: record(modules.voc_evidence)?.evidence_downloads,
    source_register: record(modules.trust_guardrails_methodology)?.source_register,
    methodology: record(modules.trust_guardrails_methodology)?.methodology,
  };
  for (const [alias, source] of Object.entries(sources)) {
    if (!hasMeaningfulReportData(modules[alias]) && hasMeaningfulReportData(source)) {
      modules[alias] = source;
      repairs.push(`modules.${alias}`);
    }
  }
}

function deriveExtMeta(report: JsonObject, pages: JsonObject[], order: string[], repairs: string[]): void {
  const extMeta = record(report.ext_meta) || {};
  if (!record(report.ext_meta)) {
    report.ext_meta = extMeta;
    repairs.push("ext_meta");
  }
  for (const moduleId of order) {
    if (record(extMeta[moduleId])) continue;
    const modulePages = pages.filter((page) => page.module_id === moduleId);
    const title = modulePages.map((page) => nonEmptyText(page.module_title)).find(Boolean);
    if (!title) continue;
    extMeta[moduleId] = {
      title,
      nav_short: title,
      subsections: modulePages.map((page) => ({
        id: `page_${Number(page.page || 0)}`,
        title: nonEmptyText(page.title) || title,
      })),
    };
    repairs.push(`ext_meta.${moduleId}`);
  }
}

export function applyDeterministicReportRepairs(
  report: JsonObject,
  options: { referencePagePlan?: readonly unknown[] } = {},
): string[] {
  const repairs: string[] = [];
  if (!Array.isArray(report.reference_page_plan) && options.referencePagePlan?.length) {
    report.reference_page_plan = options.referencePagePlan;
    repairs.push("reference_page_plan");
  }
  const pages = pagePlanFrom(report);
  let order = orderFrom(report);
  if (!order.length) {
    order = layoutModuleOrder(report);
    if (!order.length) order = pageModuleOrder(pages);
    if (order.length) {
      report.order = order;
      repairs.push("order");
    }
  }
  if (!nonEmptyText(report.title) && nonEmptyText(report.category)) {
    report.title = report.board_report === true
      ? `董事会研究｜${nonEmptyText(report.category).split("｜")[0]}`
      : `${nonEmptyText(report.category)} 选品决策报告`;
    repairs.push("title");
  }
  if (report.board_report === true && !Number.isFinite(Number(report.reference_framework_modules)) && order.length) {
    report.reference_framework_modules = order.length;
    repairs.push("reference_framework_modules");
  }
  deriveExtMeta(report, pages, order, repairs);
  compatibilityAliases(report, repairs);
  return repairs;
}

function issue(errors: ReportIntegrityIssue[], code: string, path: string, message: string): void {
  errors.push({ code, path, message });
}

export function inspectReportIntegrity(reportValue: unknown, repairs: string[] = []): ReportIntegritySummary {
  const errors: ReportIntegrityIssue[] = [];
  const report = record(reportValue);
  if (!report) {
    issue(errors, "REPORT_NOT_OBJECT", "report", "报告正文不是有效对象");
    return {
      contract_version: REPORT_INTEGRITY_CONTRACT_VERSION,
      status: "incomplete",
      structural_status: "incomplete",
      evidence_status: "unknown",
      required_module_count: 0,
      populated_module_count: 0,
      page_contract: {
        validation_scope: "backend_source_path_resolution",
        render_status: "not_evaluated",
        expected_pages: 0,
        actual_pages: 0,
        required_blocks: 0,
        source_resolved_required_blocks: 0,
      },
      errors,
      repairs,
      evidence_register: [],
      missing_required_blocks: [],
    };
  }

  for (const field of ["category", "marketplace", "evidence_mode", "decision_readiness"]) {
    if (!nonEmptyText(report[field])) {
      issue(errors, "MISSING_REPORT_FIELD", field, `报告缺少必填字段 ${field}`);
    }
  }

  const modules = record(report.modules);
  if (!modules) issue(errors, "MISSING_MODULE_MAP", "modules", "报告缺少模块数据对象");
  const order = orderFrom(report);
  if (!order.length) issue(errors, "MISSING_MODULE_ORDER", "order", "报告目录为空");
  if (new Set(order).size !== order.length) {
    issue(errors, "DUPLICATE_MODULE_ORDER", "order", "报告目录含重复模块");
  }
  let populatedModules = 0;
  for (const moduleId of order) {
    if (hasMeaningfulReportData(modules?.[moduleId])) {
      populatedModules += 1;
    } else {
      issue(
        errors,
        "MISSING_REQUIRED_MODULE_DATA",
        `modules.${moduleId}`,
        `模块 ${moduleId} 没有可交付数据或缺口说明`,
      );
    }
  }

  const pages = pagePlanFrom(report);
  const layout = record(report.reference_layout);
  const expectedPages = Number(layout?.total_pages || (report.board_report === true ? 332 : pages.length));
  if (report.board_report === true || pages.length) {
    if (!pages.length) {
      issue(errors, "MISSING_PAGE_PLAN", "reference_page_plan", "报告缺少逐页数据合同");
    } else if (!Number.isInteger(expectedPages) || expectedPages <= 0 || pages.length !== expectedPages) {
      issue(
        errors,
        "PAGE_COUNT_MISMATCH",
        "reference_page_plan",
        `逐页合同共 ${pages.length} 页，与期望 ${expectedPages || 0} 页不一致`,
      );
    }
    pages.forEach((page, index) => {
      if (Number(page.page) !== index + 1) {
        issue(errors, "NON_SEQUENTIAL_PAGE", `reference_page_plan.${index}`, `第 ${index + 1} 页编号不连续`);
      }
      if (!Array.isArray(page.reference_blocks) || page.reference_blocks.length === 0) {
        issue(
          errors,
          "MISSING_PAGE_BLOCK_CONTRACT",
          `reference_page_plan.${index}.reference_blocks`,
          `第 ${index + 1} 页缺少后端数据源合同`,
        );
      }
    });
  }

  const declaredModuleCount = Number(layout?.module_count || report.reference_framework_modules || 0);
  if (declaredModuleCount > 0 && order.length !== declaredModuleCount) {
    issue(
      errors,
      "MODULE_COUNT_MISMATCH",
      "order",
      `报告目录共 ${order.length} 个模块，与声明的 ${declaredModuleCount} 个模块不一致`,
    );
  }
  const declaredModuleOrder = layoutModuleOrder(report);
  if (
    declaredModuleOrder.length > 0 &&
    (declaredModuleOrder.length !== order.length ||
      declaredModuleOrder.some((moduleId, index) => moduleId !== order[index]))
  ) {
    issue(errors, "MODULE_ORDER_MISMATCH", "order", "报告目录与逐页布局的模块顺序不一致");
  }

  const missingRequiredBlocks: ReportDataBinding[] = [];
  let requiredBlocks = 0;
  let sourceResolvedRequiredBlocks = 0;
  for (const page of pages) {
    const blocks = Array.isArray(page.reference_blocks) ? page.reference_blocks : [];
    for (const blockValue of blocks) {
      const block = record(blockValue);
      if (!block || block.required !== true) continue;
      requiredBlocks += 1;
      const sourcePaths = Array.isArray(block.source_paths)
        ? block.source_paths.map(nonEmptyText).filter(Boolean)
        : [];
      const sourcePath = sourcePaths.find((path) => hasMeaningfulReportData(resolveReportPath(report, path)));
      if (sourcePath) {
        sourceResolvedRequiredBlocks += 1;
        continue;
      }
      const binding: ReportDataBinding = {
        block_id: nonEmptyText(block.id) || `page-${Number(page.page || 0)}-required-block`,
        page: Number(page.page || 0),
        status: "missing",
        source_path: null,
        tried_source_paths: sourcePaths,
      };
      missingRequiredBlocks.push(binding);
      issue(
        errors,
        "MISSING_REQUIRED_PAGE_DATA",
        `reference_page_plan.${Number(page.page || 0)}.${binding.block_id}`,
        `第 ${binding.page} 页必填内容 ${binding.block_id} 未绑定到有效数据`,
      );
    }
  }
  if (
    report.board_report === true &&
    nonEmptyText(layout?.contract_version) === "metis.reference-report.a4-landscape.332.v4" &&
    requiredBlocks !== 359
  ) {
    issue(
      errors,
      "REQUIRED_BLOCK_COUNT_MISMATCH",
      "reference_page_plan",
      `v4 逐页合同应包含 359 个必填数据源块，当前为 ${requiredBlocks} 个`,
    );
  }

  const evidenceRegister = evidenceDeclarations(report, order);
  const evidenceMode = nonEmptyText(report.evidence_mode);
  const decisionReadiness = nonEmptyText(report.decision_readiness);
  if (decisionReadiness === "ready_for_review" && evidenceMode !== "verified_research") {
    issue(
      errors,
      "READINESS_EVIDENCE_CONTRADICTION",
      "decision_readiness",
      "报告声称可终审，但证据模式不是 verified_research",
    );
  }
  const hasDeclaredGaps = evidenceRegister.some((entry) =>
    entry.state === "pending" || entry.state === "unavailable"
  );
  const evidenceStatus: ReportIntegritySummary["evidence_status"] =
    evidenceMode === "template_demo" || decisionReadiness === "insufficient_evidence"
      ? "declared_limited"
      : evidenceMode === "verified_research"
        ? hasDeclaredGaps ? "declared_gaps" : "verified"
        : "unknown";
  const structuralStatus = errors.length ? "incomplete" : "complete";
  return {
    contract_version: REPORT_INTEGRITY_CONTRACT_VERSION,
    status: structuralStatus === "incomplete"
      ? "incomplete"
      : hasDeclaredGaps || evidenceStatus === "declared_limited"
        ? "complete_with_declared_gaps"
        : "complete",
    structural_status: structuralStatus,
    evidence_status: evidenceStatus,
    required_module_count: order.length,
    populated_module_count: populatedModules,
    page_contract: {
      validation_scope: "backend_source_path_resolution",
      render_status: "not_evaluated",
      expected_pages: Number.isFinite(expectedPages) ? expectedPages : 0,
      actual_pages: pages.length,
      required_blocks: requiredBlocks,
      source_resolved_required_blocks: sourceResolvedRequiredBlocks,
    },
    errors,
    repairs,
    evidence_register: evidenceRegister,
    missing_required_blocks: missingRequiredBlocks,
  };
}

export function assertReportIntegrity(report: unknown): ReportIntegritySummary {
  const integrity = inspectReportIntegrity(report);
  if (integrity.structural_status !== "complete") throw new ReportIntegrityError(integrity);
  return integrity;
}

function dataAvailability(integrity: ReportIntegritySummary): JsonObject {
  return {
    contract_version: REPORT_INTEGRITY_CONTRACT_VERSION,
    status: integrity.evidence_status,
    declared_gaps: integrity.evidence_register.filter((entry) =>
      entry.state === "pending" || entry.state === "unavailable"
    ),
    hypotheses: integrity.evidence_register.filter((entry) =>
      entry.state === "hypothesis" || entry.state === "interpretation"
    ),
    missing_required_data: integrity.missing_required_blocks,
  };
}

export function reportForDiagnosticDelivery(reportValue: unknown): JsonObject {
  const original = record(reportValue);
  if (!original) {
    const integrity = inspectReportIntegrity(reportValue);
    return {
      report_unavailable: true,
      report_integrity: integrity,
      data_availability: dataAvailability(integrity),
    };
  }
  const inspected = inspectReportIntegrity(original);
  const embedded = record(original.report_integrity);
  if (
    inspected.structural_status === "complete" &&
    embedded?.contract_version === REPORT_INTEGRITY_CONTRACT_VERSION &&
    embedded.structural_status === inspected.structural_status &&
    embedded.evidence_status === inspected.evidence_status &&
    Number(embedded.required_module_count) === inspected.required_module_count &&
    Number(embedded.populated_module_count) === inspected.populated_module_count &&
    Number(record(embedded.page_contract)?.actual_pages) === inspected.page_contract.actual_pages &&
    Number(record(embedded.page_contract)?.source_resolved_required_blocks) ===
      inspected.page_contract.source_resolved_required_blocks
  ) {
    return original;
  }
  const report = structuredClone(original);
  const repairs = applyDeterministicReportRepairs(report);
  const integrity = inspectReportIntegrity(report, repairs);
  report.report_integrity = integrity;
  report.data_availability = dataAvailability(integrity);
  return report;
}

export function finalizeReportForPersistence(
  reportValue: unknown,
  options: { referencePagePlan?: readonly unknown[] } = {},
): JsonObject {
  const report = record(reportValue);
  if (!report) throw new ReportIntegrityError(inspectReportIntegrity(reportValue));
  const repairs = applyDeterministicReportRepairs(report, options);
  const integrity = inspectReportIntegrity(report, repairs);
  report.report_integrity = integrity;
  report.data_availability = dataAvailability(integrity);
  if (integrity.structural_status !== "complete") throw new ReportIntegrityError(integrity);
  return report;
}
