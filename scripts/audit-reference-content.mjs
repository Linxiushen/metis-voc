#!/usr/bin/env node

import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "vite";

const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const LOW_DENSITY_UNIT_THRESHOLD = 3;
const failOnFallback = process.argv.includes("--fail-on-fallback");

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasUsableValue(value) {
  if (value == null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (!isObject(value)) return true;
  if (Array.isArray(value.columns) && Array.isArray(value.rows)) {
    return value.columns.length > 0 && value.rows.length > 0;
  }
  return Object.keys(value).length > 0;
}

function resolveSourcePath(report, sourcePath) {
  const tokens = String(sourcePath || "")
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
  if (tokens[0] === "report") tokens.shift();
  let current = report;
  let traversed = "";
  for (const token of tokens) {
    traversed = traversed ? `${traversed}.${token}` : token;
    if (current == null || !Object.prototype.hasOwnProperty.call(Object(current), token)) {
      return { resolved: false, usable: false, reason: "missing_segment", failedAt: traversed };
    }
    current = current[token];
  }
  return {
    resolved: true,
    usable: hasUsableValue(current),
    reason: hasUsableValue(current) ? null : "empty_value",
    failedAt: null,
  };
}

function chartDataUnits(value) {
  if (!isObject(value)) return 0;
  if (Array.isArray(value.matrix)) {
    return value.matrix.reduce((total, row) => total + (Array.isArray(row) ? row.length : 0), 0);
  }
  if (Array.isArray(value.points)) return value.points.length;
  if (Array.isArray(value.items)) return value.items.length;
  if (Array.isArray(value.links)) return value.links.length;
  if (Array.isArray(value.series)) {
    return value.series.reduce((total, series) => {
      if (Array.isArray(series)) return total + series.length;
      if (!isObject(series)) return total + 1;
      const points = series.data || series.points || series.scores || series.values;
      return total + (Array.isArray(points) ? points.length : 1);
    }, 0);
  }
  for (const key of ["bars", "line", "values", "scores"]) {
    if (Array.isArray(value[key])) return value[key].length;
  }
  return 0;
}

function presentationUnits(artifact) {
  if (!artifact || ["contract", "research"].includes(artifact.kind)) return 0;
  if (["table", "kv"].includes(artifact.kind)) return artifact.rows?.length || 0;
  if (artifact.kind === "chart") return chartDataUnits(artifact.value);
  if (["list", "kpi-cards"].includes(artifact.kind)) return artifact.items?.length || 0;
  if (artifact.kind === "image") return artifact.image ? LOW_DENSITY_UNIT_THRESHOLD : 0;
  for (const key of ["rows", "items", "cards", "points", "steps", "checks"]) {
    if (Array.isArray(artifact[key])) return artifact[key].length;
  }
  return ["callout", "text"].includes(artifact.kind) ? 1 : 0;
}

function isEvidenceGapArtifact(artifact) {
  return Boolean(artifact) &&
    (artifact.contract_source_mode === "evidence_gap" || artifact.fallback_evidence_board === true);
}

function isPendingGateArtifact(artifact) {
  if (!artifact || artifact.kind !== "contract" || isEvidenceGapArtifact(artifact)) return false;
  return artifact.tag === "DATA REQUIRED" ||
    /PENDING|待补/i.test(String(artifact.confidence || "")) ||
    /PENDING|待补|真实输入尚未/i.test(String(artifact.finding || ""));
}

function provenanceIssue(artifact) {
  const artifactPath = String(artifact?.source_path || "");
  const contractPath = String(artifact?.contract_source_path || "");
  if (!artifactPath) return "missing_artifact_source_path";
  if (!contractPath) return "missing_contract_source_path";
  if (artifactPath !== contractPath) return "source_path_mismatch";
  if (!["allocated", "source_path"].includes(artifact?.contract_source_mode)) {
    return "unproven_source_mode";
  }
  return null;
}

function isGroundedArtifact(artifact) {
  return Boolean(artifact) &&
    !["contract", "research"].includes(artifact.kind) &&
    artifact.contract_source_mode !== "fallback" &&
    !isEvidenceGapArtifact(artifact) &&
    provenanceIssue(artifact) === null;
}

function payloadSignature(artifact) {
  const normalized = structuredClone(artifact || {});
  for (const key of Object.keys(normalized)) {
    if (key.startsWith("contract_") || ["title", "question"].includes(key)) {
      delete normalized[key];
    }
  }
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex").slice(0, 16);
}

function repeatedPayloadSummary(pages) {
  const occurrences = new Map();
  for (const page of pages) {
    for (const artifact of page.artifacts || []) {
      if (!isGroundedArtifact(artifact)) continue;
      const signature = payloadSignature(artifact);
      const items = occurrences.get(signature) || [];
      items.push({ page: page.number, moduleId: page.id, kind: artifact.kind });
      occurrences.set(signature, items);
    }
  }
  const groups = [...occurrences.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([signature, items]) => ({
      signature,
      occurrences: items.length,
      pages: [...new Set(items.map((item) => item.page))],
      moduleIds: [...new Set(items.map((item) => item.moduleId).filter(Boolean))],
      kinds: [...new Set(items.map((item) => item.kind))],
    }))
    .sort((left, right) => right.occurrences - left.occurrences || left.signature.localeCompare(right.signature));
  return {
    groupCount: groups.length,
    affectedPages: [...new Set(groups.flatMap((group) => group.pages))].sort((a, b) => a - b),
    topGroups: groups.slice(0, 20),
  };
}

function sourcePathSummary(report) {
  const invalidPaths = [];
  const unresolvedBlocks = [];
  for (const plan of report.reference_page_plan || []) {
    for (const block of plan.reference_blocks || []) {
      const paths = block.source_paths || [];
      const checks = paths.map((sourcePath) => ({
        sourcePath,
        ...resolveSourcePath(report, sourcePath),
      }));
      for (const check of checks) {
        if (!check.usable) {
          invalidPaths.push({
            page: plan.page,
            blockId: block.id,
            visual: block.visual,
            ...check,
          });
        }
      }
      if (!checks.some((check) => check.usable)) {
        unresolvedBlocks.push({
          page: plan.page,
          moduleId: plan.module_id || null,
          blockId: block.id,
          visual: block.visual,
          sourcePaths: paths,
        });
      }
    }
  }
  return { invalidPaths, unresolvedBlocks };
}

function auditReport(seed, compileReferencePages) {
  const report = seed.report;
  const pages = compileReferencePages(report);
  const bodyPages = pages.filter((page) => page.number > 6);
  const requiredArtifacts = bodyPages.flatMap((page) =>
    (page.artifacts || [])
      .filter((artifact) => artifact.contract_required === true)
      .map((artifact) => ({
        page: page.number,
        moduleId: page.id,
        artifact,
      })),
  );
  const describeArtifact = ({ page, moduleId, artifact }, extra = {}) => ({
    page,
    moduleId,
    blockId: artifact.contract_id || null,
    sourcePath: artifact.contract_source_path || null,
    artifactSourcePath: artifact.source_path || null,
    sourceMode: artifact.contract_source_mode || null,
    kind: artifact.kind || null,
    ...extra,
  });
  const literalFallbackArtifacts = requiredArtifacts
    .filter(({ artifact }) => artifact.contract_source_mode === "fallback")
    .map((item) => describeArtifact(item));
  const evidenceGapArtifacts = requiredArtifacts
    .filter(({ artifact }) => isEvidenceGapArtifact(artifact))
    .map((item) => describeArtifact(item));
  const blockingFallbackArtifacts = requiredArtifacts
    .filter(({ artifact }) => artifact.contract_source_mode === "fallback" || isEvidenceGapArtifact(artifact));
  const pendingGateArtifacts = requiredArtifacts
    .filter(({ artifact }) => isPendingGateArtifact(artifact))
    .map((item) => describeArtifact(item));
  const requiredContractArtifacts = requiredArtifacts
    .filter(({ artifact }) => artifact.kind === "contract")
    .map((item) => describeArtifact(item, {
      classification: isEvidenceGapArtifact(item.artifact)
        ? "evidence_gap"
        : isPendingGateArtifact(item.artifact)
          ? "pending_gate"
          : "contract",
    }));
  const unprovenProvenanceArtifacts = requiredArtifacts
    .filter(({ artifact }) =>
      !["contract", "research"].includes(artifact.kind) &&
      artifact.contract_source_mode !== "fallback" &&
      !isEvidenceGapArtifact(artifact) &&
      provenanceIssue(artifact) !== null,
    )
    .map((item) => describeArtifact(item, { reason: provenanceIssue(item.artifact) }));
  const pageNumbers = (artifacts) => [...new Set(artifacts.map((item) => item.page))].sort((a, b) => a - b);
  const fallbackPages = pageNumbers(literalFallbackArtifacts);
  const evidenceGapPages = pageNumbers(evidenceGapArtifacts);
  const pendingGatePages = pageNumbers(pendingGateArtifacts);
  const requiredContractPages = pageNumbers(requiredContractArtifacts);
  const unprovenProvenancePages = pageNumbers(unprovenProvenanceArtifacts);
  const contractOnlyPages = bodyPages
    .filter((page) => page.artifacts?.length && page.artifacts.every((artifact) => artifact.kind === "contract"))
    .map((page) => page.number);
  const groundedPages = bodyPages
    .filter((page) => page.artifacts?.some(isGroundedArtifact))
    .map((page) => page.number);
  const lowDensityPages = bodyPages
    .map((page) => ({
      page: page.number,
      moduleId: page.id,
      groundedArtifacts: (page.artifacts || []).filter(isGroundedArtifact).length,
      presentationUnits: (page.artifacts || [])
        .filter(isGroundedArtifact)
        .reduce((total, artifact) => total + presentationUnits(artifact), 0),
    }))
    .filter((page) => page.presentationUnits < LOW_DENSITY_UNIT_THRESHOLD);
  const sourcePaths = sourcePathSummary(report);
  const fallbackWithUsablePath = literalFallbackArtifacts.filter((artifact) =>
    artifact.sourcePath && resolveSourcePath(report, artifact.sourcePath).usable,
  );
  const repeatedPayloads = repeatedPayloadSummary(bodyPages);

  return {
    slug: seed.slug,
    category: report.category,
    contract: {
      expectedPages: report.reference_layout?.total_pages || null,
      compiledPages: pages.length,
      orderedModules: report.order?.length || 0,
      populatedOrderedModules: (report.order || []).filter((moduleId) =>
        hasUsableValue(report.modules?.[moduleId]),
      ).length,
    },
    fallback: {
      blockCount: literalFallbackArtifacts.length,
      pageCount: fallbackPages.length,
      pages: fallbackPages,
      blocks: literalFallbackArtifacts,
      withUsableDeclaredPathCount: fallbackWithUsablePath.length,
    },
    evidenceGap: {
      blockCount: evidenceGapArtifacts.length,
      pageCount: evidenceGapPages.length,
      pages: evidenceGapPages,
      blocks: evidenceGapArtifacts,
    },
    blockingFallback: {
      blockCount: blockingFallbackArtifacts.length,
      pageCount: pageNumbers(blockingFallbackArtifacts).length,
      pages: pageNumbers(blockingFallbackArtifacts),
    },
    pendingGate: {
      blockCount: pendingGateArtifacts.length,
      pageCount: pendingGatePages.length,
      pages: pendingGatePages,
      blocks: pendingGateArtifacts,
    },
    requiredContractBlocks: {
      blockCount: requiredContractArtifacts.length,
      pageCount: requiredContractPages.length,
      pages: requiredContractPages,
      blocks: requiredContractArtifacts,
    },
    unprovenProvenance: {
      blockCount: unprovenProvenanceArtifacts.length,
      pageCount: unprovenProvenancePages.length,
      pages: unprovenProvenancePages,
      blocks: unprovenProvenanceArtifacts,
    },
    contractOnly: {
      pageCount: contractOnlyPages.length,
      pages: contractOnlyPages,
    },
    grounded: {
      pageCount: groundedPages.length,
      pages: groundedPages,
    },
    lowDensity: {
      threshold: LOW_DENSITY_UNIT_THRESHOLD,
      pageCount: lowDensityPages.length,
      pages: lowDensityPages,
    },
    repeatedGroundedPayloads: repeatedPayloads,
    sourcePaths: {
      invalidPathCount: sourcePaths.invalidPaths.length,
      invalidPaths: sourcePaths.invalidPaths,
      unresolvedRequiredBlockCount: sourcePaths.unresolvedBlocks.length,
      unresolvedRequiredBlocks: sourcePaths.unresolvedBlocks,
    },
  };
}

const server = await createServer({
  root: PROJECT_ROOT,
  configFile: false,
  appType: "custom",
  logLevel: "silent",
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, hmr: false, ws: false },
  resolve: { alias: { "@": PROJECT_ROOT } },
});

