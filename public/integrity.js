const SHA256_HEX = /^[a-f0-9]{64}$/i;

export async function sha256Json(value) {
  if (!globalThis.crypto?.subtle) throw new Error("当前浏览器不支持报告完整性校验");
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createExportProof(edition, report) {
  if (!["review", "signed"].includes(edition)) throw new Error("导出版本无效");
  const reportHash = await sha256Json(report);
  const reportVersion = String(report?.report_version || report?.schema_version || "unknown");
  const params = new URLSearchParams({
    edition,
    expected_report_hash: reportHash,
    expected_report_version: reportVersion,
  });
  return { edition, reportHash, reportVersion, query: params.toString() };
}

export function verifyExportCheck(check, proof) {
  const expectedStatus = proof.edition === "signed" ? "signed" : "pending_review";
  if (
    check?.edition !== proof.edition ||
    check?.decision_status !== expectedStatus ||
    !SHA256_HEX.test(String(check?.report_sha256 || "")) ||
    check.report_sha256 !== proof.reportHash ||
    String(check?.report_version || "unknown") !== proof.reportVersion
  ) {
    throw new Error("报告状态或内容已变化，请刷新后重新审阅再导出");
  }
  return check;
}
