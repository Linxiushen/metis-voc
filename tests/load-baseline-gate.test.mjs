import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildCurlDownloadArgs,
  curlTransferSample,
  observeWranglerProcess,
  parseCurlTransferRecords,
  READY_HEALTH_REQUEST_TIMEOUT_MS,
  runScenario,
  waitForReady,
  wranglerProcessError,
} from "../scripts/load-baseline.mjs";

const loadSource = readFileSync(new URL("../scripts/load-baseline.mjs", import.meta.url), "utf8");
const lockSource = readFileSync(new URL("../pnpm-lock.yaml", import.meta.url), "utf8");
const packageManifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

class FakeChild extends EventEmitter {
  exitCode = null;
  signalCode = null;
}

function fakeRuntime(phase = "bulk_cas") {
  const child = new FakeChild();
  const runtime = observeWranglerProcess(child, {
    phase,
    outputLines: ["2026-08-05T00:00:00.000Z [stderr] startup failed"],
    logPath: `C:\\load-logs\\${phase}.log`,
  });
  return { child, runtime };
}

test("readiness health probes are individually bounded to two seconds", () => {
  assert.equal(READY_HEALTH_REQUEST_TIMEOUT_MS, 2_000);
});

test("Wrangler error, exit, and close events are all captured without an unhandled error", async () => {
  const { child, runtime } = fakeRuntime();
  const spawnError = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });

  child.emit("error", spawnError);
  child.exitCode = 1;
  child.emit("exit", 1, null);
  child.emit("close", 1, null);

  const terminal = await runtime.terminal;
  assert.equal(terminal.kind, "error");
  assert.equal(terminal.error.message, "spawn ENOENT");
  assert.deepEqual(runtime.events.map((event) => event.kind), ["error", "exit", "close"]);

  const failure = wranglerProcessError(runtime, terminal, "readiness");
  assert.equal(failure.name, "WranglerProcessError");
  assert.match(failure.message, /phase=bulk_cas/);
  assert.match(failure.message, /stage=readiness/);
  assert.match(failure.message, /C:\\load-logs\\bulk_cas\.log/);
  assert.match(failure.message, /startup failed/);
});

test("waitForReady fails immediately and diagnostically on close without an exit event", async () => {
  const { child, runtime } = fakeRuntime("queue_e2e");
  child.emit("close", 7, "SIGTERM");

  await assert.rejects(
    waitForReady("http://127.0.0.1:9", runtime),
    (error) => {
      assert.equal(error.name, "WranglerProcessError");
      assert.match(error.message, /phase=queue_e2e/);
      assert.match(error.message, /code=7, signal=SIGTERM/);
      assert.match(error.message, /queue_e2e\.log/);
      assert.match(error.message, /Wrangler output tail/);
      return true;
    },
  );
});

test("an in-flight scenario fails immediately when its Wrangler runtime exits", async () => {
  const event = { kind: "exit", code: 1, signal: null, error: null };
  const runtime = {
    phase: "bulk_cas",
    logPath: "C:\\load-logs\\bulk-wrangler.log",
    outputLines: ["Network connection lost"],
    events: [event],
    terminal: Promise.resolve(event),
  };

  await assert.rejects(
    runScenario({
      name: "runtime_exit_fixture",
      total: 1,
      concurrency: 1,
      request: () => new Promise(() => {}),
      runtime,
    }),
    (error) => {
      assert.equal(error.name, "WranglerProcessError");
      assert.match(error.message, /scenario:runtime_exit_fixture/);
      assert.match(error.message, /Network connection lost/);
      return true;
    },
  );
});

