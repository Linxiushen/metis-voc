import htm, { h, render, useCallback, useEffect, useRef, useState } from "./vendor/metis-vendor.js";
import { ReportView } from "./report10x.js";
import { BriefWizard } from "./brief.js";
import { createExportProof, sha256Json, verifyExportCheck } from "./integrity.js";
const html = htm.bind(h);
// Frontend and API are served by the same Worker. Never send a fork's
// credentials to a shared or inferred deployment hostname.
const METIS_API_ORIGIN = "";
const apiUrl = (path) => `${METIS_API_ORIGIN}${path}`;

// ---------------- auth / api ----------------
function readStoredUser() {
  try {
    return JSON.parse(localStorage.getItem("ia_user") || "null");
  } catch {
    localStorage.removeItem("ia_user");
    return null;
  }
}
const store = {
  token: localStorage.getItem("ia_token") || "",
  user: readStoredUser(),
};
const runReport = (run) => run?.report || run || {};
const isReviewableRun = (run) => {
  const report = runReport(run);
  return report?.evidence_mode === "verified_research" && report?.decision_readiness === "ready_for_review";
};
const evidenceStateOf = (run) => {
  const report = runReport(run);
  if (["template_demo", "synthetic_fixture"].includes(report?.evidence_mode)) return "template_demo";
  if (isReviewableRun(report)) return "review_ready";
  return "evidence_blocked";
};
const hasValidSignedDecision = (run) => Boolean(
  isReviewableRun(run?.report || run) &&
  run?.reviewed && run?.decision_outcome && run?.outcome_note &&
  run?.reviewer_id && run?.reviewer_name && run?.reviewed_at &&
  run?.review_checks?.evidence === true &&
  run?.review_checks?.economics === true &&
  run?.review_checks?.risk === true &&
  /^[a-f0-9]{64}$/i.test(String(run?.review_report_hash || "")),
);
const deriveRunUiState = (run) => {
  const report = runReport(run);
  const status = run?.status || "unknown";
  const evidenceMode = report?.evidence_mode || "unknown";
  const reviewReady = isReviewableRun(report);
  const signed = hasValidSignedDecision(run);
  const stage = status === "await_clarify"
    ? { key: "clarify", label: "待确认", detail: "研究范围尚未确认", tone: "wait" }
    : status === "queued"
      ? { key: "queued", label: "已排队", detail: "等待研究引擎处理", tone: "progress" }
      : status === "executing"
        ? { key: "executing", label: "执行中", detail: "正在收集证据并生成分析", tone: "progress" }
        : status === "done"
          ? { key: "done", label: "已完成", detail: "研究内容已生成", tone: "done" }
          : status === "failed"
            ? { key: "failed", label: "执行失败", detail: run?.error_message || "任务需要检查后重试", tone: "danger" }
            : { key: "unknown", label: "状态待同步", detail: "正在读取研究状态", tone: "neutral" };

  const isDemoEvidence = ["template_demo", "synthetic_fixture"].includes(evidenceMode);
  const evidence = isDemoEvidence
    ? { key: "demo", label: "框架演示", detail: "仅验证研究结构，不代表实时市场事实", tone: "neutral" }
    : reviewReady
      ? { key: "verified", label: "证据通过", detail: "关键证据已达到人工终审门槛", tone: "done" }
      : evidenceMode === "partial_verified_research"
        ? { key: "partial", label: "部分实证", detail: "已有可追溯市场数据，评论正文与经营实绩待补", tone: "wait" }
        : { key: "blocked", label: "证据待补", detail: "关键数据尚未达到终审门槛", tone: "wait" };

  const decision = signed
    ? { key: "signed", label: `已签核 · ${run.decision_outcome}`, detail: "人工终审记录完整且与当前报告匹配", tone: "done" }
    : status !== "done"
      ? { key: "unavailable", label: "不可签核", detail: "研究完成后才能进入决策", tone: "neutral" }
      : reviewReady && run?.decision_outcome
        ? { key: "draft", label: `待终审 · ${run.decision_outcome}`, detail: "已选择决策草案，尚未完成人工终审", tone: "progress" }
        : reviewReady
          ? { key: "review", label: "待人工终审", detail: "报告已可审阅，尚未记录人工决策", tone: "progress" }
          : isDemoEvidence
            ? { key: "demo", label: "不可签核", detail: "框架演示不形成市场决策", tone: "neutral" }
            : { key: "evidence", label: "待补证", detail: "补齐关键证据后才能终审", tone: "wait" };

  const nextAction = stage.key === "clarify" ? "完善并确认范围"
    : stage.key === "failed" ? "查看失败原因"
    : ["queued", "executing"].includes(stage.key) ? "查看研究进度"
    : decision.key === "signed" ? "查看签核结果"
    : decision.key === "review" || decision.key === "draft" ? (store.user?.role === "admin" ? "进入人工终审" : "查看待审报告")
    : evidence.key === "partial" || evidence.key === "blocked" ? "查看证据缺口"
    : evidence.key === "demo" ? "查看框架演示"
    : "查看研究";

  return { stage, evidence, decision, nextAction, reviewReady, signed };
};
const runDecisionLabel = (run) => deriveRunUiState(run).decision.label;
function setAuth(token, user) {
  resetRunSummaryRequest();
  store.token = token; store.user = user;
  localStorage.setItem("ia_token", token);
  localStorage.setItem("ia_user", JSON.stringify(user));
}
function clearAuth() {
  resetRunSummaryRequest();
  store.token = ""; store.user = null;
  localStorage.removeItem("ia_token"); localStorage.removeItem("ia_user");
}
function logout() {
  const token = store.token;
  clearAuth();
  location.hash = "#/login";
  if (token) {
    fetch(apiUrl("/api/auth/logout"), {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
    }).catch(() => {});
  }
}
async function api(path, {
  method = "GET",
  body,
  timeoutMs = 120_000,
  signal,
  idempotencyKey,
  ifNoneMatch,
  responseMeta = false,
} = {}) {
  const controller = new AbortController();
  let abortSource = "";
  const abortRequest = (source) => {
    if (controller.signal.aborted) return;
    abortSource = source;
    controller.abort();
  };
  const timeout = setTimeout(() => abortRequest("timeout"), timeoutMs);
  const abortFromCaller = () => abortRequest("caller");
  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener("abort", abortFromCaller, { once: true });
  try {
    const res = await fetch(apiUrl("/api" + path), {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(store.token ? { Authorization: "Bearer " + store.token } : {}),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        ...(ifNoneMatch ? { "If-None-Match": ifNoneMatch } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (res.status === 304) {
      const result = {
        data: null,
        etag: res.headers.get("etag") || ifNoneMatch || "",
        notModified: true,
      };
      return responseMeta ? result : null;
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && store.token) {
      clearAuth();
      location.hash = "#/login";
    }
    if (!res.ok) {
      const requestError = new Error(data.detail || `请求失败 (${res.status})`);
      requestError.status = res.status;
      requestError.retryAfter = Number(res.headers.get("retry-after") || 0);
      throw requestError;
    }
    return responseMeta
      ? { data, etag: res.headers.get("etag") || "", notModified: false }
      : data;
  } catch (error) {
    if (error?.name === "AbortError" && abortSource === "timeout") {
      const timeoutError = new Error("请求超时，请稍后重试");
      timeoutError.name = "TimeoutError";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

let runSummaryRequest = null;
let runSummaryRequestToken = "";
function resetRunSummaryRequest() {
  runSummaryRequest = null;
  runSummaryRequestToken = "";
}
function loadRunSummaries() {
  const token = store.token;
  if (runSummaryRequest && runSummaryRequestToken === token) return runSummaryRequest;
  const request = api("/runs");
  runSummaryRequest = request;
  runSummaryRequestToken = token;
  const settle = () => {
    if (runSummaryRequest === request) {
      runSummaryRequest = null;
      runSummaryRequestToken = "";
    }
  };
  request.then(settle, settle);
  return request;
}

function useRoute() {
  const [route, setRoute] = useState(location.hash || "#/");
  useEffect(() => {
    const on = () => setRoute(location.hash || "#/");
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return route;
}
const go = (h) => { location.hash = h; };

function useDialogFocus(ref, onClose, active = true) {
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!active) return undefined;
    const root = ref.current;
    if (!root) return undefined;
    const previous = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const focusable = () => [...root.querySelectorAll(
      'a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])',
    )].filter((element) => element.getClientRects().length && element.getAttribute("aria-hidden") !== "true");
    const focusFrame = requestAnimationFrame(() => {
      (root.querySelector("[autofocus],[data-autofocus]") || focusable()[0] || root).focus({ preventScroll: true });
    });
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) {
        event.preventDefault();
        root.focus();
        return;
      }
      const first = items[0];
      const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.body.style.overflow = "hidden";
    addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(focusFrame);
      removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [active, ref]);
}

const creditNumber = (value) => {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : 0;
};
const formatCredits = (value) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(creditNumber(value));
const formatAccountTime = (value) => {
  if (!value) return "—";
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 1_000_000_000_000 ? numeric * 1000 : numeric)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN", { hour12: false });
};
const creditDelta = (transaction) => creditNumber(transaction?.amount ?? transaction?.delta);
const creditReason = (transaction) => transaction?.reason || transaction?.description || "积分调整";
const accountStatusLabel = (status) => status === "disabled" ? "已停用" : "使用中";
const accountRoleLabel = (role) => role === "admin" ? "管理员" : "普通用户";
const runNextActionLabel = (run) => deriveRunUiState(run).nextAction;
const runStateBadge = (item, kind = "state") => html`<span class=${`run-state-badge ${kind} tone-${item.tone}`} title=${item.detail}>${item.label}</span>`;

// ---------------- App ----------------
function Home({ onOpenPalette }) {
  const [kw, setKw] = useState("");
  const [researchMode, setResearchMode] = useState("board");
  const [marketplace, setMarketplace] = useState("US");
  const [busy, setBusy] = useState(false);
  const [runs, setRuns] = useState(null);
  const [runsError, setRunsError] = useState("");
  const [runsReloadKey, setRunsReloadKey] = useState(0);
  useEffect(() => {
    let active = true;
    setRunsError("");
    setRuns(null);
    loadRunSummaries().then((items) => {
      if (active) setRuns(items);
    }).catch((error) => {
      if (!active) return;
      setRunsError(error.message || "研究档案加载失败");
      setRuns([]);
    });
    return () => { active = false; };
  }, [runsReloadKey]);
  const hr = new Date().getHours();
  const greet = hr < 6 ? "凌晨好" : hr < 11 ? "早上好" : hr < 14 ? "中午好" : hr < 18 ? "下午好" : "晚上好";
  const exec = (runs || []).filter(r => ["queued", "executing"].includes(r.status)).length;
  const clarify = (runs || []).filter(r => r.status === "await_clarify").length;
  const failed = (runs || []).filter(r => r.status === "failed").length;
  const review = (runs || []).filter(r => r.status === "done" && isReviewableRun(r) && !hasValidSignedDecision(r)).length;
  const signed = (runs || []).filter(r => r.status === "done" && hasValidSignedDecision(r)).length;
  const EX = [["床头柜","Nightstands"],["餐边柜","Sideboard"],["抽屉柜","Drawer cabinet"],["咖啡吧台柜","Coffee bar counter"]];
  const reviewableTotal = review + signed;
  const approvalRate = reviewableTotal ? Math.round(signed / reviewableTotal * 100) : null;
  const commandShortcut = /Mac|iPhone|iPad/i.test(navigator.userAgent) ? "⌘ K" : "Ctrl K";
  async function start(e) {
    if (e) e.preventDefault();
    if (!kw.trim()) return; setBusy(true);
    const raw = kw.trim();
    const tokens = raw.split(/[\s,，]+/).map(value => value.trim().toUpperCase()).filter(Boolean);
    const isAsinList = tokens.length > 0 && tokens.every(value => /^[A-Z0-9]{10}$/.test(value));
    const seed = { mode: isAsinList ? "asin_list" : "category_keyword", payload: isAsinList ? tokens : raw, marketplace, created_at: Date.now() };
    if (researchMode === "board") {
      localStorage.setItem("metis_brief_seed", JSON.stringify(seed));
      go("#/new");
      return;
    }
    try { const run = await api("/runs", { method: "POST", body: { mode: seed.mode, payload: seed.payload, marketplace }, idempotencyKey: crypto.randomUUID() }); go("#/run/" + run.id); }
    catch (err) { toast(err.message || "研究创建失败，请稍后重试", "err"); setBusy(false); }
  }
  return html`<div class="home home-v3">
    <header class="workspace-head">
      <div><span class="workspace-overline">DECISION WORKSPACE</span><h1>${greet}${store.user?.name ? "，" + store.user.name : ""}</h1><p>把今天最重要的市场判断，推进到可执行结论。</p></div>
      <button class="quiet-action" type="button" aria-haspopup="dialog" onClick=${onOpenPalette}><span>⌕</span> 搜索与跳转 <kbd>${commandShortcut}</kbd></button>
    </header>

    <section class="research-mode-picker" role="group" aria-label="研究模式">
      <button aria-pressed=${researchMode === "board"} class=${researchMode === "board" ? "on" : ""} onClick=${() => setResearchMode("board")}>
        <span><b>董事会研究简报</b><em>推荐</em></span><small>先定义品牌、成本、供应链与证据约束，再决定是否启动研究。</small>
      </button>
      <button aria-pressed=${researchMode === "demo"} class=${researchMode === "demo" ? "on" : ""} onClick=${() => setResearchMode("demo")}>
        <span><b>框架预演</b></span><small>只验证研究结构与交互流程，不输出可签核的市场结论。</small>
      </button>
    </section>

    <section class=${"command-grid mode-" + researchMode}>
      <div class="command-main">
        <div class="command-status"><i></i><span>${researchMode === "board" ? "董事会简报" : "框架预演"}</span><b>${researchMode === "board" ? "推荐" : "不形成决策"}</b></div>
        <h2>${researchMode === "board" ? html`先把研究边界定义清楚。` : html`先验证框架，再决定是否立项。`}</h2>
        <p>${researchMode === "board" ? "输入品类或竞品 ASIN，下一步补齐公司能力、价格、成本与证据门槛。当前通用链路在真实适配器接入前只生成框架演示。" : "该模式使用模板数据演示研究结构，不代表实时市场研究，也不会形成可签核结论。"}</p>
        <form class="command-input" onSubmit=${start}>
          <span class="command-glyph">⌘</span>
          <input aria-label="品类关键词或竞品 ASIN" value=${kw} onInput=${e => setKw(e.target.value)} placeholder="搜索品类，或粘贴 ASIN"/>
          <select aria-label="主分析站点" value=${marketplace} onChange=${e => setMarketplace(e.target.value)}>
            ${["US","UK","DE","JP"].map(market => html`<option key=${market} value=${market}>${market}</option>`)}
          </select>
          <button disabled=${busy || !kw.trim()} aria-busy=${busy} title=${kw.trim() ? "" : "请先输入品类或 ASIN"}>${busy ? "处理中…" : (researchMode === "board" ? "完善研究简报" : "创建演示研究")}<i>↗</i></button>
        </form>
        <div class="command-examples"><span>TRY</span>${EX.map(([l,v]) => html`<button type="button" key=${v} onClick=${() => setKw(v)}>${l}</button>`)}</div>
        <div class="command-flow">${["机会扫描","市场结构","VOC 解码","选品验证","GTM 规划"].map((t,i)=>html`
          <span key=${t}><b>${String(i+1).padStart(2,"0")}</b>${t}</span>`)}</div>
      </div>
      <aside class="signal-panel">
        <div class="signal-head"><span>DECISION GOVERNANCE</span><b><i></i> 工作台</b></div>
        <div class="signal-score"><span>可审阅报告签核率</span><strong>${approvalRate === null ? "—" : approvalRate}<small>${approvalRate === null ? "" : "%"}</small></strong><div><i style=${`width:${approvalRate || 0}%`}></i></div><small>${reviewableTotal ? `${signed} / ${reviewableTotal} 份可审阅报告` : "尚无达到审阅门槛的报告"}</small></div>
        <div class="signal-grid signal-grid-five">
          <div><span>待确认范围</span><b>${clarify}</b><small>需要补齐输入</small></div>
          <div><span>执行失败</span><b>${failed}</b><small>需检查原因</small></div>
          <div><span>正在执行</span><b>${exec}</b><small>任务处理中</small></div>
          <div><span>待人工审阅</span><b>${review}</b><small>报告待人工审阅</small></div>
          <div><span>已完成签核</span><b>${signed}</b><small>已完成终审签核</small></div>
        </div>
        <button class="brief-launch" onClick=${() => go(review ? "#/runs?review=pending" : "#/new")}><span><b>${review ? `审阅 ${review} 份待签核报告` : "打开董事会研究简报"}</b><small>${review ? "先完成证据、单位经济和风险终审" : "品牌能力 · 单位经济 · 证据门槛"}</small></span><i>↗</i></button>
      </aside>
    </section>

    <section class="recent-block">
      <div class="block-head"><div><span>RECENT RESEARCH</span><h3>最近研究</h3></div><a href="#/runs" onClick=${() => go("#/runs")}>查看全部 <i>↗</i></a></div>
      ${runsError ? html`<div class="research-load-error" role="alert"><b>研究档案暂时无法加载</b><span>${runsError}</span><button type="button" onClick=${() => setRunsReloadKey(value => value + 1)}>重新加载</button></div>` : runs === null ? html`<div class="research-list research-list-loading" aria-busy="true" aria-label="正在加载最近研究">${[1,2,3].map(index => html`<div class="research-row research-row-skeleton" key=${index}><span></span><span><b></b><small></small></span><i></i></div>`)}</div>` : runs.length ? html`<div class="research-list">${runs.slice(0,5).map(r => { const ui = deriveRunUiState(r); return html`
        <button class="research-row" key=${r.id} onClick=${() => go("#/run/"+r.id)} aria-label=${`${r.title}；${ui.stage.label}；${ui.evidence.label}；${ui.decision.label}；${ui.nextAction}`}>
          <span class="research-index">${String(r.id).padStart(2,"0")}</span>
          <span class="research-title"><b>${r.title}</b><small>Amazon ${r.marketplace} · ${new Date(r.created_at*1000).toLocaleDateString()}</small></span>
          <span class="research-statuses">${runStateBadge(ui.stage, "stage")}${runStateBadge(ui.evidence, "evidence")}</span>
          <span class="research-verdict">${ui.decision.label}</span>
          <span class="research-next">${ui.nextAction} <i aria-hidden="true">›</i></span>
        </button>`; })}</div>` : html`<div class="research-empty"><span>⌁</span><b>还没有研究</b><p>从上方输入一个品类，建立你的第一份决策档案。</p></div>`}
    </section>

  </div>`;
}

function sbDot(s){ const c={done:"#10a37f",queued:"#a16207",executing:"#3b82f6",await_clarify:"#d97706",failed:"#ef4444"}[s]||"#8a8a8a";
  return html`<span class="sb-dot" style=${`background:${c}`}></span>`; }
function Sidebar({ route, collapsed, onToggle }) {
  const [runs, setRuns] = useState(null);
  const researchRouteActive = route.startsWith("#/runs") || route.startsWith("#/run/");
  const researchRouteCurrent = route.startsWith("#/runs") ? "page" : researchRouteActive ? "location" : undefined;
  useEffect(() => { loadRunSummaries().then(setRuns).catch(() => {}); }, [route]);
  return html`<aside class="sidebar">
    <div class="sb-top">
      <div class="sb-brand"><span class="mk">M</span><span class="l sb-brandcopy"><b>Metis</b><small>Decision OS</small></span>
        <button class="sb-collapse" onClick=${onToggle} title="折叠 / 展开侧栏">${collapsed ? "»" : "«"}</button></div>
      <div class="sb-workspace l">跨境选品决策工作台</div>
      <button class="sb-new" onClick=${() => go("#/new")}><span class="i">＋</span><span class="l">发起新研究</span><span class="l sb-shortcut">N</span></button>
      <nav class="sb-nav">
        <a href="#/" aria-current=${route==="#/"||route==="#"?"page":undefined} class=${route==="#/"||route==="#"?"on":""} onClick=${() => go("#/")}><span class="i">⌂</span><span class="l">决策首页</span></a>
        <a href="#/runs" class=${researchRouteActive?"on":""} aria-current=${researchRouteCurrent} onClick=${() => go("#/runs")}><span class="i">▦</span><span class="l">研究档案</span></a>
        ${store.user?.role === "admin" ? html`<a href="#/archive" aria-current=${route.startsWith("#/archive")?"page":undefined} class=${route.startsWith("#/archive")?"on":""} onClick=${() => go("#/archive")}><span class="i">▣</span><span class="l">归档记录</span></a>` : ""}
        ${store.user?.role === "admin" ? html`<a href="#/admin/users" aria-current=${route.startsWith("#/admin/users")?"page":undefined} class=${route.startsWith("#/admin/users")?"on":""} onClick=${() => go("#/admin/users")}><span class="i">◎</span><span class="l">用户与积分</span></a>` : html`<a href="#/credits" aria-current=${route.startsWith("#/credits")?"page":undefined} class=${route.startsWith("#/credits")?"on":""} onClick=${() => go("#/credits")}><span class="i">◉</span><span class="l">我的积分</span></a>`}
        ${store.user?.role === "admin" ? html`<a href="#/settings" aria-current=${route.startsWith("#/settings")?"page":undefined} class=${route.startsWith("#/settings")?"on":""} onClick=${() => go("#/settings")}><span class="i">⚙</span><span class="l">数据源设置</span></a>` : ""}
        <a href="#/account" aria-current=${route.startsWith("#/account")?"page":undefined} class=${route.startsWith("#/account")?"on":""} onClick=${() => go("#/account")}><span class="i">◎</span><span class="l">账户与安全</span></a>
      </nav>
      <div class="sb-sec">最近研究</div>
      <nav class="sb-runs" aria-label="最近研究" aria-busy=${runs === null}>${(runs||[]).slice(0,12).map(r => html`<a href=${"#/run/"+r.id} key=${r.id} class=${route==="#/run/"+r.id?"on":""} aria-current=${route==="#/run/"+r.id?"page":undefined} onClick=${() => go("#/run/"+r.id)} title=${r.title}>${sbDot(r.status)}<span class="l">${r.title}</span></a>`)}
        ${runs === null ? html`<div class="sb-empty sb-loading l">正在加载…</div>` : !runs.length ? html`<div class="sb-empty l">还没有研究</div>` : ""}</nav>
    </div>
    <div class="sb-user">
      <div class="sb-ava">${(store.user?.name||"U").slice(0,1).toUpperCase()}</div>
      <div class="sb-uinfo l"><div class="sb-uname">${store.user?.name}${store.user?.role==="admin"?html`<span class="sb-role">ADMIN</span>`:""}</div><div class="sb-umail">${store.user?.email}</div></div>
      <button type="button" class="sb-logout l" onClick=${logout} title="退出" aria-label="退出登录">⎋</button>
    </div>
  </aside>`;
}

// ---------------- Toasts ----------------
let _toast = null;
let toastSequence = 0;
function toast(msg, type) { if (_toast) _toast({ msg, type, id: ++toastSequence }); }
function Toasts() {
  const [list, setList] = useState([]);
  const timers = useRef(new Map());
  const dismiss = (id) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setList(current => current.filter(item => item.id !== id));
  };
  useEffect(() => {
    const activeTimers = timers.current;
    _toast = (item) => {
      setList(current => [...current.slice(-3), item]);
      const timeout = setTimeout(() => dismiss(item.id), item.type === "err" ? 5200 : 3800);
      activeTimers.set(item.id, timeout);
    };
    return () => {
      _toast = null;
      activeTimers.forEach(clearTimeout);
      activeTimers.clear();
    };
  }, []);
  return html`<div class="toasts" aria-live="polite" aria-atomic="false">${list.map(item => html`
    <div key=${item.id} class=${"toast " + (item.type || "")} role=${item.type === "err" ? "alert" : "status"}>
      <span>${item.msg}</span><button type="button" aria-label="关闭提示" onClick=${() => dismiss(item.id)}>×</button>
    </div>`)}</div>`;
}

function NetworkStatus() {
  const [state, setState] = useState(navigator.onLine === false ? "offline" : "online");
  const recoveryTimer = useRef(null);
  const wasOffline = useRef(navigator.onLine === false);
  useEffect(() => {
    const offline = () => {
      wasOffline.current = true;
      if (recoveryTimer.current) clearTimeout(recoveryTimer.current);
      setState("offline");
    };
    const online = () => {
      if (!wasOffline.current) return setState("online");
      wasOffline.current = false;
      setState("restored");
      recoveryTimer.current = setTimeout(() => setState("online"), 2800);
    };
    addEventListener("offline", offline);
    addEventListener("online", online);
    return () => {
      removeEventListener("offline", offline);
      removeEventListener("online", online);
      if (recoveryTimer.current) clearTimeout(recoveryTimer.current);
    };
  }, []);
  if (state === "online") return null;
  return html`<div class=${"network-status " + state} role="status" aria-live="assertive">
    <i aria-hidden="true"></i><span>${state === "offline" ? "网络已断开，未完成的操作不会自动提交" : "网络连接已恢复"}</span>
  </div>`;
}

// ---------------- Command palette (Cmd/Ctrl+K) ----------------
function Palette({ open, onClose }) {
  const [q, setQ] = useState("");
  const [runs, setRuns] = useState(null);
  const [loadError, setLoadError] = useState("");
  const dialogRef = useRef(null);
  useDialogFocus(dialogRef, onClose, open);
  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setQ(""); setRuns(null); setLoadError("");
    loadRunSummaries().then((items) => {
      if (active) setRuns(items);
    }).catch((error) => {
      if (!active) return;
      setRuns([]);
      setLoadError(error.message || "研究档案加载失败");
    });
    return () => { active = false; };
  }, [open]);
  if (!open) return null;
  const acts = [["首页","#/"],["全部研究","#/runs"],["＋ 新建研究","#/new"],
    ...(store.user?.role === "admin" ? [["用户与积分","#/admin/users"],["数据源设置","#/settings"]] : [["我的积分","#/credits"]]),
    ["账户与安全","#/account"]];
  const ql = q.trim().toLowerCase();
  const fr = (runs || []).filter(r => `${r.title || ""} ${r.marketplace || ""}`.toLowerCase().includes(ql)).slice(0, 8);
  const fa = acts.filter(action => action[0].toLowerCase().includes(ql));
  const goTo = (h) => { onClose(); go(h); };
  const moveFocus = (event) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = [...dialogRef.current.querySelectorAll(".pal-item")];
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement);
    const index = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : event.key === "ArrowDown" ? Math.min(items.length - 1, current + 1) : Math.max(0, current - 1);
    items[index].focus();
  };
  const activateFirst = (event) => {
    event.preventDefault();
    dialogRef.current?.querySelector(".pal-item")?.click();
  };
  return html`<div class="pal-scrim" onClick=${onClose}><form ref=${dialogRef} class="pal" role="dialog" aria-modal="true" aria-labelledby="palette-title" onSubmit=${activateFirst} onClick=${e => e.stopPropagation()} tabindex="-1">
    <label id="palette-title" class="sr-only" for="palette-search">搜索研究或跳转页面</label>
    <input id="palette-search" class="pal-in" autofocus autocomplete="off" placeholder="搜索研究或跳转页面" value=${q} onInput=${e => setQ(e.target.value)} onKeyDown=${event => { if (event.key === "ArrowDown") moveFocus(event); }}/>
    <div class="pal-list">
      ${fa.map(a => html`<button type="button" class="pal-item" key=${a[1]} onKeyDown=${moveFocus} onClick=${() => goTo(a[1])}>${a[0]}</button>`)}
      ${fr.length ? html`<div class="pal-sec">研究</div>` : ""}
      ${fr.map(r => html`<button type="button" class="pal-item" key=${r.id} onKeyDown=${moveFocus} onClick=${() => goTo("#/run/"+r.id)}>${sbDot(r.status)}<span>${r.title}</span><small>${runNextActionLabel(r)}</small></button>`)}
      ${runs === null ? html`<div class="pal-empty" role="status">正在加载研究…</div>` : ""}
      ${loadError ? html`<div class="pal-empty pal-error" role="alert">${loadError}</div>` : ""}
      ${runs !== null && !loadError && !fa.length && !fr.length ? html`<div class="pal-empty">没有匹配结果</div>` : ""}
    </div><div class="pal-hint"><span><kbd>↑</kbd><kbd>↓</kbd> 选择</span><span><kbd>Enter</kbd> 打开</span><span><kbd>Esc</kbd> 关闭</span></div>
  </form></div>`;
}

