import { build } from "vite";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");

function fail(message) {
  console.error(message);
  process.exit(1);
}

const [inputArg, outputArg] = process.argv.slice(2);
if (!inputArg || !outputArg) {
  fail("Usage: node scripts/build-offline-reference-report.mjs <run-or-report.json> <output.html>");
}

const inputPath = resolve(inputArg);
const outputPath = resolve(outputArg);
const payload = JSON.parse(readFileSync(inputPath, "utf8"));
const report = payload?.report || payload;
const run = payload?.report
  ? payload
  : {
      id: payload?.run_id || 0,
      title: payload?.category || "Metis 选品决策报告",
      report,
    };

if (
  report?.presentation_version !== "reference-a4-v2" ||
  report?.reference_framework_modules !== 62 ||
  !Array.isArray(report?.order) ||
  report.order.length !== 62 ||
  !Array.isArray(report?.reference_page_plan) ||
  report.reference_page_plan.length !== 332
) {
  fail("Input does not contain a complete 62-module / 332-page reference report.");
}

const workDir = mkdtempSync(join(tmpdir(), "metis-offline-report-"));
const entryPath = join(workDir, "entry.js");

writeFileSync(entryPath, `
import { h, render } from ${JSON.stringify(resolve(projectRoot, "public/vendor/metis-vendor.js"))};
import { ReferenceReportDeck } from ${JSON.stringify(resolve(projectRoot, "public/reference-deck.js"))};

const payloadNode = document.getElementById("metis-offline-payload");
const payload = JSON.parse(payloadNode.textContent);
const report = payload.report || payload;
const run = payload.report ? payload : { id: payload.run_id || 0, title: payload.category || "Metis 选品决策报告", report };
document.title = (run.title || report.category || "Metis 选品决策报告") + " · 本地阅读版";
render(h(ReferenceReportDeck, {
  report,
  run,
  api: async () => { throw new Error("本地阅读版不连接线上校验服务"); },
  canUseOfficialExports: false,
}), document.getElementById("app"));
`, "utf8");

try {
  const result = await build({
    configFile: false,
    logLevel: "error",
    build: {
      write: false,
      minify: "esbuild",
      target: "es2022",
      lib: {
        entry: entryPath,
        name: "MetisOfflineReport",
        formats: ["iife"],
      },
    },
  });
  const outputs = Array.isArray(result) ? result.flatMap((item) => item.output || []) : result.output;
  const chunk = outputs.find((item) => item.type === "chunk" && item.isEntry);
  if (!chunk?.code) fail("Vite did not produce an offline report bundle.");

  const css = ["styles.css", "metis-next.css", "metis-gpt.css"]
    .map((name) => readFileSync(resolve(projectRoot, "public", name), "utf8"))
    .join("\n")
    .replaceAll("</style", "<\\/style");
  const serialized = JSON.stringify(run).replaceAll("<", "\\u003c");
  const script = chunk.code.replaceAll("</script", "<\\/script");
  const generatedAt = new Date().toISOString();
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Metis 选品决策报告 · 本地阅读版</title>
  <style>${css}</style>
  <style>
    .offline-copy-note{position:fixed;right:18px;bottom:18px;z-index:9999;max-width:360px;padding:10px 14px;border:1px solid #514a40;background:#171715;color:#d7d2c8;font:12px/1.5 system-ui,sans-serif;box-shadow:0 10px 30px #0008}
    .offline-copy-note b{color:#fff}.offline-copy-note small{display:block;color:#aaa49a}
    @media print{.offline-copy-note{display:none!important}}
  </style>
</head>
<body>
  <div id="app"></div>
  <aside class="offline-copy-note"><b>本地阅读副本</b><small>生成时间 ${generatedAt} · 数据结论与证据状态保持原报告标记</small></aside>
  <script id="metis-offline-payload" type="application/json">${serialized}</script>
  <script>${script}</script>
</body>
</html>`;

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, html, "utf8");
  console.log(JSON.stringify({
    output: outputPath,
    bytes: Buffer.byteLength(html),
    pages: report.reference_page_plan.length,
    modules: report.order.length,
    run_id: run.id || null,
  }));
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