test("parallel curl diagnostics accept only a complete Content-Length transfer", () => {
  const complete = curlTransferSample(0, {
    metadata: {
      exitcode: 0,
      http_code: 200,
      size_download: 717_834,
      time_connect: 0.004,
      time_starttransfer: 0.12,
      time_total: 0.4,
      local_ip: "127.0.0.1",
      local_port: 50_001,
      remote_ip: "127.0.0.1",
      remote_port: 62_988,
      http_version: "1.1",
    },
    response_headers: {
      "content-length": ["717834"],
      "content-type": ["application/json; charset=utf-8"],
      "x-request-id": ["request-1"],
    },
  }, { exitCode: 0 });
  assert.equal(complete.status, 200);
  assert.equal(complete.bytes, 717_834);
  assert.equal(complete.error, null);
  assert.equal(complete.headers.requestId, "request-1");
  assert.equal(complete.transport.client, "curl_parallel");
  assert.equal(complete.transport.time_starttransfer_ms, 120);

  const truncated = curlTransferSample(1, {
    metadata: { exitcode: 0, http_code: 200, size_download: 700_000, time_total: 0.4 },
    response_headers: { "content-length": ["717834"] },
  }, { exitCode: 0 });
  assert.equal(truncated.status, 0);
  assert.equal(truncated.errorDetails.name, "IncompleteTransferError");
  assert.match(truncated.error, /700000 bytes.*717834/);
});

test("a zero-byte curl timeout remains a transport failure with connection-stage metadata", () => {
  const timeout = curlTransferSample(4, {
    metadata: {
      exitcode: 28,
      errormsg: "Operation timed out with 0 bytes received",
      http_code: 0,
      size_download: 0,
      local_ip: "127.0.0.1",
      local_port: 50_004,
      remote_ip: "127.0.0.1",
      remote_port: 62_988,
      time_connect: 0.002,
      time_starttransfer: 0,
      time_total: 30.006,
    },
    response_headers: {},
  }, { exitCode: 28 });

  assert.equal(timeout.status, 0);
  assert.equal(timeout.bytes, 0);
  assert.equal(timeout.errorDetails.name, "CurlError");
  assert.equal(timeout.transport.curl_exit_code, 28);
  assert.equal(timeout.transport.time_connect_ms, 2);
  assert.equal(timeout.transport.time_starttransfer_ms, 0);
  assert.equal(timeout.transport.time_total_ms, 30_006);
});

test("parallel curl metadata parser accepts multiline header_json records", () => {
  const output = [
    'METIS_CURL_1:{"metadata":{"exitcode":0,"http_code":200,"size_download":5},"response_headers":{"content-length":["5"],',
    '"x-request-id":["request-1"]',
    '}}',
    'METIS_CURL_0:{"metadata":{"exitcode":28,"http_code":0,"size_download":0},"response_headers":{',
    '}}',
  ].join("\n");
  const records = parseCurlTransferRecords(output);

  assert.equal(records.size, 2);
  assert.equal(records.get(1).metadata.size_download, 5);
  assert.deepEqual(records.get(1).response_headers["content-length"], ["5"]);
  assert.equal(records.get(0).metadata.exitcode, 28);
});

test("parallel curl metadata parser accepts Windows CRLF output for every transfer", () => {
  const output = [
    'METIS_CURL_2:{"metadata":{"exitcode":0,"http_code":200,"size_download":5},"response_headers":{"content-length":["5"],',
    '"x-request-id":["request-2"]',
    '}}',
    'METIS_CURL_0:{"metadata":{"exitcode":0,"http_code":200,"size_download":5},"response_headers":{"content-length":["5"]',
    '}}',
    'METIS_CURL_1:{"metadata":{"exitcode":0,"http_code":200,"size_download":5},"response_headers":{"content-length":["5"]',
    '}}',
  ].join("\r\n");
  const records = parseCurlTransferRecords(output);

  assert.deepEqual([...records.keys()].sort(), [0, 1, 2]);
  for (let index = 0; index < 3; index += 1) {
    assert.equal(curlTransferSample(index, records.get(index), { exitCode: 0 }).status, 200);
  }
});

test("a malformed curl metadata record does not consume adjacent valid records", () => {
  const output = [
    'METIS_CURL_0:{"metadata":{"exitcode":0,"http_code":200,"size_download":5},"response_headers":{"content-length":["5"]}}',
    'METIS_CURL_1:{"metadata":{"exitcode":0,"http_code":200},"response_headers":{BROKEN}}',
    'METIS_CURL_2:{"metadata":{"exitcode":0,"http_code":200,"size_download":5},"response_headers":{"content-length":["5"]}}',
  ].join("\r\n");
  const records = parseCurlTransferRecords(output);

  assert.deepEqual([...records.keys()].sort(), [0, 2]);
  assert.equal(curlTransferSample(0, records.get(0), { exitCode: 0 }).status, 200);
  assert.equal(curlTransferSample(1, records.get(1), { exitCode: 0 }).status, 0);
  assert.equal(curlTransferSample(2, records.get(2), { exitCode: 0 }).status, 200);
});