// ---------------- Settings（数据源接入）----------------
function Settings() {
  const [s, setS] = useState(null);
  const [settingsError, setSettingsError] = useState("");
  const [clear, setClear] = useState({});
  const [providers, setProviders] = useState(null);
  const [providersError, setProvidersError] = useState("");
  const [health, setHealth] = useState(null);
  const [healthError, setHealthError] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const loadSettings = () => {
    setSettingsError(""); setS(null);
    api("/settings").then(setS).catch((error) => setSettingsError(error.message || "数据源配置加载失败"));
  };
  const loadProviders = () => {
    setProvidersError(""); setProviders(null);
    api("/providers").then(setProviders).catch((error) => setProvidersError(error.message || "模型状态加载失败"));
  };
  const loadHealth = () => {
    setHealthError(""); setHealth(null);
    api("/health").then(setHealth).catch((error) => setHealthError(error.message || "运行能力加载失败"));
  };
  useEffect(() => { loadSettings(); loadProviders(); loadHealth(); }, []);
  const F = [["spapi_refresh_token","SP-API Refresh Token","自有店铺数据（Data Kiosk / Reports / Fees）"],
    ["keepa_key","Keepa API Key","竞品 BSR / 价格 / 评分历史"],
    ["keepamore_api_key","KeepaMore API Key","免费版不含 API · 套餐 Key 用于价格/BSR/评分历史"],
    ["dataforseo_login","DataForSEO 账号","竞品评论抓取"],["dataforseo_password","DataForSEO 密码",""]];
  const hasConfiguredSource = F.some(([key]) => (s?.[`${key}_configured`] || s?.[key]) && !clear[key]);
  const save = async () => {
    setBusy(true);
    try {
      const data = Object.fromEntries(F.map(([key]) => [key, s[key] || ""]));
      const result = await api("/settings", { method: "PUT", body: { data, clear } });
      const clientSettings = { ...result };
      delete clientSettings.ok;
      setS(clientSettings);
      setClear({});
      toast("已保存数据源配置", "ok");
    } catch (e) { toast(e.message, "err"); }
    setBusy(false);
  };
  const testProviders = async () => {
    setTesting(true);
    try {
      const result = await api("/providers/test", { method: "POST" });
      const tested = Object.fromEntries((result.providers||[]).map(p=>[p.id,p]));
      setProviders(prev => ({...(prev||{}), providers:(prev?.providers||[]).map(p=>({...p,test:tested[p.id]}))}));
      loadHealth();
      toast(result.ok ? "最近连接测试已通过" : "部分连接测试失败", result.ok ? "ok" : "err");
    } catch (e) { toast(e.message, "err"); }
    setTesting(false);
  };
  if (!s && settingsError) return html`<div class="empty run-error"><b>数据源设置没有加载成功</b><span>${settingsError}</span><button class="btn" onClick=${loadSettings}>重新加载</button></div>`;
  if (!s) return html`<div class="loading"><span class="spin"></span>加载中…</div>`;
  return html`<div class="settings-page">
    <div class="pagehead pagehead-rich"><div><span class="eyebrow">WORKSPACE SETTINGS</span><h2>数据源接入</h2><p>管理研究所需的数据连接与模型能力。</p></div></div>
    <section class="settings-capabilities" aria-label="当前可用能力">
      <div class="settings-capability-head"><div><span class="eyebrow">DELIVERY READINESS</span><h3>当前可交付能力</h3></div>${healthError ? html`<button type="button" onClick=${loadHealth}>重新读取</button>` : ""}</div>
      ${healthError ? html`<div class="research-load-error"><b>能力状态暂时无法读取</b><span>${healthError}</span></div>` : !health ? html`<div class="capability-grid capability-grid-loading" aria-busy="true">${[1,2,3].map(index=>html`<div key=${index}><i></i><span></span><b></b></div>`)}</div>` : html`<div class="capability-grid">
        ${[
          ["智能研究",health.ready_for_ai_research,health.ready_for_ai_research?"可执行模型分析与交叉复核":"模型、队列或访问策略尚未就绪"],
          ["完整实证研究",health.ready_for_full_evidence_research,health.ready_for_full_evidence_research?"评论、订单退货与市场数据均可验证":"当前仅支持部分实证，评论正文与经营实绩接口待补"],
          ["专业场景套图",health.ready_for_concept_generation,health.ready_for_concept_generation?"设计服务、归档队列与永久存储均可用":"Lovart 连接已配置，但永久图片存储未就绪，生成暂停"],
        ].map(([label,ready,detail])=>html`<article class=${ready?"ready":"paused"}><i></i><span>${label}</span><b>${ready?"可用":"暂停"}</b><p>${detail}</p></article>`)}</div>`}
    </section>
    <section class="formcard provider-panel">
      <div class="provider-head"><div><span class="eyebrow">MODEL RUNTIME</span><h3>研究与设计引擎</h3><p>DeepSeek 负责主分析，Qwen 负责独立复核，Lovart 把研究结论转化为可落地的产品概念图。密钥只保存在服务端环境中。</p></div>
        <button class="btn ghost provider-test" disabled=${testing} onClick=${testProviders}>${testing ? "测试中…" : "测试连接"}</button></div>
      ${providersError ? html`<div class="research-load-error"><b>模型状态暂时无法读取</b><span>${providersError}</span><button onClick=${loadProviders}>重新加载</button></div>` : providers === null ? html`<div class="provider-grid provider-grid-loading" aria-busy="true" aria-label="正在加载连接状态">${[1,2,3].map(index=>html`<div class="provider-card" key=${index}><div class="provider-cardtop"><span class="provider-mark"></span><span><b></b><small></small></span></div><div class="provider-model"></div><div class="provider-state"></div></div>`)}</div>` : html`<div class="provider-grid">${(providers?.providers||[]).map(p => {
        const tested = p.test != null;
        const testPassed = p.test?.ok === true;
        const connectionLabel = !p.configured ? "运行健康：未检测" : !tested ? "运行健康：尚未测试" : testPassed ? `运行健康：最近测试通过${p.test?.latency_ms ? ` · ${p.test.latency_ms}ms` : ""}` : "运行健康：最近测试失败";
        return html`<div key=${p.id} class=${"provider-card "+(testPassed?"ready":p.configured?"configured":"offline")}>
          <div class="provider-cardtop"><span class="provider-mark">${p.name.slice(0,1)}</span><span><b>${p.name}</b><small>${p.role}</small></span><i></i></div>
          <div class="provider-model">${p.model}</div>
          <div class="provider-credential">凭据：${p.configured ? "已配置" : "未配置"}</div>
          <div class="provider-state">${connectionLabel}</div>
          ${tested&&!testPassed&&p.test?.error?html`<small class="provider-error">${p.test.error}</small>`:""}
        </div>`;
      })}</div>`}
    </section>
    <div class="formcard">
      <div class="settings-note"><b>安全说明</b><span>模型密钥由服务端环境托管，不会发送到浏览器；研究事实会提交给已配置的模型进行分析与交叉复核。</span></div>
      ${F.map(([k,lb,d]) => {
        const configured = Boolean(s[`${k}_configured`]) && !clear[k];
        const masked = s[`${k}_masked`] || "";
        return html`<div key=${k} class=${"secret-field" + (clear[k] ? " pending-clear" : "")}>
          <div class="secret-label"><label for=${`setting-${k}`}>${lb}${d ? html` <span>· ${d}</span>` : ""}</label>
            <small>${clear[k] ? "保存后清除" : configured ? `已配置 ${masked}` : "未配置"}</small></div>
          <div class="secret-row"><input id=${`setting-${k}`} type="password" autocomplete="off" value=${s[k]||""}
            onInput=${e => { setS({...s,[k]:e.target.value}); if (e.target.value) setClear({...clear,[k]:false}); }}
            placeholder=${configured ? "输入新值可替换；留空保留现有值" : "输入凭据"}/>
            <label class="secret-clear"><input type="checkbox" checked=${Boolean(clear[k])} disabled=${!configured && !s[k]}
              onChange=${e => { setClear({...clear,[k]:e.target.checked}); if (e.target.checked) setS({...s,[k]:""}); }}/><span>清除</span></label></div>
        </div>`;
      })}
      <div class="settings-actions"><span class=${"badge " + (hasConfiguredSource ? "b-done" : "b-wait")}>${hasConfiguredSource ? "已配置部分数据源" : "未接入 · 框架演示模式"}</span><button class="btn" disabled=${busy} onClick=${save}>${busy ? "保存中…" : "保存数据源设置"}</button></div>
    </div>
  </div>`;
}