let result;
try {
  const reports = await server.ssrLoadModule("/lib/board-reports.ts");
  const deckUrl = pathToFileURL(fileURLToPath(new URL("../public/reference-deck.js", import.meta.url))).href;
  const { compileReferencePages } = await import(deckUrl);
  const reportAudits = reports.boardReportSeeds.map((seed) => auditReport(seed, compileReferencePages));
  result = {
    schemaVersion: "metis.reference-content-audit.v1",
    generatedAt: new Date().toISOString(),
    options: { failOnFallback },
    metricDefinitions: {
      fallbackBlock:
        "A compiled required artifact whose contract_source_mode is the legacy literal 'fallback'.",
      evidenceGapBlock:
        "A required artifact whose contract_source_mode is 'evidence_gap' or fallback_evidence_board is true. It is missing compatible page evidence even when the declared module contains other structured data.",
      pendingGateBlock:
        "A non-gap required contract card explicitly marked DATA REQUIRED/PENDING. It is reported separately and never counted as grounded.",
      requiredContractBlock:
        "Any required artifact rendered as a contract card, classified as evidence_gap, pending_gate, or another contract state.",
      unprovenProvenance:
        "A non-contract required artifact that lacks an intrinsic artifact.source_path, lacks a claimed contract source path, has a path mismatch, or uses an unproven source mode.",
      contractOnlyPage:
        "A body page whose visible artifact list is non-empty and consists entirely of contract cards.",
      groundedPage:
        "A body page with at least one non-contract, non-research artifact that is not fallback/evidence-gap and whose intrinsic source_path exactly matches contract_source_path. This proves renderer-to-report binding only; it does not prove that the underlying claim is true or representative.",
      lowDensityPage:
        `A presentation heuristic: fewer than ${LOW_DENSITY_UNIT_THRESHOLD} visible structured units across grounded artifacts. A unit is a table row, chart data point, list/KPI item, or equivalent visible item; contract/research cards contribute zero. This metric never labels data as true.`,
      repeatedGroundedPayload:
        "The same grounded artifact payload appears more than once after page-specific titles and contract metadata are removed.",
      invalidSourcePath:
        "A declared source path is missing or resolves to an empty value. A required block is unresolved only when none of its alternative source paths is usable.",
    },
    totals: {
      reports: reportAudits.length,
      fallbackBlocks: reportAudits.reduce((total, audit) => total + audit.fallback.blockCount, 0),
      fallbackPages: reportAudits.reduce((total, audit) => total + audit.fallback.pageCount, 0),
      evidenceGapBlocks: reportAudits.reduce((total, audit) => total + audit.evidenceGap.blockCount, 0),
      evidenceGapPages: reportAudits.reduce((total, audit) => total + audit.evidenceGap.pageCount, 0),
      blockingFallbackBlocks: reportAudits.reduce((total, audit) => total + audit.blockingFallback.blockCount, 0),
      pendingGateBlocks: reportAudits.reduce((total, audit) => total + audit.pendingGate.blockCount, 0),
      requiredContractBlocks: reportAudits.reduce((total, audit) => total + audit.requiredContractBlocks.blockCount, 0),
      unprovenProvenanceBlocks: reportAudits.reduce((total, audit) => total + audit.unprovenProvenance.blockCount, 0),
      contractOnlyPages: reportAudits.reduce((total, audit) => total + audit.contractOnly.pageCount, 0),
      groundedPages: reportAudits.reduce((total, audit) => total + audit.grounded.pageCount, 0),
      lowDensityPages: reportAudits.reduce((total, audit) => total + audit.lowDensity.pageCount, 0),
      unresolvedRequiredBlocks: reportAudits.reduce(
        (total, audit) => total + audit.sourcePaths.unresolvedRequiredBlockCount,
        0,
      ),
    },
    reports: reportAudits,
  };
} finally {
  await server.close();
}

console.log(JSON.stringify(result, null, 2));
if (failOnFallback && result.totals.blockingFallbackBlocks > 0) process.exitCode = 1;