test("large export GETs use deterministic per-transfer curl isolation", () => {
  const args = buildCurlDownloadArgs({
    total: 3,
    concurrency: 2,
    url: "http://127.0.0.1:8787/api/runs/run-1/export.json",
    headers: { authorization: "Bearer test-token" },
    timeoutMs: 30_000,
    sink: "NUL",
  });
  assert.equal(args[0], "--disable");
  assert.deepEqual(args.slice(1, 5), [
    "--parallel",
    "--parallel-immediate",
    "--parallel-max",
    "2",
  ]);

  const transferArgs = args.slice(args.indexOf("--silent"));
  const segments = [[]];
  for (const argument of transferArgs) {
    if (argument === "--next") segments.push([]);
    else segments.at(-1).push(argument);
  }
  assert.equal(segments.length, 3);
  for (const [index, segment] of segments.entries()) {
    assert.ok(segment.includes("--noproxy"));
    assert.ok(segment.includes("--http1.1"));
    assert.equal(segment[segment.indexOf("--connect-timeout") + 1], "5");
    assert.equal(segment[segment.indexOf("--max-time") + 1], "30");
    assert.ok(segment.includes("--output"));
    assert.ok(segment.includes("--write-out"));
    assert.ok(segment.includes("--header"));
    assert.match(segment.at(-1), new RegExp(`__metis_load_request=${index}$`));
  }

  assert.match(loadSource, /METIS_CURL_\$\{index\}:[\s\S]+%\{header_json\}/);
  assert.match(loadSource, /runCurlDownloadScenario\(\{[\s\S]+name: "large_signed_json_export"/);
  assert.doesNotMatch(loadSource, /timedCurlDownload/);
});

test("large export load owns a fresh Wrangler runtime, D1, and one-shot signing fixture", () => {
  assert.match(
    loadSource,
    /phases: \["bulk_cas", "export_transfer", "queue_e2e"\]/,
  );
  assert.match(loadSource, /join\(temporaryRoot, "export-d1"\)/);
  assert.match(loadSource, /"export_transfer"/);
  assert.match(loadSource, /signing_write_requests: 1/);
  assert.match(loadSource, /requireStatus\(exportFixtureSign, \[200\], "Export transfer one-shot signing"\)/);
  assert.match(
    loadSource,
    /exportFixtureSignedCheck\.json\?\.edition !== "signed"/,
  );

  const exportRuntime = loadSource.indexOf('"export_transfer"');
  const exportDownload = loadSource.indexOf('name: "large_signed_json_export"');
  const queueRuntime = loadSource.lastIndexOf('"queue_e2e"');
  assert.ok(exportRuntime > 0 && exportRuntime < exportDownload);
  assert.ok(exportDownload < queueRuntime);
});

test("failed load gates retain their Wrangler logs and temporary D1 for diagnosis", () => {
  assert.match(loadSource, /temporary_root: temporaryRoot/);
  assert.match(loadSource, /wrangler_log_paths: \{[\s\S]+bulk_cas: bulkWranglerLogPath/);
  assert.match(loadSource, /keepTemporary \|\| result\.passed === false/);
  assert.match(loadSource, /Temporary load-test data retained for diagnostics/);
});

test("the load gate uses the exact Wrangler version pinned by the current release", () => {
  const installed = JSON.parse(readFileSync(new URL("../node_modules/wrangler/package.json", import.meta.url), "utf8"));
  assert.match(packageManifest.devDependencies.wrangler, /^\d+\.\d+\.\d+$/);
  assert.equal(installed.version, packageManifest.devDependencies.wrangler);
  assert.ok(lockSource.includes(`wrangler@${installed.version}`));
  assert.match(loadSource, /wrangler_version: wranglerVersion/);
  assert.match(loadSource, /runtime_pid: runtime\.child\.pid \|\| null/);
});