function AccountSecurity() {
  const [passwords, setPasswords] = useState({ current: "", next: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const updatePassword = async (event) => {
    event.preventDefault();
    if (passwords.next !== passwords.confirm) return toast("两次输入的新密码不一致", "err");
    setBusy(true);
    try {
      const result = await api("/account/password", { method: "PUT", body: { current_password: passwords.current, new_password: passwords.next } });
      setAuth(result.token, result.user);
      setPasswords({ current: "", next: "", confirm: "" });
      toast("密码已更新，其他登录会话已退出", "ok");
    } catch (error) {
      toast(error.message || "密码更新失败", "err");
    } finally {
      setBusy(false);
    }
  };
  return html`<div class="settings-page account-security-page">
    <div class="pagehead pagehead-rich"><div><span class="eyebrow">ACCOUNT & SECURITY</span><h2>账户与安全</h2><p>管理你自己的登录凭据，不会改动工作区数据源。</p></div></div>
    <section class="account-identity-panel">
      <span class="sb-ava">${(store.user?.name||"U").slice(0,1).toUpperCase()}</span>
      <div><b>${store.user?.name || "未命名用户"}</b><span>${store.user?.email}</span><small>${accountRoleLabel(store.user?.role)} · ${accountStatusLabel(store.user?.status)}</small></div>
    </section>
    <form class="formcard account-password-form" onSubmit=${updatePassword}>
      <div class="settings-note"><b>修改登录密码</b><span>更新后，除当前设备外的其他登录会话会立即失效。新密码至少 8 位。</span></div>
      <label for="account-current-password">当前密码</label><input id="account-current-password" type="password" autocomplete="current-password" required value=${passwords.current} onInput=${event=>setPasswords({...passwords,current:event.target.value})}/>
      <label for="account-new-password">新密码</label><input id="account-new-password" type="password" autocomplete="new-password" minlength="8" maxlength="128" required value=${passwords.next} onInput=${event=>setPasswords({...passwords,next:event.target.value})}/>
      <label for="account-confirm-password">确认新密码</label><input id="account-confirm-password" type="password" autocomplete="new-password" minlength="8" maxlength="128" required value=${passwords.confirm} onInput=${event=>setPasswords({...passwords,confirm:event.target.value})}/>
      <button class="btn" disabled=${busy} aria-busy=${busy}>${busy?"更新中…":"更新密码"}</button>
    </form>
  </div>`;
}

// ---------------- Accounts and credits ----------------
const CREDIT_RULE_COPY = {
  research_generation: ["完整研究生成", "每次创建并执行一份研究报告时扣除"],
  scene_suite_generation: ["专业场景套图", "每次确认生成一套六张产品效果图时扣除"],
};

function AccountDialog({ label, onClose, wide = false, children }) {
  const dialogRef = useRef(null);
  useDialogFocus(dialogRef, onClose);
  return html`<div class="account-scrim" onClick=${onClose}>
    <section ref=${dialogRef} class=${"account-dialog" + (wide ? " account-dialog-wide" : "")} role="dialog" aria-modal="true" aria-label=${label} tabindex="-1" onClick=${event => event.stopPropagation()}>
      ${children}
    </section>
  </div>`;
}

function CreditLedger({ items, emptyText = "还没有积分变动" }) {
  if (!items?.length) return html`<div class="credit-ledger-empty"><b>${emptyText}</b><span>新的充值、扣减与消费记录会按时间显示在这里。</span></div>`;
  return html`<div class="credit-ledger" role="table" aria-label="积分流水">
    <div class="credit-ledger-head" role="row"><span>变动</span><span>原因</span><span>操作方</span><span>时间</span><span>余额</span></div>
    ${items.map(transaction => {
      const delta = creditDelta(transaction);
      return html`<div class="credit-ledger-row" role="row" key=${transaction.id}>
        <strong class=${delta < 0 ? "credit-negative" : "credit-positive"}>${delta > 0 ? "+" : ""}${formatCredits(delta)}</strong>
        <span class="credit-ledger-reason"><b>${creditReason(transaction)}</b><small>${transaction.reference_type || transaction.type || "账户流水"}</small></span>
        <span>${transaction.actor_name || transaction.actor_email || transaction.source || "系统"}</span>
        <time>${formatAccountTime(transaction.created_at)}</time>
        <span class="credit-balance-after">${transaction.balance_after == null ? "—" : formatCredits(transaction.balance_after)}</span>
      </div>`;
    })}
  </div>`;
}

function PersonalCredits() {
  const [account, setAccount] = useState(null);
  const [health, setHealth] = useState(null);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let active = true;
    setAccount(null); setHealth(null); setError("");
    api("/credits/me").then(result => { if (active) setAccount(result); }).catch(err => {
      if (active) setError(err.message || "积分账户加载失败");
    });
    api("/health").then(result => { if (active) setHealth(result); }).catch(() => { if (active) setHealth({}); });
    return () => { active = false; };
  }, [reloadKey]);
  if (!account && error) return html`<div class="empty run-error"><b>积分账户暂时无法加载</b><span>${error}</span><button class="btn" onClick=${() => setReloadKey(value => value + 1)}>重新加载</button></div>`;
  if (!account) return html`<div class="loading"><span class="spin"></span>加载积分账户…</div>`;
  const summary = account.summary || {};
  const capabilityReady = (key) => key === "scene_suite_generation"
    ? health?.ready_for_concept_generation === true
    : health?.ready_for_ai_research === true;
  return html`<div class="credits-page dashboard-v3">
    <div class="pagehead pagehead-rich"><div><span class="eyebrow">CREDIT ACCOUNT</span><h2>我的积分</h2><p>查看当前可用额度与每一笔积分变动。</p></div></div>
    <section class="personal-credit-hero" aria-label="积分余额">
      <div><span>当前可用积分</span><strong>${formatCredits(account.balance)}</strong><small>实际可执行次数同时受计费规则与当前系统能力影响</small></div>
      <dl>
        <div><dt>累计获得</dt><dd>+${formatCredits(summary.credited)}</dd></div>
        <div><dt>累计使用</dt><dd>-${formatCredits(Math.abs(creditNumber(summary.debited)))}</dd></div>
        <div><dt>流水笔数</dt><dd>${formatCredits(summary.transaction_count)}</dd></div>
      </dl>
    </section>
    <section class="credit-capability-section">
      <div class="account-section-head"><div><span>ACTIVE CAPABILITIES</span><h3>可用能力与单次费用</h3></div><span>工作区积分</span></div>
      <div class="credit-capability-list">${(account.rules || []).map(rule => {
        const copy = CREDIT_RULE_COPY[rule.key] || [rule.label, "该能力的工作区计费规则"];
        const ready = capabilityReady(rule.key);
        const executable = rule.enabled && ready;
        const count = !rule.enabled ? "未启用" : !ready ? "能力暂停" : rule.cost > 0 ? `约 ${Math.floor(creditNumber(account.balance) / rule.cost)} 次` : "当前不扣积分";
        return html`<article class=${executable?"available":"paused"}>
          <div><i></i><span><b>${copy[0]}</b><small>${copy[1]}</small></span></div>
          <dl><div><dt>单次费用</dt><dd>${rule.enabled ? `${formatCredits(rule.cost)} 积分` : "规则未启用"}</dd></div><div><dt>当前余额可执行</dt><dd>${count}</dd></div></dl>
          <span class="credit-capability-state">${executable?"可用":!rule.enabled?"计费未启用":"基础能力暂停"}</span>
        </article>`;
      })}</div>
      ${!(account.rules || []).length ? html`<div class="credit-ledger-empty"><b>尚无启用的计费能力</b><span>当前余额不会被研究或场景套图流程扣除。</span></div>` : ""}
    </section>
    <section class="personal-ledger-section">
      <div class="account-section-head"><div><span>RECENT ACTIVITY</span><h3>近期积分流水</h3></div><button class="quiet-action" onClick=${() => setReloadKey(value => value + 1)}>刷新</button></div>
      <${CreditLedger} items=${account.recent_transactions || []}/>
    </section>
  </div>`;
}

function AdminUsers() {
  const [users, setUsers] = useState(null);
  const [summary, setSummary] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", email: "", password: "", initial_credits: "0" });
  const [createBusy, setCreateBusy] = useState(false);
  const [creditUser, setCreditUser] = useState(null);
  const [creditForm, setCreditForm] = useState({ direction: "add", amount: "", reason: "" });
  const [creditBusy, setCreditBusy] = useState(false);
  const [ledgerUser, setLedgerUser] = useState(null);
  const [ledgerItems, setLedgerItems] = useState(null);
  const [ledgerCursor, setLedgerCursor] = useState(null);
  const [ledgerError, setLedgerError] = useState("");
  const [ledgerBusy, setLedgerBusy] = useState(false);
  const [passwordUser, setPasswordUser] = useState(null);
  const [passwordForm, setPasswordForm] = useState({ password: "", confirm: "" });
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [rules, setRules] = useState(null);
  const [rulesError, setRulesError] = useState("");
  const [ruleBusy, setRuleBusy] = useState("");

  const loadRules = () => {
    setRulesError("");
    api("/admin/credit-rules").then(result => setRules(result.items || [])).catch(err => {
      setRules([]); setRulesError(err.message || "计费规则加载失败");
    });
  };
  useEffect(loadRules, []);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      setUsers(null); setError("");
      try {
        const params = new URLSearchParams({ limit: "20" });
        if (query.trim()) params.set("q", query.trim());
        if (status !== "all") params.set("status", status);
        const result = await api(`/admin/users?${params}`);
        if (!active) return;
        setUsers(result.items || []); setSummary(result.summary || null); setNextCursor(result.next_cursor || null);
      } catch (err) {
        if (!active) return;
        setUsers([]); setError(err.message || "用户列表加载失败");
      }
    }, query.trim() ? 260 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [query, status, reloadKey]);

  const replaceUser = (updated) => setUsers(items => (items || []).map(user => user.id === updated.id ? updated : user));
  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ limit: "20", cursor: String(nextCursor) });
      if (query.trim()) params.set("q", query.trim());
      if (status !== "all") params.set("status", status);
      const result = await api(`/admin/users?${params}`);
      setUsers(items => [...(items || []), ...(result.items || [])]);
      setNextCursor(result.next_cursor || null);
    } catch (err) { toast(err.message || "更多用户加载失败", "err"); }
    finally { setLoadingMore(false); }
  };
  const createUser = async (event) => {
    event.preventDefault();
    const initialCredits = Number(createForm.initial_credits || 0);
    if (!Number.isSafeInteger(initialCredits) || initialCredits < 0) return toast("初始积分必须是非负整数", "err");
    setCreateBusy(true);
    try {
      await api("/admin/users", { method: "POST", body: {
        email: createForm.email.trim(), password: createForm.password, name: createForm.name.trim(), role: "member", initial_credits: initialCredits,
      }});
      setCreateOpen(false); setCreateForm({ name: "", email: "", password: "", initial_credits: "0" });
      setReloadKey(value => value + 1); toast("普通用户已创建", "ok");
    } catch (err) { toast(err.message || "用户创建失败", "err"); }
    finally { setCreateBusy(false); }
  };
  const toggleStatus = async (user) => {
    const nextStatus = user.status === "disabled" ? "active" : "disabled";
    if (nextStatus === "disabled" && !confirm(`停用 ${user.email}？该用户将无法继续登录。`)) return;
    setBusyAction(`status:${user.id}`);
    try {
      const result = await api(`/admin/users/${user.id}`, { method: "PATCH", body: { status: nextStatus } });
      replaceUser(result.user); setReloadKey(value => value + 1);
      toast(nextStatus === "disabled" ? "用户已停用" : "用户已启用", "ok");
    } catch (err) { toast(err.message || "用户状态更新失败", "err"); }
    finally { setBusyAction(""); }
  };
  const adjustCredits = async (event) => {
    event.preventDefault();
    const magnitude = Number(creditForm.amount);
    if (!Number.isSafeInteger(magnitude) || magnitude <= 0) return toast("积分数量必须是正整数", "err");
    const amount = creditForm.direction === "subtract" ? -magnitude : magnitude;
    setCreditBusy(true);
    try {
      const result = await api(`/admin/users/${creditUser.id}/credits`, { method: "POST", body: {
        amount, reason: creditForm.reason.trim(), idempotency_key: crypto.randomUUID(),
      }});
      const updated = { ...creditUser, credits: { ...(creditUser.credits || {}), balance: result.balance } };
      replaceUser(updated);
      setSummary(value => value ? { ...value, total_credits: creditNumber(value.total_credits) + amount } : value);
      setCreditUser(null); setCreditForm({ direction: "add", amount: "", reason: "" });
      toast(result.replayed ? "该积分调整已处理" : `积分已${amount > 0 ? "增加" : "扣减"}`, "ok");
    } catch (err) { toast(err.message || "积分调整失败", "err"); }
    finally { setCreditBusy(false); }
  };
  const loadLedger = async (user, cursor = null, append = false) => {
    setLedgerBusy(true); setLedgerError("");
    if (!append) setLedgerItems(null);
    try {
      const params = new URLSearchParams({ limit: "20" });
      if (cursor) params.set("cursor", String(cursor));
      const result = await api(`/admin/users/${user.id}/credit-ledger?${params}`);
      setLedgerItems(items => append ? [...(items || []), ...(result.items || [])] : (result.items || []));
      setLedgerCursor(result.next_cursor || null);
      setLedgerUser(current => current ? { ...(result.user || current), credits: { ...(current.credits || {}), balance: result.balance } } : current);
    } catch (err) {
      setLedgerError(err.message || "积分流水加载失败");
      if (!append) setLedgerItems([]);
    } finally { setLedgerBusy(false); }
  };
  const openLedger = (user) => { setLedgerUser(user); setLedgerItems(null); setLedgerCursor(null); loadLedger(user); };
  const resetPassword = async (event) => {
    event.preventDefault();
    if (passwordForm.password !== passwordForm.confirm) return toast("两次输入的新密码不一致", "err");
    if (!confirm(`确认重置 ${passwordUser.email} 的密码？成功后，该用户当前所有登录会话都会被撤销。`)) return;
    setPasswordBusy(true);
    try {
      await api(`/admin/users/${passwordUser.id}/password`, { method: "PUT", body: { password: passwordForm.password } });
      setPasswordUser(null); setPasswordForm({ password: "", confirm: "" }); toast("密码已重置，旧会话已撤销", "ok");
    } catch (err) { toast(err.message || "密码重置失败", "err"); }
    finally { setPasswordBusy(false); }
  };
  const updateRule = (key, fields) => setRules(items => (items || []).map(rule => rule.key === key ? { ...rule, ...fields } : rule));
  const saveRule = async (rule) => {
    const cost = Number(rule.cost);
    if (!Number.isSafeInteger(cost) || cost < 0) return toast("单次积分必须是非负整数", "err");
    setRuleBusy(rule.key);
    try {
      const result = await api(`/admin/credit-rules/${encodeURIComponent(rule.key)}`, { method: "PATCH", body: { cost, enabled: Boolean(rule.enabled) } });
      updateRule(rule.key, result.rule); toast("计费规则已更新", "ok");
    } catch (err) { toast(err.message || "计费规则更新失败", "err"); }
    finally { setRuleBusy(""); }
  };

  return html`<div class="accounts-page dashboard-v3">
    <div class="pagehead pagehead-rich account-pagehead"><div><span class="eyebrow">WORKSPACE ACCESS & CREDITS</span><h2>用户与积分</h2><p>统一管理成员访问权限、积分余额、计费规则与可审计流水。</p></div><div class="spacer"></div><button class="btn" onClick=${() => setCreateOpen(true)}>＋ 创建普通用户</button></div>
    <div class="account-metrics" aria-label="用户与积分概览">
      <div><span>工作区用户</span><b>${summary ? formatCredits(summary.total) : "—"}</b><small>全部角色</small></div>
      <div><span>正常使用</span><b>${summary ? formatCredits(summary.active) : "—"}</b><small>${summary ? `${formatCredits(summary.disabled)} 个已停用` : "加载中"}</small></div>
      <div><span>积分总余额</span><b>${summary ? formatCredits(summary.total_credits) : "—"}</b><small>工作区可用积分</small></div>
      <div><span>计费能力</span><b>${rules ? rules.filter(rule => rule.enabled).length : "—"}</b><small>已启用规则</small></div>
    </div>

    <section class="account-directory">
      <div class="account-section-head"><div><span>MEMBER DIRECTORY</span><h3>用户管理</h3></div><span>${users ? `${users.length} 条已加载` : "正在同步"}</span></div>
      <div class="account-filters"><label class="account-search"><span>⌕</span><input aria-label="搜索用户" value=${query} onInput=${event => setQuery(event.target.value)} placeholder="搜索姓名或邮箱"/></label>
        <select aria-label="用户状态" value=${status} onChange=${event => setStatus(event.target.value)}><option value="all">全部状态</option><option value="active">使用中</option><option value="disabled">已停用</option></select></div>
      ${users === null && html`<div class="loading"><span class="spin"></span>加载用户…</div>`}
      ${error && html`<div class="research-load-error"><b>用户列表暂时无法加载</b><span>${error}</span><button onClick=${() => setReloadKey(value => value + 1)}>重新加载</button></div>`}
      ${!error && users?.length === 0 && html`<div class="account-empty"><b>没有符合条件的用户</b><span>调整搜索条件，或创建一个新的普通用户。</span></div>`}
      ${!error && users?.length ? html`<div class="account-table" role="table" aria-label="用户列表">
        <div class="account-table-head" role="row"><span>用户</span><span>角色 / 状态</span><span>积分余额</span><span>创建时间</span><span>操作</span></div>
        ${users.map(user => html`<div class="account-row" role="row" key=${user.id}>
          <span class="account-identity"><i>${(user.name || user.email || "U").slice(0, 1).toUpperCase()}</i><span><b>${user.name || "未设置姓名"}</b><small>${user.email}</small></span></span>
          <span class="account-role-state"><b>${accountRoleLabel(user.role)}</b><small class=${user.status === "disabled" ? "is-disabled" : "is-active"}>${accountStatusLabel(user.status)}</small></span>
          <strong class="account-credit-value">${formatCredits(user.credits?.balance)}</strong>
          <time>${formatAccountTime(user.created_at)}</time>
          <span class="account-actions">
            <button title="查看积分流水" aria-label=${`查看 ${user.email} 的积分流水`} onClick=${() => openLedger(user)}>流水</button>
            <button title="调整积分" aria-label=${`调整 ${user.email} 的积分`} onClick=${() => { setCreditUser(user); setCreditForm({ direction: "add", amount: "", reason: "" }); }}>± 积分</button>
            ${user.role !== "admin" ? html`<button title="重置密码" aria-label=${`重置 ${user.email} 的密码`} onClick=${() => { setPasswordUser(user); setPasswordForm({ password: "", confirm: "" }); }}>重置密码</button>` : ""}
            ${user.id === store.user?.id ? html`<span class="account-self">当前账号</span>` : html`<button class=${user.status === "disabled" ? "activate" : "danger"} disabled=${busyAction === `status:${user.id}`} onClick=${() => toggleStatus(user)}>${busyAction === `status:${user.id}` ? "处理中…" : user.status === "disabled" ? "启用" : "停用"}</button>`}
          </span>
        </div>`)}</div>` : ""}
      ${!error && nextCursor && html`<div class="archive-pagination"><button class="btn ghost" disabled=${loadingMore} onClick=${loadMore}>${loadingMore ? "加载中…" : "加载更多用户"}</button></div>`}
    </section>

    <section class="credit-rules-section">
      <div class="account-section-head"><div><span>USAGE PRICING</span><h3>计费规则</h3></div><span>默认关闭与 0 积分不会影响现网</span></div>
      ${rules === null && html`<div class="loading"><span class="spin"></span>加载计费规则…</div>`}
      ${rulesError && html`<div class="research-load-error"><b>计费规则暂时无法加载</b><span>${rulesError}</span><button onClick=${loadRules}>重新加载</button></div>`}
      ${rules?.length ? html`<div class="credit-rule-table">
        ${rules.map(rule => {
          const copy = CREDIT_RULE_COPY[rule.key] || [rule.label || rule.key, "按工作区设置执行积分扣减"];
          return html`<div class="credit-rule-row" key=${rule.key}>
            <span class="credit-rule-copy"><b>${rule.label || copy[0]}</b><small>${copy[1]}</small><code>${rule.key}</code></span>
            <label class="credit-rule-cost"><span>单次积分</span><input type="number" min="0" step="1" value=${rule.cost} onInput=${event => updateRule(rule.key, { cost: event.target.value })}/></label>
            <button class=${"credit-switch" + (rule.enabled ? " on" : "")} type="button" role="switch" aria-checked=${String(Boolean(rule.enabled))} onClick=${() => updateRule(rule.key, { enabled: !rule.enabled })}><i></i><span>${rule.enabled ? "已启用" : "已关闭"}</span></button>
            <span class="credit-rule-updated"><small>最近更新</small><time>${formatAccountTime(rule.updated_at)}</time></span>
            <button class="credit-rule-save" disabled=${ruleBusy === rule.key} onClick=${() => saveRule(rule)}>${ruleBusy === rule.key ? "保存中…" : "保存"}</button>
          </div>`;
        })}
      </div>` : ""}
    </section>

    ${createOpen ? html`<${AccountDialog} label="创建普通用户" onClose=${() => !createBusy && setCreateOpen(false)}>
      <div class="account-dialog-head"><div><span>NEW MEMBER</span><h3>创建普通用户</h3><p>新账号只获得研究使用权限，不包含管理员入口。</p></div><button aria-label="关闭" onClick=${() => setCreateOpen(false)}>×</button></div>
      <form class="account-form" onSubmit=${createUser}>
        <label>姓名（选填）<input autocomplete="name" value=${createForm.name} onInput=${event => setCreateForm({ ...createForm, name: event.target.value })} placeholder="成员姓名"/></label>
        <label>登录邮箱<input type="email" autocomplete="off" required value=${createForm.email} onInput=${event => setCreateForm({ ...createForm, email: event.target.value })} placeholder="name@example.com"/></label>
        <label>初始密码<input type="password" autocomplete="new-password" minlength="8" maxlength="128" required value=${createForm.password} onInput=${event => setCreateForm({ ...createForm, password: event.target.value })} placeholder="至少 8 位"/></label>
        <label>初始积分<input type="number" min="0" step="1" required value=${createForm.initial_credits} onInput=${event => setCreateForm({ ...createForm, initial_credits: event.target.value })}/></label>
        <div class="account-dialog-actions"><button type="button" class="btn ghost" onClick=${() => setCreateOpen(false)}>取消</button><button class="btn" disabled=${createBusy}>${createBusy ? "创建中…" : "创建用户"}</button></div>
      </form>
    <//>` : ""}

    ${creditUser ? html`<${AccountDialog} label="调整积分" onClose=${() => !creditBusy && setCreditUser(null)}>
      <div class="account-dialog-head"><div><span>CREDIT ADJUSTMENT</span><h3>调整积分</h3><p>${creditUser.email} · 当前 ${formatCredits(creditUser.credits?.balance)} 分</p></div><button aria-label="关闭" onClick=${() => setCreditUser(null)}>×</button></div>
      <form class="account-form" onSubmit=${adjustCredits}>
        <div class="credit-direction" role="group" aria-label="积分调整方向"><button type="button" class=${creditForm.direction === "add" ? "on" : ""} onClick=${() => setCreditForm({ ...creditForm, direction: "add" })}>＋ 增加</button><button type="button" class=${creditForm.direction === "subtract" ? "on" : ""} onClick=${() => setCreditForm({ ...creditForm, direction: "subtract" })}>− 扣减</button></div>
        <label>积分数量<input type="number" min="1" step="1" required value=${creditForm.amount} onInput=${event => setCreditForm({ ...creditForm, amount: event.target.value })} placeholder="输入正整数"/></label>
        <label>调整原因<textarea required minlength="2" maxlength="160" value=${creditForm.reason} onInput=${event => setCreditForm({ ...creditForm, reason: event.target.value })} placeholder="例如：活动赠送、售后补偿、人工纠错"></textarea></label>
        <div class="credit-preview"><span>调整后预计余额</span><b>${formatCredits(creditNumber(creditUser.credits?.balance) + (creditForm.direction === "subtract" ? -creditNumber(creditForm.amount) : creditNumber(creditForm.amount)))}</b></div>
        <div class="account-dialog-actions"><button type="button" class="btn ghost" onClick=${() => setCreditUser(null)}>取消</button><button class="btn" disabled=${creditBusy}>${creditBusy ? "提交中…" : "确认调整"}</button></div>
      </form>
    <//>` : ""}

    ${passwordUser ? html`<${AccountDialog} label="重置用户密码" onClose=${() => !passwordBusy && setPasswordUser(null)}>
      <div class="account-dialog-head"><div><span>RESET PASSWORD</span><h3>重置用户密码</h3><p>${passwordUser.email}</p></div><button aria-label="关闭" onClick=${() => setPasswordUser(null)}>×</button></div>
      <form class="account-form" onSubmit=${resetPassword}>
        <div class="account-warning"><b>会话安全</b><span>重置成功后，该用户当前所有登录会话都会立即失效，需要使用新密码重新登录。</span></div>
        <label>新密码<input type="password" autocomplete="new-password" minlength="8" maxlength="128" required value=${passwordForm.password} onInput=${event => setPasswordForm({ ...passwordForm, password: event.target.value })} placeholder="至少 8 位"/></label>
        <label>确认新密码<input type="password" autocomplete="new-password" minlength="8" maxlength="128" required value=${passwordForm.confirm} onInput=${event => setPasswordForm({ ...passwordForm, confirm: event.target.value })}/></label>
        <div class="account-dialog-actions"><button type="button" class="btn ghost" onClick=${() => setPasswordUser(null)}>取消</button><button class="btn" disabled=${passwordBusy}>${passwordBusy ? "重置中…" : "继续重置"}</button></div>
      </form>
    <//>` : ""}

    ${ledgerUser ? html`<${AccountDialog} label="积分流水" wide=${true} onClose=${() => setLedgerUser(null)}>
      <div class="account-dialog-head"><div><span>CREDIT LEDGER</span><h3>${ledgerUser.name || ledgerUser.email} 的积分流水</h3><p>${ledgerUser.email} · 当前余额 ${formatCredits(ledgerUser.credits?.balance)}</p></div><button aria-label="关闭" onClick=${() => setLedgerUser(null)}>×</button></div>
      <div class="account-dialog-body">
        ${ledgerItems === null && html`<div class="loading"><span class="spin"></span>加载流水…</div>`}
        ${ledgerError && html`<div class="research-load-error"><b>流水暂时无法加载</b><span>${ledgerError}</span><button onClick=${() => loadLedger(ledgerUser)}>重新加载</button></div>`}
        ${ledgerItems && html`<${CreditLedger} items=${ledgerItems}/>`}
        ${ledgerCursor && html`<div class="archive-pagination"><button class="btn ghost" disabled=${ledgerBusy} onClick=${() => loadLedger(ledgerUser, ledgerCursor, true)}>${ledgerBusy ? "加载中…" : "加载更多流水"}</button></div>`}
      </div>
    <//>` : ""}
  </div>`;
}

// ---------------- Report action bar（Gate-1 终审 + 决策结果 + 运行管理）----------------
function ReportActionBar({ run, setRun }) {
  const ui = deriveRunUiState(run);
  const evidenceState = evidenceStateOf(run.report || {});
  const reportUnavailable = run.report?.report_unavailable === true;
  const isDecisionReady = !reportUnavailable && evidenceState === "review_ready";
  const isTemplateDemo = evidenceState === "template_demo";
  const isEvidenceBlocked = evidenceState === "evidence_blocked";
  const isSigned = hasValidSignedDecision(run);
  const exportEdition = isSigned ? "签核版" : "审阅稿";
  const canReview = store.user?.role === "admin";
  const [busy, setBusy] = useState(false);
  const [expOpen, setExpOpen] = useState(false);
  const [expBusy, setExpBusy] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewNote, setReviewNote] = useState(run.outcome_note || "");
  const [reviewChecks, setReviewChecks] = useState({ evidence: false, economics: false, risk: false });
  const exportRootRef = useRef(null);
  const exportButtonRef = useRef(null);
  const reviewDialogRef = useRef(null);
  const exportMenuId = `report-export-menu-${String(run.id).replace(/[^a-z0-9_-]/gi, "-")}`;
  useDialogFocus(reviewDialogRef, () => setReviewOpen(false), reviewOpen);
  useEffect(() => {
    setExpOpen(false);
    setReviewOpen(false);
    setReviewNote(run.outcome_note || "");
    setReviewChecks({ evidence: false, economics: false, risk: false });
  }, [run.id, run.outcome_note, run.report?.report_version, run.reviewed_at]);
  useEffect(() => {
    if (!expOpen) return undefined;
    const closeAndRestoreFocus = () => {
      setExpOpen(false);
      requestAnimationFrame(() => exportButtonRef.current?.focus({ preventScroll: true }));
    };
    const onPointerDown = (event) => {
      if (!exportRootRef.current?.contains(event.target)) closeAndRestoreFocus();
    };
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeAndRestoreFocus();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [expOpen]);
  const printReport = async () => {
    if (!isDecisionReady) {
      toast(isTemplateDemo ? "框架演示不可导出为正式决策报告" : "关键证据尚未达标，暂不可正式导出", "err");
      return;
    }
    try {
      const proof = await createExportProof(isSigned ? "signed" : "review", run.report);
      const check = await api(`/runs/${run.id}/export-check?${proof.query}`);
      verifyExportCheck(check, proof);
      if (typeof window.metisPrintReference === "function") await window.metisPrintReference(true);
      else window.print();
    } catch (error) {
      toast(error.message || "打印前完整性校验失败", "err");
    }
  };
  const dl = async (fmt, ext) => {
    if (!isDecisionReady) {
      toast(isTemplateDemo ? "框架演示不可导出为正式决策报告" : "关键证据尚未达标，暂不可正式导出", "err");
      return;
    }
    setExpBusy(fmt);
    let objectUrl = "";
    try {
      const proof = await createExportProof(isSigned ? "signed" : "review", run.report);
      const res = await fetch(apiUrl(`/api/runs/${run.id}/export.${fmt}?${proof.query}`), { headers: { Authorization: "Bearer " + store.token } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "导出失败");
      const blob = await res.blob();
      objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = objectUrl;
      a.download = `Metis-${exportEdition}-${(run.title || run.id)}.${ext || fmt}`; document.body.appendChild(a); a.click(); a.remove();
      toast(`已导出${exportEdition} ${(ext || fmt).toUpperCase()}`, "ok");
    } catch (e) {
      toast(e.message, "err");
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setExpBusy("");
      setExpOpen(false);
    }
  };
  const patch = async (fields) => {
    setBusy(true);
    try {
      const updated = await api("/runs/"+run.id, { method: "PATCH", body: fields });
      setRun(updated);
      return true;
    } catch (e) {
      toast(e.message, "err");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const rerun = async () => {
    setBusy(true);
    try {
      const r = await api("/runs/"+run.id+"/rerun", { method: "POST", idempotencyKey: crypto.randomUUID() });
      if (Number(r.id) === Number(run.id)) {
        setRun(r);
        setBusy(false);
        toast("已按最新框架刷新", "ok");
      } else {
        toast("已创建重跑", "ok");
        go("#/run/"+r.id);
      }
    } catch (e) {
      toast(e.message, "err");
      setBusy(false);
    }
  };
  const del = async () => {
    if (!confirm("将这份研究移入归档？归档后不会出现在研究列表中，报告、概念图和审计记录仍会保留。")) return;
    setBusy(true);
    try {
      await api("/runs/"+run.id, { method: "DELETE" });
      toast("已移入归档", "ok");
      go("#/runs");
    } catch (e) {
      toast(e.message, "err");
      setBusy(false);
    }
  };
  const rename = async () => {
    const title = prompt("重命名研究", run.title);
    if (title && title !== run.title && await patch({ title })) toast("已重命名", "ok");
  };
  const confirmDelivery = async () => {
    if (!run.decision_outcome) { toast("请先选择人工决策结果", "err"); return; }
    setReviewOpen(true);
  };
  const finalizeReview = async () => {
    if (!Object.values(reviewChecks).every(Boolean)) { toast("请完成全部终审检查项", "err"); return; }
    if (!reviewNote.trim()) { toast("请填写终审依据或偏离说明", "err"); return; }
    const expectedReportHash = await sha256Json(run.report);
    const ok = await patch({
      reviewed: true,
      decision_outcome: run.decision_outcome,
      outcome_note: reviewNote.trim(),
      review_checks: { ...reviewChecks },
      expected_report_hash: expectedReportHash,
      expected_report_version: String(run.report?.report_version || run.report?.schema_version || "unknown"),
    });
    if (ok) { setReviewOpen(false); toast("已记录人工签核", "ok"); }
  };
  const revokeReview = async () => {
    const reason = prompt("填写撤销签核原因");
    if (!reason?.trim()) return;
    if (await patch({ reviewed: false, review_reason: reason.trim() })) {
      setReviewChecks({ evidence: false, economics: false, risk: false });
      toast("已撤销签核，历史记录已保留", "ok");
    }
  };
  const OUT = ["进入","有条件","放弃","观望"];
  return html`<div class="actionbar">
    <div class="ab-left">
      <button class="ab-back" onClick=${() => go("#/runs")} title="返回研究档案" aria-label="返回研究档案">‹</button>
      <span class="ab-run-title"><small>研究档案</small><b title=${run.title}>${run.title}</b></span>
      <span class=${"ab-review " + (!isDecisionReady ? "blocked" : isSigned ? "ok" : "warn")} title=${ui.evidence.detail}>${ui.evidence.label} · ${ui.decision.label}</span>
      ${isDecisionReady && !isSigned && !canReview ? html`<small class="ab-audit">仅管理员可执行人工签核</small>` : ""}
      ${isSigned ? html`<small class="ab-audit">${new Date(run.reviewed_at * 1000).toLocaleString()} · ${run.reviewer_name}</small>` : ""}
    </div>
    <div class="ab-right">
      ${isDecisionReady && !isSigned && canReview ? html`<div class="ab-review-flow"><span class="ab-lbl">1 · 选择决策</span><div class="seg sm" role="group" aria-label="人工决策结果">${OUT.map(v => html`<button key=${v} type="button" aria-pressed=${String(run.decision_outcome===v)} disabled=${busy} class=${run.decision_outcome===v?"on":""} onClick=${() => patch({ decision_outcome: v })}>${v}</button>`)}</div><button class="ab-btn primary ab-review-action" disabled=${busy || !run.decision_outcome} title=${run.decision_outcome ? "进入人工终审" : "请先选择决策结果"} onClick=${confirmDelivery}>${busy ? "保存中…" : "2 · 发起终审"}</button></div>` : html`<div class="ab-state-summary"><span>下一步</span><b>${ui.nextAction}</b><small>${ui.decision.detail}</small></div>`}
      <div class="ab-desktop-tools">
        ${isDecisionReady ? html`<div class="ab-exp" ref=${exportRootRef}>
          <button ref=${exportButtonRef} id=${`${exportMenuId}-trigger`} type="button" aria-haspopup="menu" aria-expanded=${String(expOpen)} aria-controls=${exportMenuId} disabled=${Boolean(expBusy) || !isDecisionReady} class=${"ab-btn"+(expOpen?" on":"")} onClick=${() => setExpOpen(o => !o)} title=${isTemplateDemo ? "框架演示不可正式导出" : isEvidenceBlocked ? "关键证据待补齐" : `导出${exportEdition}`}>${expBusy ? "导出中…" : `⭳ ${exportEdition}`}</button>
          ${expOpen ? html`<div class="ab-menu" id=${exportMenuId} role="menu" aria-labelledby=${`${exportMenuId}-trigger`}>
            <button role="menuitem" type="button" disabled=${Boolean(expBusy)} onClick=${() => dl("md", "md")}>${exportEdition} Markdown</button>
            <button role="menuitem" type="button" disabled=${Boolean(expBusy)} onClick=${() => dl("json", "json")}>${exportEdition} JSON</button>
            <button role="menuitem" type="button" onClick=${() => { printReport(); setExpOpen(false); }}>${exportEdition} PDF</button>
          </div>` : ""}
        </div>` : ""}
        ${isSigned && canReview ? html`<button class="ab-btn" disabled=${busy} onClick=${revokeReview}>撤销签核</button>` : ""}
        ${canReview ? html`<details class="ab-desktop-more"><summary class="ab-btn" aria-label="更多报告操作">更多</summary><div class="ab-utility-menu">
          <button type="button" disabled=${busy} onClick=${rename}>重命名研究</button>
          <button type="button" disabled=${busy || isSigned} onClick=${rerun}>${isSigned ? "撤销签核后可重新运行" : "重新运行"}</button>
          <button type="button" class="danger" disabled=${busy} onClick=${del}>移入归档</button>
        </div></details>` : ""}
      </div>
      <details class="ab-mobile-tools"><summary aria-label="更多报告操作">•••</summary><div>
        ${canReview ? html`<button disabled=${busy} onClick=${rename}>重命名研究</button>
        <button disabled=${busy || isSigned} onClick=${rerun}>${isSigned ? "撤销签核后可重新运行" : "重新运行"}</button>` : ""}
        ${isDecisionReady ? html`<button disabled=${Boolean(expBusy)} onClick=${() => dl("md", "md")}>导出${exportEdition} Markdown</button><button disabled=${Boolean(expBusy)} onClick=${() => dl("json", "json")}>导出${exportEdition} JSON</button><button onClick=${printReport}>导出${exportEdition} PDF</button>` : html`<span class="ab-mobile-boundary">${ui.evidence.label} · 暂不可正式导出</span>`}
        ${canReview ? html`<button class="danger" disabled=${busy} onClick=${del}>移入归档</button>` : ""}
      </div></details>
    </div>
    ${reviewOpen ? html`<div class="review-scrim" onClick=${() => setReviewOpen(false)}></div><section ref=${reviewDialogRef} class="review-dialog" role="dialog" aria-modal="true" aria-label="人工终审" tabindex="-1">
      <div class="review-head"><div><span>GATE-1 · HUMAN REVIEW</span><h3>确认这份报告可以进入决策</h3></div><button aria-label="关闭" onClick=${() => setReviewOpen(false)}>×</button></div>
      <div class="review-outcome"><span>人工决策</span><b>${run.decision_outcome}</b></div>
      <div class="review-checks">
        <label><input type="checkbox" checked=${reviewChecks.evidence} onChange=${event => setReviewChecks(value => ({ ...value, evidence: event.target.checked }))}/><span><b>证据边界</b>已检查关键结论、来源、观察日期与待补证项。</span></label>
        <label><input type="checkbox" checked=${reviewChecks.economics} onChange=${event => setReviewChecks(value => ({ ...value, economics: event.target.checked }))}/><span><b>单位经济</b>已核对售价、成本、履约、广告与退货假设。</span></label>
        <label><input type="checkbox" checked=${reviewChecks.risk} onChange=${event => setReviewChecks(value => ({ ...value, risk: event.target.checked }))}/><span><b>风险与执行</b>已确认放行条件、停止线、责任人和下一步。</span></label>
      </div>
      <label class="review-note"><span>终审依据 / 偏离说明</span><textarea value=${reviewNote} onInput=${event => setReviewNote(event.target.value)} placeholder="说明为什么进入、有条件进入、放弃或观望；若偏离 AI 建议，记录依据。"></textarea></label>
      <div class="review-actions"><button class="ab-btn" onClick=${() => setReviewOpen(false)}>取消</button><button class="ab-btn primary" disabled=${busy} onClick=${finalizeReview}>${busy ? "记录中…" : "记录终审决定"}</button></div>
    </section>` : ""}
  </div>`;
}

function App() {
  const route = useRoute();
  const isAuthRoute = route.startsWith("#/login") || route.startsWith("#/register");
  const effectiveRoute = !store.token && !isAuthRoute ? "#/login" : route;
  const chrome = Boolean(store.token && !effectiveRoute.startsWith("#/login") && !effectiveRoute.startsWith("#/register"));
  const [collapsed, setCollapsed] = useState(localStorage.getItem("ia_collapse") === "1");
  const [palette, setPalette] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuRef = useRef(null);
  const mobileMenuTriggerRef = useRef(null);
  useEffect(() => { const k = e => {
    if ((e.metaKey||e.ctrlKey) && (e.key==="k"||e.key==="K")) { e.preventDefault(); setPalette(o => !o); return; }
    if (!e.metaKey && !e.ctrlKey && !e.altKey && (e.key === "n" || e.key === "N") && !e.target?.closest?.("input,textarea,select,button,a,[contenteditable='true']")) { e.preventDefault(); go("#/new"); }
  }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, []);
  useEffect(() => {
    if (route !== effectiveRoute) go(effectiveRoute);
  }, [route, effectiveRoute]);
  useEffect(() => {
    window.scrollTo(0, 0);
    const title = effectiveRoute.startsWith("#/new") ? "新建研究"
      : effectiveRoute.startsWith("#/run/") ? "研究报告"
      : effectiveRoute.startsWith("#/runs") ? "研究档案"
      : effectiveRoute.startsWith("#/archive") ? "归档记录"
      : effectiveRoute.startsWith("#/admin/users") ? "用户与积分"
      : effectiveRoute.startsWith("#/credits") ? "我的积分"
      : effectiveRoute.startsWith("#/settings") ? "数据源设置"
      : effectiveRoute.startsWith("#/account") ? "账户与安全"
      : effectiveRoute.startsWith("#/login") ? "登录"
      : effectiveRoute.startsWith("#/register") ? "创建工作区"
      : "决策首页";
    document.title = `${title} · Metis`;
    const focusFrame = requestAnimationFrame(() => document.getElementById("main-content")?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(focusFrame);
  }, [effectiveRoute]);
  useEffect(() => { setMobileMenuOpen(false); setPalette(false); }, [effectiveRoute]);
  useEffect(() => {
    const closeOutside = (event) => {
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(event.target)) setMobileMenuOpen(false);
    };
    const closeEscape = (event) => {
      if (event.key !== "Escape" || mobileMenuTriggerRef.current?.getAttribute("aria-expanded") !== "true") return;
      event.preventDefault();
      setMobileMenuOpen(false);
      requestAnimationFrame(() => mobileMenuTriggerRef.current?.focus({ preventScroll: true }));
    };
    addEventListener("pointerdown", closeOutside);
    addEventListener("keydown", closeEscape);
    return () => { removeEventListener("pointerdown", closeOutside); removeEventListener("keydown", closeEscape); };
  }, []);
  useEffect(() => {
    const mobileViewport = matchMedia("(max-width: 820px)");
    const closeAtDesktop = (event) => {
      if (event.matches) return;
      const focusWasInMobileMenu = mobileMenuRef.current?.contains(document.activeElement);
      setMobileMenuOpen(false);
      if (focusWasInMobileMenu) {
        requestAnimationFrame(() => document.getElementById("main-content")?.focus({ preventScroll: true }));
      }
    };
    mobileViewport.addEventListener("change", closeAtDesktop);
    return () => mobileViewport.removeEventListener("change", closeAtDesktop);
  }, []);
  useEffect(() => {
    if (!chrome) return undefined;
    const on = () => { const rp = document.getElementById("rp"); if (!rp) return;
      const h = document.documentElement, p = h.scrollHeight - h.clientHeight;
      rp.style.width = (p > 0 ? h.scrollTop / p * 100 : 0) + "%"; };
    addEventListener("scroll", on, { passive: true }); on();
    return () => {
      removeEventListener("scroll", on);
      document.getElementById("rp")?.style.removeProperty("width");
    };
  }, [chrome]);
  const toggleCollapse = () => { const v = !collapsed; setCollapsed(v); localStorage.setItem("ia_collapse", v ? "1" : "0"); };
  let page;
  if (effectiveRoute.startsWith("#/login")) page = html`<${Auth} key="login" mode="login"/>`;
  else if (effectiveRoute.startsWith("#/register")) page = html`<${Auth} key="register" mode="register"/>`;
  else if (effectiveRoute.startsWith("#/new")) page = html`<${BriefWizard} api=${api} go=${go} token=${store.token} ownerKey=${store.user?.email||store.user?.id}/>`;
  else if (effectiveRoute.startsWith("#/run/")) page = html`<${RunView} id=${effectiveRoute.split("/")[2]}/>`;
  else if (effectiveRoute.startsWith("#/runs")) page = html`<${Dashboard}/>`;
  else if (effectiveRoute.startsWith("#/archive")) page = store.user?.role === "admin"
    ? html`<${Archive}/>`
    : html`<div class="empty run-error"><b>没有归档管理权限</b><span>仅工作区管理员可以恢复归档研究。</span><button class="btn" onClick=${() => go("#/")}>返回首页</button></div>`;
  else if (effectiveRoute.startsWith("#/admin/users")) page = store.user?.role === "admin"
    ? html`<${AdminUsers}/>`
    : html`<div class="empty run-error"><b>没有用户管理权限</b><span>普通用户只能查看自己的积分账户。</span><button class="btn" onClick=${() => go("#/credits")}>查看我的积分</button></div>`;
  else if (effectiveRoute.startsWith("#/credits")) page = html`<${PersonalCredits}/>`;
  else if (effectiveRoute.startsWith("#/account")) page = html`<${AccountSecurity}/>`;
  else if (effectiveRoute.startsWith("#/settings")) page = store.user?.role === "admin"
    ? html`<${Settings}/>`
    : html`<div class="empty run-error"><b>没有数据源设置权限</b><span>仅工作区管理员可以查看或修改服务端凭据。</span><button class="btn" onClick=${() => go("#/")}>返回首页</button></div>`;
  else page = html`<${Home} onOpenPalette=${() => setPalette(true)}/>`;
  if (!chrome) return html`<main id="main-content" tabindex="-1" key="auth-root" class="auth-route"><${Toasts}/><${NetworkStatus}/><div class="wrap">${page}</div></main>`;
  return html`<div key="workspace-root" class=${"app-shell"+(collapsed?" collapsed":"")}>
    <a class="skip-link" href="#main-content">跳到主要内容</a>
    <div class="read-progress" id="rp"></div>
    <${Toasts}/>
    <${NetworkStatus}/>
    <${Palette} open=${palette} onClose=${() => setPalette(false)}/>
    <${Sidebar} route=${effectiveRoute} collapsed=${collapsed} onToggle=${toggleCollapse}/>
    <header class="mobile-topbar">
      <a href="#/" class="mobile-brand" aria-current=${effectiveRoute==="#/"?"page":undefined} onClick=${() => go("#/")}><i>M</i><b>Metis</b></a>
      <nav aria-label="移动端主导航">
        <a href="#/runs" aria-current=${effectiveRoute.startsWith("#/run")?"page":undefined} onClick=${() => go("#/runs")}>研究</a>
        <a href="#/new" class="mobile-new" aria-current=${effectiveRoute.startsWith("#/new")?"page":undefined} onClick=${() => go("#/new")}>＋ 新建</a>
        <div ref=${mobileMenuRef} class="mobile-more">
          <button ref=${mobileMenuTriggerRef} class="mobile-more-toggle" type="button" aria-expanded=${mobileMenuOpen} aria-controls="mobile-account-panel" aria-label=${mobileMenuOpen?"关闭账户菜单":"打开账户菜单"} onClick=${() => setMobileMenuOpen(open => !open)}>•••</button>
          ${mobileMenuOpen ? html`<div id="mobile-account-panel" role="group" aria-label="账户菜单">${store.user?.role === "admin" ? html`<a href="#/archive" aria-current=${effectiveRoute.startsWith("#/archive")?"page":undefined} onClick=${() => setMobileMenuOpen(false)}>归档记录</a><a href="#/admin/users" aria-current=${effectiveRoute.startsWith("#/admin/users")?"page":undefined} onClick=${() => setMobileMenuOpen(false)}>用户与积分</a><a href="#/settings" aria-current=${effectiveRoute.startsWith("#/settings")?"page":undefined} onClick=${() => setMobileMenuOpen(false)}>数据源设置</a>` : html`<a href="#/credits" aria-current=${effectiveRoute.startsWith("#/credits")?"page":undefined} onClick=${() => setMobileMenuOpen(false)}>我的积分</a>`}<a href="#/account" aria-current=${effectiveRoute.startsWith("#/account")?"page":undefined} onClick=${() => setMobileMenuOpen(false)}>账户与安全</a><span>${store.user?.email}</span><button type="button" onClick=${logout}>退出登录</button></div>` : ""}
        </div>
      </nav>
    </header>
    <main id="main-content" class="main" tabindex="-1"><div class="wrap">${page}</div></main>
  </div>`;
}

// ---------------- Auth ----------------
function Auth({ mode }) {
  const [email, setEmail] = useState(""); const [pw, setPw] = useState("");
  const [name, setName] = useState(""); const [org, setOrg] = useState("");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const reg = mode === "register";
  async function submit(e) {
    e.preventDefault(); setErr(""); setBusy(true);
    try {
      const path = reg ? "/auth/register" : "/auth/login";
      const body = reg ? { email, password: pw, name, org } : { email, password: pw };
      const r = await api(path, { method: "POST", body });
      setAuth(r.token, r.user); go("#/");
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  return html`<div class="auth-shell">
    <section class="auth-story">
      <div class="auth-brand"><i>M</i><span><b>Metis</b><small>Decision Intelligence</small></span></div>
      <div class="auth-storycopy">
        <span class="eyebrow">CROSS-BORDER COMMERCE AI</span>
        <h2>从证据出发，<br/>做值得下注的产品。</h2>
        <p>把分散的市场、竞品、消费者与成本信号，收敛成团队可以直接执行的选品决策。</p>
        <div class="auth-chain">${["机会","结构","心智","验证","GTM"].map((t,i)=>html`<span key=${t}><b>${i+1}</b>${t}</span>`)}</div>
      </div>
      <div class="auth-quote"><i>“</i><span>不是更多数据，而是更短的决策路径。</span></div>
    </section>
    <form class="auth" onSubmit=${submit}>
      <div class="auth-cardtop"><span class="auth-cardmark">M</span><span>METIS WORKSPACE</span></div>
      <h1>${reg ? "创建你的工作区" : "欢迎回来"}</h1>
      <div class="auth-subtitle">${reg ? "建立团队的跨境选品决策系统" : "登录后继续你的研究与决策"}</div>
      ${reg && html`<label for="auth-org">公司 / 团队</label><input id="auth-org" autocomplete="organization" value=${org} onInput=${e=>setOrg(e.target.value)} placeholder="你的品牌或机构"/>`}
      ${reg && html`<label for="auth-name">姓名</label><input id="auth-name" autocomplete="name" value=${name} onInput=${e=>setName(e.target.value)} placeholder="你的名字"/>`}
      <label for="auth-email">邮箱</label><input id="auth-email" type="email" autocomplete="email" required value=${email} onInput=${e=>setEmail(e.target.value)} placeholder="you@example.com"/>
      <label for="auth-password">密码</label><input id="auth-password" type="password" autocomplete=${reg ? "new-password" : "current-password"} minlength=${reg ? "8" : undefined} maxlength="128" required value=${pw} onInput=${e=>setPw(e.target.value)} placeholder=${reg ? "至少 8 位" : "输入密码"}/>
      ${err && html`<div class="err">${err}</div>`}
      <button class="btn auth-submit" disabled=${busy}>${busy ? "处理中…" : (reg ? "创建工作区  →" : "进入 Metis  →")}</button>
      <div class="swap">${reg ? "已有账号？" : "还没有账号？"}
        <button type="button" class="auth-switch" onClick=${()=>go(reg ? "#/login" : "#/register")}>${reg ? "返回登录" : "免费注册"}</button></div>
      <div class="auth-trust"><span>加密会话</span><span>租户隔离</span><span>证据可溯源</span></div>
    </form>
  </div>`;
}

// ---------------- Dashboard ----------------
function Dashboard() {
  const [runs, setRuns] = useState(null);
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [decision, setDecision] = useState("all");
  const [review, setReview] = useState(() => new URLSearchParams((location.hash.split("?")[1] || "")).get("review") || "all");
  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const cursor = runs?.length ? `&cursor=${runs.at(-1).id}` : "";
      const items = await api(`/runs?limit=50${cursor}`);
      setRuns(current => [...(current || []), ...items]);
      setHasMore(items.length === 50);
    } catch (err) {
      setError(err.message || "研究档案加载失败");
    } finally {
      setLoadingMore(false);
    }
  };
  useEffect(() => {
    let active = true;
    setError("");
    setRuns(null);
    api("/runs?limit=50").then((items) => {
      if (!active) return;
      setRuns(items);
      setHasMore(items.length === 50);
    }).catch((err) => {
      if (!active) return;
      setError(err.message || "研究档案加载失败");
      setRuns([]);
    });
    return () => { active = false; };
  }, [reloadKey]);
  const filtered = (runs || []).filter(run => {
    const q = query.trim().toLowerCase();
    if (q && !`${run.title || ""} ${run.marketplace || ""} ${run.decision_outcome || run.verdict || ""}`.toLowerCase().includes(q)) return false;
    if (status !== "all" && run.status !== status) return false;
    if (decision !== "all" && (run.decision_outcome || "none") !== decision) return false;
    if (review === "signed" && !hasValidSignedDecision(run)) return false;
    const ui = deriveRunUiState(run);
    if (review === "pending" && !(run.status === "done" && ["review", "draft"].includes(ui.decision.key))) return false;
    if (review === "blocked" && !(run.status === "done" && ["partial", "blocked"].includes(ui.evidence.key))) return false;
    if (review === "demo" && !(run.status === "done" && ui.evidence.key === "demo")) return false;
    return true;
  });
  return html`<div class="dashboard-page dashboard-v3">
    <div class="pagehead pagehead-rich"><div><span class="eyebrow">RESEARCH ARCHIVE</span><h2>研究档案</h2><p>集中管理每一次选品研究、决策结果与交付状态。</p></div><div class="spacer"></div>
      <button class="btn" onClick=${()=>go("#/new")}>＋ 发起新研究</button></div>
    <div class="archive-filters"><label class="archive-search"><span>⌕</span><input aria-label="搜索研究" value=${query} onInput=${event => setQuery(event.target.value)} placeholder="搜索品类、站点或决策"/></label>
      <select aria-label="分析状态" value=${status} onChange=${event => setStatus(event.target.value)}><option value="all">全部状态</option><option value="await_clarify">待确认</option><option value="queued">排队中</option><option value="executing">执行中</option><option value="done">报告完成</option><option value="failed">失败</option></select>
      <select aria-label="人工决策" value=${decision} onChange=${event => setDecision(event.target.value)}><option value="all">全部决策</option><option value="进入">进入</option><option value="有条件">有条件</option><option value="放弃">放弃</option><option value="观望">观望</option><option value="none">未决策</option></select>
      <select aria-label="审阅状态" value=${review} onChange=${event => setReview(event.target.value)}><option value="all">全部审阅</option><option value="pending">待审阅</option><option value="signed">已签核</option><option value="blocked">证据待补齐</option><option value="demo">框架演示</option></select>
      <span class="archive-count">已加载 ${(runs || []).length} 条 · 当前显示 ${filtered.length} 条${hasMore ? " · 还有更多" : ""}</span></div>
    ${runs === null && html`<div class="loading"><span class="spin"></span>加载中…</div>`}
    ${error && html`<div class="research-load-error"><b>研究档案暂时无法加载</b><span>${error}</span><button onClick=${()=>setReloadKey(value=>value+1)}>重新加载</button></div>`}
    ${!error && runs && runs.length === 0 && html`<div class="empty"><b>还没有研究</b><span>从一个品类关键词或竞品 ASIN 开始你的第一次选品决策。</span><button class="btn" onClick=${()=>go("#/new")}>发起研究</button></div>`}
    ${!error && runs && runs.length > 0 && filtered.length === 0 && html`<div class="empty"><b>当前已加载的 ${(runs || []).length} 条中没有匹配</b><span>${hasMore ? "尚有未加载档案，可继续加载；也可调整搜索词或筛选条件。" : "调整搜索词或筛选条件后再试。"}</span><button class="btn ghost" onClick=${() => { setQuery(""); setStatus("all"); setDecision("all"); setReview("all"); }}>清除筛选</button>${hasMore ? html`<button class="btn ghost" disabled=${loadingMore} onClick=${loadMore}>${loadingMore?"加载中…":"继续加载档案"}</button>` : ""}</div>`}
    ${!error && filtered.length ? html`<div class="archive-table">
      <div class="archive-head"><span>研究项目</span><span>研究阶段</span><span>证据等级</span><span>决策进展</span><span>更新时间</span><span>下一步</span></div>
      ${filtered.map(r => { const ui = deriveRunUiState(r); return html`<button class="archive-row" key=${r.id} onClick=${()=>go("#/run/"+r.id)} aria-label=${`${r.title}；${ui.stage.label}；${ui.evidence.label}；${ui.decision.label}；${ui.nextAction}`}>
        <span class="archive-title"><i>${String(r.id).padStart(2,"0")}</i><span><b>${r.title}</b><small>Amazon ${r.marketplace}</small></span></span>
        <span>${runStateBadge(ui.stage,"stage")}</span><span>${runStateBadge(ui.evidence,"evidence")}</span>
        <span class="archive-verdict">${ui.decision.label}</span><span>${new Date((r.updated_at || r.created_at)*1000).toLocaleDateString()}</span><span class="archive-next">${ui.nextAction} <i aria-hidden="true">›</i></span>
      </button>`; })}</div>` : ""}
    ${!error && hasMore && html`<div class="archive-pagination"><button class="btn ghost" disabled=${loadingMore} onClick=${loadMore}>${loadingMore ? "加载中…" : "加载更多"}</button></div>`}
  </div>`;
}

function Archive() {
  const [runs, setRuns] = useState(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const last = runs?.length ? runs.at(-1) : null;
      const cursor = last ? `&cursor=${encodeURIComponent(`${last.deleted_at}:${last.id}`)}` : "";
      const items = await api(`/runs/archived?limit=50${cursor}`);
      setRuns(current => [...(current || []), ...items]);
      setHasMore(items.length === 50);
    } catch (err) {
      setError(err.message || "归档记录加载失败");
    } finally {
      setLoadingMore(false);
    }
  };
  useEffect(() => {
    let active = true;
    setError("");
    setRuns(null);
    api("/runs/archived?limit=50").then((items) => {
      if (!active) return;
      setRuns(items);
      setHasMore(items.length === 50);
    }).catch((err) => {
      if (!active) return;
      setError(err.message || "归档记录加载失败");
      setRuns([]);
    });
    return () => { active = false; };
  }, [reloadKey]);
  const restore = async (run) => {
    if (!confirm(`恢复“${run.title}”到研究档案？`)) return;
    setBusyId(run.id);
    try {
      await api(`/runs/${run.id}/restore`, { method: "POST" });
      setRuns((items) => items.filter((item) => item.id !== run.id));
      toast("已恢复到研究档案", "ok");
    } catch (err) {
      toast(err.message || "恢复失败", "err");
    } finally {
      setBusyId(0);
    }
  };
  return html`<div class="dashboard-page dashboard-v3 archive-page">
    <div class="pagehead pagehead-rich"><div><span class="eyebrow">ARCHIVED RESEARCH</span><h2>归档记录</h2><p>归档不会删除报告、概念图或审计历史，恢复后会重新出现在研究档案中。</p></div><div class="spacer"></div><button class="btn ghost" onClick=${() => go("#/runs")}>返回研究档案</button></div>
    ${runs === null && html`<div class="loading"><span class="spin"></span>加载中…</div>`}
    ${error && html`<div class="research-load-error"><b>归档记录暂时无法加载</b><span>${error}</span><button onClick=${()=>setReloadKey(value=>value+1)}>重新加载</button></div>`}
    ${!error && runs && runs.length === 0 && html`<div class="empty"><b>没有归档记录</b><span>移入归档的研究会保留在这里，并可由管理员恢复。</span><button class="btn ghost" onClick=${() => go("#/runs")}>查看研究档案</button></div>`}
    ${!error && runs?.length ? html`<div class="archive-table archive-restore-table">
      <div class="archive-head"><span>研究项目</span><span>站点</span><span>状态</span><span>决策</span><span>归档时间</span><i></i></div>
      ${runs.map((run) => html`<div class="archive-row archive-row-static" key=${run.id}>
        <span class="archive-title"><i>${String(run.id).padStart(2, "0")}</i><b>${run.title}</b></span>
        <span>Amazon ${run.marketplace}</span><span>${decisionStateBadge(run)}</span>
        <span class="archive-verdict">${runDecisionLabel(run)}</span>
        <span>${new Date((run.deleted_at || run.updated_at) * 1000).toLocaleString()}</span>
        <button class="archive-restore" disabled=${busyId === run.id} onClick=${() => restore(run)}>${busyId === run.id ? "恢复中…" : "恢复"}</button>
      </div>`)}</div>` : ""}
    ${!error && hasMore && html`<div class="archive-pagination"><button class="btn ghost" disabled=${loadingMore} onClick=${loadMore}>${loadingMore ? "加载中…" : "加载更多"}</button></div>`}
  </div>`;
}

function decisionStateBadge(run) {
  return runStateBadge(deriveRunUiState(run).decision, "decision");
}

// ---------------- Run View ----------------
function RunView({ id }) {
  const [run, setRun] = useState(null);
  const [report, setReport] = useState(null);
  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState("");
  const streamRef = useRef(null);
  const loadRef = useRef(null);
  const operationRef = useRef(null);
  const runRef = useRef(null);
  const requestSequenceRef = useRef(0);
  const activeRunIdRef = useRef(String(id));

  const isCurrentRunRequest = useCallback(function isCurrentRunRequest(sequence, runId, controller) {
    return requestSequenceRef.current === sequence &&
      activeRunIdRef.current === String(runId) &&
      !controller?.signal.aborted;
  }, []);

  const beginRunRequest = useCallback(function beginRunRequest() {
    loadRef.current?.abort();
    streamRef.current?.abort();
    operationRef.current?.abort();
    const controller = new AbortController();
    const sequence = requestSequenceRef.current + 1;
    const runId = String(id);
    requestSequenceRef.current = sequence;
    activeRunIdRef.current = runId;
    loadRef.current = controller;
    return { controller, sequence, runId };
  }, [id]);

  const applyRun = useCallback(function applyRun(nextRun, sequence = requestSequenceRef.current, runId = activeRunIdRef.current) {
    if (!nextRun || !isCurrentRunRequest(sequence, runId)) return false;
    if (nextRun.id != null && String(nextRun.id) !== String(runId)) return false;
    runRef.current = nextRun;
    setRun(nextRun);
    if (nextRun.status === "done" && nextRun.report) {
      setReport(nextRun.report);
      setPhase("report");
    } else if (["queued", "executing"].includes(nextRun.status)) {
      setPhase("executing");
    } else if (nextRun.status === "failed") {
      setError(nextRun.error_message || "上次执行失败，请检查研究计划后重试");
      setPhase("error");
    } else {
      setPhase("clarify");
    }
    return true;
  }, [isCurrentRunRequest]);

  const waitForPoll = useCallback((delay, signal) => new Promise(resolve => {
    if (signal.aborted) { resolve(); return; }
    const timer = setTimeout(done, delay);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  }), []);

  const startStream = useCallback(async function startStream(sequence = requestSequenceRef.current, runId = activeRunIdRef.current) {
    if (!isCurrentRunRequest(sequence, runId)) return;
    if (streamRef.current) streamRef.current.abort();
    const controller = new AbortController();
    streamRef.current = controller;
    let transientFailures = 0;
    let pollCount = 0;
    let statusEtag = "";
    try {
      while (!controller.signal.aborted) {
        try {
          const response = await api(`/runs/${runId}/status`, {
            timeoutMs: 15_000,
            signal: controller.signal,
            ifNoneMatch: statusEtag,
            responseMeta: true,
          });
          if (!isCurrentRunRequest(sequence, runId, controller)) return;
          transientFailures = 0;
          statusEtag = response.etag || statusEtag;
          if (response.notModified) {
            pollCount += 1;
            const delay = Math.max(
              1_500,
              Math.min(5_000, 1_500 + pollCount * 120),
            ) + Math.floor(Math.random() * 400);
            await waitForPoll(delay, controller.signal);
            continue;
          }
          const status = response.data;
          setRun(current => {
            if (!isCurrentRunRequest(sequence, runId, controller)) return current;
            if (current?.id != null && String(current.id) !== String(runId)) return current;
            const merged = current ? { ...current, ...status } : status;
            runRef.current = merged;
            return merged;
          });
          if (status.status === "done" && status.has_report) {
            const completed = await api("/runs/" + runId, {
              timeoutMs: 30_000,
              signal: controller.signal,
            });
            if (!isCurrentRunRequest(sequence, runId, controller)) return;
            applyRun(completed, sequence, runId);
            return;
          }
          if (status.status === "failed") {
            throw new Error(status.error_message || "研究执行失败，请检查计划后重试");
          }
        } catch (pollError) {
          if (controller.signal.aborted || !isCurrentRunRequest(sequence, runId, controller)) return;
          transientFailures += 1;
          if (pollError.status && ![429, 500, 502, 503, 504].includes(pollError.status)) {
            throw pollError;
          }
          if (transientFailures >= 5) throw pollError;
        }
        pollCount += 1;
        const delay = Math.max(
          1_500,
          Math.min(5_000, 1_500 + pollCount * 120),
        ) + Math.floor(Math.random() * 400);
        await waitForPoll(delay, controller.signal);
      }
    } catch (streamError) {
      if (controller.signal.aborted || streamError?.name === "AbortError" || !isCurrentRunRequest(sequence, runId, controller)) return;
      try {
        const latest = await api("/runs/" + runId, {
          timeoutMs: 30_000,
          signal: controller.signal,
        });
        if (!isCurrentRunRequest(sequence, runId, controller)) return;
        if (!["queued", "executing"].includes(latest.status)) {
          applyRun(latest, sequence, runId);
          return;
        }
        runRef.current = latest;
        setRun(latest);
        setError(streamError.message || "研究仍在后台执行，但状态同步已中断");
        setPhase("sync_error");
        return;
      } catch (fallbackError) {
        if (controller.signal.aborted || fallbackError?.name === "AbortError" || !isCurrentRunRequest(sequence, runId, controller)) return;
        if (["queued", "executing"].includes(runRef.current?.status)) {
          setError(streamError.message || "研究仍在后台执行，但状态同步已中断");
          setPhase("sync_error");
          return;
        }
      }
      setError(streamError.message || "执行连接中断，请重试");
      setPhase("error");
    } finally {
      if (streamRef.current === controller) streamRef.current = null;
    }
  }, [applyRun, isCurrentRunRequest, waitForPoll]);

  const loadRun = useCallback(async function loadRun() {
    const request = beginRunRequest();
    const { controller, sequence, runId } = request;
    runRef.current = null;
    setRun(null);
    setReport(null);
    setError("");
    setPhase("loading");
    try {
      const latest = await api("/runs/" + runId, {
        timeoutMs: 30_000,
        signal: controller.signal,
      });
      if (!isCurrentRunRequest(sequence, runId, controller)) return;
      applyRun(latest, sequence, runId);
      if (["queued", "executing"].includes(latest.status)) startStream(sequence, runId);
    } catch (loadError) {
      if (loadError?.name === "AbortError" || !isCurrentRunRequest(sequence, runId, controller)) return;
      setError(loadError.message || "研究加载失败");
      setPhase("error");
    } finally {
      if (loadRef.current === controller) loadRef.current = null;
    }
  }, [applyRun, beginRunRequest, isCurrentRunRequest, startStream]);

  useEffect(() => {
    loadRun();
    return () => {
      if (activeRunIdRef.current === String(id)) {
        requestSequenceRef.current += 1;
        activeRunIdRef.current = "";
      }
      loadRef.current?.abort();
      streamRef.current?.abort();
      operationRef.current?.abort();
    };
  }, [id, loadRun]);
  useEffect(() => {
    if (phase !== "report") return undefined;
    const frame = requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
    return () => cancelAnimationFrame(frame);
  }, [id, phase]);
  async function confirm(researchPlan) {
    const sequence = requestSequenceRef.current;
    const runId = activeRunIdRef.current;
    operationRef.current?.abort();
    const controller = new AbortController();
    operationRef.current = controller;
    setError("");
    setPhase("executing");
    try {
      const confirmation = await api(`/runs/${id}/confirm`, {
        method: "POST",
        body: { research_plan: researchPlan },
        timeoutMs: 30_000,
        signal: controller.signal,
      });
      if (!isCurrentRunRequest(sequence, runId, controller)) return;
      if (confirmation.status === "done" && confirmation.has_report) {
        applyRun(await api("/runs/" + id, { timeoutMs: 30_000, signal: controller.signal }), sequence, runId);
        return;
      }
      applyRun(run ? { ...run, ...confirmation } : confirmation);
      if (["queued", "executing"].includes(confirmation.status)) startStream();
    } catch (confirmError) {
      if (confirmError?.name === "AbortError" || !isCurrentRunRequest(sequence, runId, controller)) return;
      setError(confirmError.message || "研究执行失败");
      try {
        const latest = await api("/runs/" + id, { signal: controller.signal });
        if (!isCurrentRunRequest(sequence, runId, controller)) return;
        applyRun(latest, sequence, runId);
        if (["queued", "executing"].includes(latest.status)) {
          startStream(sequence, runId);
          return;
        }
        if (latest.status === "failed") {
          setError(latest.error_message || confirmError.message || "研究执行失败");
          return;
        }
      } catch (recoveryError) {
        if (controller.signal.aborted || recoveryError?.name === "AbortError" || !isCurrentRunRequest(sequence, runId, controller)) return;
        // Keep the confirmation error visible.
      }
      setPhase("error");
    } finally {
      if (operationRef.current === controller) operationRef.current = null;
    }
  }
  if (phase === "loading") return html`<div class="loading"><span class="spin"></span>加载中…</div>`;
  if (phase === "sync_error") return html`<div class="run-sync-shell"><div class="run-sync-warning" role="alert"><i></i><span><b>研究仍在后台执行</b><small>${error}。这不代表任务失败，重新连接后会继续同步。</small></span><button class="btn" onClick=${loadRun}>恢复状态同步</button><button class="btn ghost" onClick=${() => go("#/runs")}>返回档案</button></div><${Progress} run=${run}/></div>`;
  if (phase === "error") { const failed = run?.status === "failed"; return html`<div class="empty run-error"><b>${failed?"这次研究执行失败":"研究状态暂时无法读取"}</b><span>${error}</span>${failed ? html`<button class="btn" onClick=${() => setPhase("clarify")}>检查计划并重试</button>` : ""}<button class="btn ghost" onClick=${loadRun}>重新加载状态</button><button class="btn ghost" onClick=${() => go("#/runs")}>返回研究档案</button></div>`; }
  if (phase === "clarify") return html`<${Gate0} run=${run} error=${error} onConfirm=${confirm}/>`;
  if (phase === "executing") return html`<${Progress} run=${run}/>`;
  if (report?.report_unavailable === true) return html`<div class="run-report report-integrity-run"><${ReportView} report=${report} run=${run} onReload=${loadRun} onBack=${() => go("#/runs")}/></div>`;
  const reportClass = report?.presentation_version === "reference-a4-v2" ? "run-report reference-run" : "run-report";
  return html`<div class=${reportClass}><${ReportActionBar} run=${run} setRun=${applyRun}/><${ReportView} report=${report} run=${run} api=${api} onRunUpdated=${applyRun} canManageConcept=${store.user?.role === "admin"}/></div>`;
}

function Gate0({ run, error, onConfirm }) {
  const sourcePlan = run.research_plan || {};
  const [draft, setDraft] = useState(() => ({
    ...sourcePlan,
    research_brief: { ...(sourcePlan.research_brief || {}) },
  }));
  const [seedText, setSeedText] = useState(() => (sourcePlan.seed_competitors || []).map(item => item.asin).join("\n"));
  const [answers, setAnswers] = useState(() => ({ ...(sourcePlan.clarification_answers || {}) }));
  const [acknowledged, setAcknowledged] = useState(false);
  const brief = draft.research_brief || {};
  const priceRange = Array.isArray(brief.priceRange) ? brief.priceRange : ["", ""];
  const requestedSources = Object.entries(brief.sources || {}).filter(([, enabled]) => enabled).map(([key]) => key.toUpperCase());
  const isPrivateOnly = run.data_scope === "private_only";
  const usesKeepaMore = !isPrivateOnly && requestedSources.includes("KEEPAMORE");
  const updateBrief = (fields) => setDraft(plan => ({ ...plan, research_brief: { ...(plan.research_brief || {}), ...fields } }));
  const submit = () => {
    const seeds = seedText.split(/[\s,，]+/).map(value => value.trim().toUpperCase()).filter(Boolean);
    const invalid = seeds.find(value => !/^[A-Z0-9]{10}$/.test(value));
    if (invalid) { alert(`ASIN 格式无效：${invalid}`); return; }
    onConfirm({
      ...draft,
      seed_competitors: seeds.map(asin => ({ asin, reason: "Gate-0 确认的种子竞品" })),
      clarification_answers: answers,
    });
  };
  return html`<div class="plan plan-gate">
    <div class="gate-head"><div><span class="gtag">GATE-0 · 研究范围与证据确认</span><h3>${draft.category_scope || "未命名研究"}</h3><div class="hint">这里的修改会写入本次研究计划。确认前不会执行模型或概念图任务。</div></div><span class="gate-mode">${isPrivateOnly ? "PRIVATE ONLY" : usesKeepaMore ? "PARTIAL VERIFIED" : "FRAMEWORK DEMO"}</span></div>

    ${usesKeepaMore
      ? html`<div class="gate-alert verified"><b>将执行 KeepaMore 真实数据采集</b><span>确认后拉取 Amazon US 前 100 个自然搜索商品、完整商品详情与所选窗口价格历史；评论正文、精确销量和内部成本仍保持缺失标记。</span></div>`
      : html`<div class="gate-alert critical"><b>当前不可形成商业决策</b><span>通用新建链路尚未接入实时市场采集，继续后只生成框架演示；不会把模板数据签核为 go / no-go。</span></div>`}
    ${isPrivateOnly ? html`<div class="gate-alert private"><b>仅私域已 fail-closed</b><span>当前没有可用的私域数据适配器。系统不会混入公共样例，也不会把简报发送给外部模型或 Lovart。</span></div>` : ""}

    <div class="gate-edit-grid">
      <label><span>研究品类 / 项目名</span><input value=${draft.category_scope || ""} onInput=${event => setDraft(plan => ({ ...plan, category_scope: event.target.value }))}/></label>
      <label><span>主分析站点</span><input value=${`Amazon ${run.marketplace}`} disabled/></label>
      <label><span>数据窗口（天）</span><input type="number" min="30" max="365" value=${draft.data_window_days || 90} onInput=${event => setDraft(plan => ({ ...plan, data_window_days: Number(event.target.value) || 90 }))}/></label>
      <label><span>目标价格带（USD）</span><div class="gate-range"><input type="number" placeholder="下限" value=${priceRange[0]} onInput=${event => updateBrief({ priceRange: [event.target.value === "" ? "" : Number(event.target.value), priceRange[1]] })}/><i>至</i><input type="number" placeholder="上限" value=${priceRange[1]} onInput=${event => updateBrief({ priceRange: [priceRange[0], event.target.value === "" ? "" : Number(event.target.value)] })}/></div></label>
      <label class="gate-wide"><span>种子竞品 ASIN（每行或逗号分隔）</span><textarea value=${seedText} onInput=${event => setSeedText(event.target.value)} placeholder="B0XXXXXXXX"></textarea></label>
    </div>

    <div class="gate-contract">
      <div><span>分析维度</span><b>${(draft.dimensions || []).length} 个</b><small>${(draft.dimensions || []).join(" · ") || "待定义"}</small></div>
      <div><span>请求数据源</span><b>${requestedSources.length || 0} 个</b><small>${requestedSources.join(" · ") || "未选择"} · 均需运行时验证</small></div>
      <div><span>交付状态</span><b>${usesKeepaMore ? "部分实证" : "不可签核"}</b><small>${usesKeepaMore ? "运行成功后交付 partial verified research，证据缺口继续显式保留" : "真实证据适配器接入前保持 insufficient evidence"}</small></div>
    </div>

    ${(draft.open_questions || []).length ? html`<div class="gate-questions"><h4>待确认问题</h4>${draft.open_questions.map((question, index) => html`<label key=${question}><span>${index + 1}. ${question}</span><textarea value=${answers[index] || ""} onInput=${event => setAnswers(value => ({ ...value, [index]: event.target.value }))} placeholder="填写本次研究采用的口径或答案"></textarea></label>`)}</div>` : ""}
    ${error ? html`<div class="err">${error}</div>` : ""}
    <label class="gate-ack"><input type="checkbox" checked=${acknowledged} onChange=${event => setAcknowledged(event.target.checked)}/><span>${usesKeepaMore ? "我已确认：KeepaMore 提供商品、价格、BSR、评分与评论数量等部分实证，不包含评论正文、精确销量或内部成本。" : "我已确认：当前通用链路仅生成框架演示，结果不能作为采购、备货或上市批准依据。"}</span></label>
    <div class="gate-actions">${isPrivateOnly ? html`<button class="btn ghost" onClick=${() => go("#/new")}>返回简报调整数据范围</button>` : html`<button class="btn lg" disabled=${!acknowledged || !String(draft.category_scope || "").trim()} onClick=${submit}>${usesKeepaMore ? "确认并执行真实数据研究 →" : "确认并生成框架演示 →"}</button>`}<span>${usesKeepaMore ? "运行时会校验 Key、套餐额度、站点和实际返回字段。" : "真实数据接入后，此处将升级为可审计的研究执行闸门。"}</span></div>
  </div>`;
}

function Progress({ run }) {
  return html`<div class="honest-progress">
    <span class="spin"></span><div><span class="gtag">TASK RUNNING</span><h2>${run.title}</h2><p>系统正在整理本次研究输出，完成时间取决于模型和上游服务响应。</p><div class="progress-boundary">当前运行环境只提供整体任务状态，不用动画模拟五个节点已经完成。刷新页面不会重复提交；失败后可回到 Gate-0 检查计划并重试。</div></div>
  </div>`;
}

render(html`<${App}/>`, document.getElementById("app"));
