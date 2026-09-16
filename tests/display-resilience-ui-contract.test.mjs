import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const briefView = readFileSync(new URL("../public/brief.js", import.meta.url), "utf8");
const deck = readFileSync(new URL("../public/reference-deck.js", import.meta.url), "utf8");
const reportView = readFileSync(new URL("../public/report10x.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/metis-gpt.css", import.meta.url), "utf8");
const headers = readFileSync(new URL("../public/_headers", import.meta.url), "utf8");
const indexHtml = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const nextPage = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("auth and workspace roots cannot reuse read-progress dimensions", () => {
  assert.match(app, /key="login" mode="login"/);
  assert.match(app, /key="register" mode="register"/);
  assert.match(app, /key="auth-root" class="auth-route"/);
  assert.match(app, /key="workspace-root" class=/);
  assert.match(app, /style\.removeProperty\("width"\)/);
  assert.match(app, /\}, \[chrome\]\);/);
  assert.match(css, /\.auth-route>\.wrap\{width:100%!important\}/);
});

test("fixed dialogs remain viewport-bound and account tables stay reachable", () => {
  assert.match(css, /\.main \.wrap\{[^}]*animation:none/);
  assert.match(css, /\.account-dialog\{[^}]*padding:0/);
  assert.match(css, /\.toasts\{z-index:1400\}/);
  assert.match(css, /\.account-directory,\.credit-rules-section,\.personal-ledger-section\{[\s\S]*?background:transparent/);
  assert.match(css, /\.account-table\{overflow-x:auto/);
  assert.match(css, /@media\(max-width:1360px\)\{[\s\S]*?\.account-table-head/);
  assert.match(css, /@media\(max-width:1180px\)\{[\s\S]*?\.archive-restore-table/);
});

test("dark workspace states cannot inherit the retired light theme", () => {
  assert.match(css, /\.dashboard-page \.empty\{[\s\S]*?background:#252524/);
  assert.match(css, /\.dashboard-page \.empty>b\{color:#deded8\}/);
  assert.match(css, /\.settings-page\{max-width:960px\}/);
  assert.match(css, /\.provider-grid\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /\.provider-panel\.formcard\{[^}]*border:0[^}]*background:transparent[^}]*box-shadow:none/);
  assert.match(css, /\.chip2\{border-color:#4b4b46;background:#2d2d2b;color:#c9c9c2;box-shadow:none\}/);
  assert.match(css, /\.chip2:hover\{border-color:#66665f;background:#373735;color:#f0f0ea\}/);
  assert.match(css, /\.bio-btn,\.chip2\.on\{border-color:#e0e0d9;background:#e5e5df;color:#1c1c1b;box-shadow:none\}/);
});

test("workspace choices, loading states, and report actions expose clear hierarchy", () => {
  assert.match(app, /research-mode-picker" role="group" aria-label="研究模式"/);
  assert.match(app, /aria-pressed=\$\{researchMode === "board"\}/);
  assert.match(app, /runs === null \? html`<div class="research-list research-list-loading"/);
  assert.match(app, /class="ab-back"[\s\S]{0,160}返回研究档案/);
  assert.match(app, /1 · 选择决策/);
  assert.match(app, /2 · 发起终审/);
  assert.match(app, /正在执行/);
  assert.doesNotMatch(app, />In progress</);
  assert.match(css, /\.research-mode-picker\{[\s\S]*?gap:1px[\s\S]*?border:1px solid #3d3d39/);
  assert.match(css, /\.settings-actions\{display:flex/);
});

test("baseline concepts keep the visual, conclusion, price, and next action in one decision view", () => {
  assert.match(reportView, /baselineFirstView=hasBaseline&&remoteAssets\.length===0&&!suiteReady/);
  assert.match(reportView, /class="concept-first-view"/);
  assert.match(reportView, /<span>研究结论<\/span>/);
  assert.match(reportView, /<span>目标售价<\/span>/);
  assert.match(reportView, /跳到正式报告/);
  assert.match(css, /\.concept-first-view\{[\s\S]*?grid-template-columns:minmax\(0,3fr\) minmax\(320px,2fr\)/);
  assert.match(css, /@media\(max-width:820px\)\{[\s\S]*?\.concept-first-view\{grid-template-columns:1fr\}/);
});

test("partial evidence reports use complete hero summary labels", () => {
  assert.match(reportView, /const referenceSummary=Number\.isFinite\(referenceModuleCount\)/);
  assert.match(reportView, /:"部分实证研究"/);
  assert.match(reportView, /:"AIGC 待补证解锁"/);
  assert.doesNotMatch(reportView, /report\.reference_framework_modules\|\|"完整"/);
  assert.doesNotMatch(reportView, /report\.aigc_modules\|\|"AIGC"/);
});

test("the long research brief is split into keyboard-native expandable steps", () => {
  assert.match(briefView, /<details class="briefsec"/);
  assert.match(briefView, /<summary class="bshead"/);
  assert.match(briefView, /const \[openSteps,setOpenSteps\]=useState\(\(\)=>new Set\(/);
  assert.match(briefView, /const firstBlockingStep=readiness\.blockers\[0\]\?\.step\|\|"3"/);
  assert.match(briefView, /setOpenSteps\(new Set\(\[String\(firstBlockingStep\)\]\)\)/);
  assert.match(briefView, /element\.open=true;[\s\S]*?setOpenSteps/);
  for (const step of ["1", "2", "3", "4", "5", "6", "7"]) {
    assert.match(briefView, new RegExp(`openSteps\\.has\\("${step}"\\)`));
  }
  assert.match(css, /\.briefsec>.bshead\{[\s\S]*?cursor:pointer;list-style:none/);
  assert.match(css, /\.briefsec-body\{padding:0 0 24px\}/);
});

test("dynamic navigation and filtered rows retain stable browser semantics", () => {
  assert.match(app, /<a href="#\/runs" class=/);
  assert.match(app, /const researchRouteActive = route\.startsWith\("#\/runs"\) \|\| route\.startsWith\("#\/run\/"\)/);
  assert.match(app, /aria-current=\$\{researchRouteCurrent\}/);
  assert.match(app, /class="sb-runs" aria-label="最近研究"/);
  assert.match(app, /aria-current=\$\{route==="#\/run\/"\+r\.id\?"page":undefined\}/);
  assert.match(app, /class="sb-logout l"[\s\S]{0,100}aria-label="退出登录"/);
  assert.match(app, /filtered\.map\(r => \{ const ui = deriveRunUiState\(r\); return html`<button class="archive-row" key=\$\{r\.id\}/);
  assert.match(app, /runs\.map\(\(run\) => html`<div class="archive-row archive-row-static" key=\$\{run\.id\}/);
  assert.match(app, /providers\?\.providers\|\|\[\]\)\.map\(p => \{[\s\S]{0,900}key=\$\{p\.id\}/);
});

test("research state, evidence, decision, and next action share one display model", () => {
  assert.match(app, /const deriveRunUiState = \(run\) =>/);
  assert.match(app, /return \{ stage, evidence, decision, nextAction, reviewReady, signed \}/);
  assert.match(app, /class="research-statuses"/);
  assert.match(app, /\u7814\u7a76\u9636\u6bb5<\/span><span>\u8bc1\u636e\u7b49\u7ea7<\/span><span>\u51b3\u7b56\u8fdb\u5c55/);
  assert.match(app, /\u5df2\u52a0\u8f7d \$\{\(runs \|\| \[\]\)\.length\} \u6761 \u00b7 \u5f53\u524d\u663e\u793a/);
  assert.match(css, /\.research-statuses\{display:flex/);
  assert.match(css, /@media screen and \(max-width:680px\)\{[\s\S]*?\.research-statuses\{grid-column:1/);
});

test("dense workspace states stay readable from desktop rails through mobile", () => {
  assert.match(css, /\.signal-grid\.signal-grid-five\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
  assert.match(css, /\.signal-grid\.signal-grid-five>div:last-child\{grid-column:1\/-1\}/);
  assert.match(css, /@media screen and \(max-width:1180px\) and \(min-width:681px\)\{[\s\S]*?\.research-row\{grid-template-columns:30px minmax\(0,1fr\) minmax\(126px,auto\)/);
  assert.match(css, /@media screen and \(max-width:1100px\)\{[\s\S]*?\.newwrap\{display:block/);
  assert.match(css, /\.newwrap>\.brief-readiness \.brief-checks\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
  assert.match(css, /\.newwrap>\.brief-readiness \.brief-checks button b,[\s\S]*?white-space:normal/);
  assert.match(css, /\.command-flow span:nth-child\(n\+4\)\{display:block\}/);
  assert.doesNotMatch(css, /\.command-flow span:nth-child\(n\+4\)\{display:none\}/);
  assert.match(css, /\.weightrow\{display:grid;grid-template-columns:minmax\(88px,1fr\) minmax\(0,1\.4fr\) 40px/);
});

test("settings and account routes distinguish configuration, health, and capability", () => {
  assert.match(app, /api\("\/health"\)\.then\(setHealth\)/);
  assert.match(app, /\u51ed\u636e\uff1a\$\{p\.configured \? "\u5df2\u914d\u7f6e" : "\u672a\u914d\u7f6e"\}/);
  assert.match(app, /\u8fd0\u884c\u5065\u5eb7\uff1a\u5c1a\u672a\u6d4b\u8bd5/);
  assert.match(app, /function AccountSecurity\(\)/);
  assert.match(app, /effectiveRoute\.startsWith\("#\/account"\).*AccountSecurity/);
  assert.match(app, /href="#\/account"/);
  assert.match(css, /\.settings-capabilities\{/);
  assert.match(css, /\.account-password-form\{/);
});

test("a polling interruption is not presented as a failed research run", () => {
  assert.match(app, /setPhase\("sync_error"\)/);
  assert.match(app, /phase === "sync_error"[\s\S]*?\u7814\u7a76\u4ecd\u5728\u540e\u53f0\u6267\u884c/);
  assert.match(app, /\u8fd9\u4e0d\u4ee3\u8868\u4efb\u52a1\u5931\u8d25/);
  assert.match(css, /\.run-sync-warning\{/);
});

test("core workspace interactions expose feedback, recovery, and keyboard paths", () => {
  assert.match(app, /function useDialogFocus\(/);
  assert.match(app, /event\.key !== "Tab"/);
  assert.match(app, /class="pal" role="dialog" aria-modal="true"/);
  assert.match(app, /<button type="button" class="pal-item"/);
  assert.match(app, /ArrowDown/);
  assert.match(app, /function NetworkStatus\(\)/);
  assert.match(app, /network-status/);
  assert.match(app, /class="skip-link" href="#main-content"/);
  assert.match(app, /id="main-content" class="main" tabindex="-1"/);
  assert.match(app, /<main id="main-content" tabindex="-1" key="auth-root" class="auth-route"/);
  assert.match(app, /runNextActionLabel/);
  assert.match(app, /class="research-next"/);
  assert.match(app, /class="archive-next"/);
  assert.match(app, /class="auth-switch"/);
  assert.match(app, /class="mobile-more-toggle" type="button" aria-expanded=\$\{mobileMenuOpen\} aria-controls="mobile-account-panel"/);
  assert.match(app, /id="mobile-account-panel" role="group" aria-label="账户菜单"/);
  assert.match(app, /matchMedia\("\(max-width: 820px\)"\)/);
  assert.match(app, /focusWasInMobileMenu[\s\S]{0,260}document\.getElementById\("main-content"\)\?\.focus/);
  assert.doesNotMatch(app, /<summary[^>]*打开账户菜单/);
  assert.match(app, /toast\(err\.message \|\| "研究创建失败，请稍后重试", "err"\)/);
  assert.match(app, /phase !== "report"[\s\S]{0,180}window\.scrollTo\(\{ top: 0, behavior: "auto" \}\)/);
  assert.doesNotMatch(app, /class="pal-item"[^>]*><div/);
  assert.match(css, /\.command-flow\{[\s\S]*?position:static/);
  assert.match(css, /\.pal-item\{[\s\S]*?min-height:44px/);
  assert.match(css, /\.research-next,\.archive-next/);
  assert.match(css, /\.block-head>a\{display:inline-flex;min-height:44px/);
  assert.match(css, /\.mobile-brand\{min-height:44px\}/);
  assert.match(css, /@media screen and \(max-width:820px\)\{[\s\S]*?\.mobile-brand\{min-width:44px;min-height:44px\}/);
  assert.match(css, /\.review-head>button,\.account-dialog-head>button\{\s*width:44px;height:44px/);
  assert.match(css, /\.account-pagehead>\.btn,\.account-actions button,\.account-self,\.credit-rule-save,[\s\S]{0,180}min-height:44px/);
  assert.match(css, /\.review-actions \.ab-btn\{min-height:44px\}/);
  assert.match(css, /\.bio-btn,\.exchip,\.chip2,\.mktbtn,\.bsbtn,\.seg button,\.etadd,\.brief-draft-state button\{min-height:44px\}/);
  assert.match(css, /@media screen and \(max-width:480px\)\{\s*\.research-mode-picker\{grid-template-columns:1fr\}/);
  assert.doesNotMatch(css, /\.brief-checks button\.is-ready\{display:none\}/);
});

test("reference reports use one responsive data model with a readable mobile page", () => {
  assert.match(app, /run-report reference-run/);
  assert.match(css, /\.reference-run>\.actionbar\{position:static;top:auto\}/);
  assert.match(deck, /mobileDetailsOpen/);
  assert.match(deck, /function MobileReferencePage\(\{ report, run, page \}\)/);
  assert.match(deck, /<\$\{MobileReferencePage\} report=\$\{report\} run=\$\{run\} page=\$\{activePage\}/);
  assert.doesNotMatch(deck, /mobileZoom|fitMobile|new ResizeObserver/);
  assert.match(css, /\.ref-deck\.mobile-open\{display:flex\}/);
  assert.match(css, /@media\(max-width:760px\)\{[\s\S]*?\.ref-page-viewport\{display:none\}[\s\S]*?\.ref-mobile-page-reader\{display:block/);
  assert.match(css, /\.ref-mobile-page-reader\{[^}]*font-size:13px/);
  assert.match(css, /\.ref-mobile-table dt\{[^}]*font-size:12px/);
  assert.match(css, /\.ref-mobile-table dd\{[^}]*font-size:13px/);
  assert.match(css, /\.ref-mobile-decision-gates\{[^}]*background:#2a2b29!important/);
  assert.match(css, /\.ref-mobile-artifact\{[^}]*background:transparent!important/);
  assert.match(css, /body\[data-print-mode="reference"\] \.ref-mobile-page-reader\{display:none!important\}/);
  assert.match(css, /body\[data-print-preparing="true"\] \.ref-mobile-page-reader\{display:none!important\}/);
  assert.match(css, /@media screen and \(max-width:840px\)\{[\s\S]*?\.report-layout\{grid-template-columns:minmax\(0,1fr\)!important\}/);
  assert.match(css, /@media\(max-width:1180px\)\{\s*\.ref-deck\{[\s\S]*?\.ref-deck-toolbar nav\{[^}]*display:grid/);
  assert.match(css, /body\[data-print-mode="reference"\] \.ref-cell-text\{[\s\S]*?-webkit-line-clamp:unset!important/);
  assert.match(deck, /const \[viewMode, setViewMode\] = useState\("reader"\)/);
  assert.match(deck, /报告显示方式[\s\S]*?>阅读<[\s\S]*?>版式预览</);
  assert.match(deck, /class=\$\{"ref-deck reading-" \+ readingMode \+ " view-" \+ viewMode/);
  assert.match(css, /@media screen and \(max-width:1024px\)\{[\s\S]*?\.ref-deck \.ref-page-viewport\{display:none!important\}[\s\S]*?\.ref-deck \.ref-mobile-page-reader\{display:block!important/);
  assert.match(css, /@media screen and \(max-width:480px\)\{[\s\S]*?\.ref-mobile-page-nav\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)[\s\S]*?\.ref-mobile-page-nav output\{grid-column:1\/-1;grid-row:1\}/);
  assert.match(css, /@media screen and \(max-width:360px\)\{[\s\S]*?\.ref-mobile-page-nav\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /@media screen and \(max-width:680px\)\{[\s\S]*?\.ab-run-title small,\.ab-state-summary>span\{font-size:12px\}[\s\S]*?\.concept-panel-compact p\{font-size:12\.5px\}/);
  assert.match(css, /body\[data-print-preparing="true"\] \.ref-deck\{[\s\S]*?display:block!important/);
  assert.match(deck, /class="sr-only" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(deck, /class="ref-mobile-page-reader"[^>]*tabindex="-1"[^>]*onKeyDown=\$\{handleReaderKeyDown\}/);
  assert.match(deck, /class="ref-page-viewport"[^>]*tabindex="0"[^>]*onKeyDown=\$\{handleReaderKeyDown\}/);
  assert.doesNotMatch(deck, /window\.addEventListener\("keydown"/);
  assert.doesNotMatch(deck, /<main class=\$\{"ref-sheet-main/);
  assert.match(deck, /class="ref-mobile-evidence-contracts" aria-label="执行摘要来源与证据合同"/);
  assert.match(deck, /artifact\.kind === "concept-compare"[\s\S]*?artifact\.note \? html`<p class="ref-mobile-note-text"/);
  assert.match(deck, /value\.xLabel \|\| humanize\(key\)/);
  assert.match(deck, /value\.yLabel \|\| humanize\(key\)/);
  assert.match(deck, /共 \$\{rows\.length\} 条 · 已全部显示/);
});

test("long provider messages wrap instead of being clipped", () => {
  assert.match(css, /\.concept-errorline,\.concept-notice\{overflow-wrap:anywhere;word-break:break-word\}/);
});

test("small Lovart labels retain readable contrast on dark surfaces", () => {
  assert.match(css, /\.concept-state small\{color:#9a9a94/);
  assert.match(css, /\.concept-suite-thumb-copy small\{[^}]*color:#9a9a94/);
  assert.match(css, /\.concept-suite-review-head span\{color:#9a9a94/);
  assert.match(css, /\.concept-suite-boundary\{[^}]*color:#9a9a94/);
  assert.match(css, /\.concept-confirm p\{[^}]*color:#b9aa92/);
});

test("screen readability uses semantic text roles for faint workspace states", () => {
  for (const variable of [
    "--text-secondary",
    "--text-tertiary",
    "--text-placeholder",
    "--text-disabled",
  ]) {
    assert.match(css, new RegExp(`${variable}:[^;]+;`));
  }

  assert.match(css, /input::placeholder,\s*textarea::placeholder\{color:var\(--text-placeholder\)\}/);
  assert.match(css, /\.btn:disabled[^{]*\{[^}]*color:var\(--text-disabled\)/);
  assert.match(css, /\.ref-deck-toolbar button:disabled\{[^}]*color:var\(--text-disabled\)/);

  const readabilityPassStart = css.indexOf("@media screen{");
  assert.ok(readabilityPassStart >= 0, "missing unified screen readability pass");
  const readabilityPass = css.slice(readabilityPassStart);
  assert.match(readabilityPass, /\.sb-workspace[\s\S]*\.workspace-overline[\s\S]*\.command-flow span[\s\S]*\.signal-grid small/);
  assert.match(readabilityPass, /color:var\(--text-tertiary\)/);
  assert.match(readabilityPass, /\.sb-brandcopy small[\s\S]*\.archive-head[\s\S]*\.account-table-head[\s\S]*font-size:10px/);
  assert.match(readabilityPass, /\.sb-collapse,\.quiet-action kbd,\.metric-row span,\.account-search>span,\.account-self\{\s*color:var\(--text-secondary\)/);
  assert.match(readabilityPass, /\.command-status>b[\s\S]*\.signal-grid small[\s\S]*\.research-title small[\s\S]*font-size:10px/);
  assert.match(readabilityPass, /\.ref-cover-review-meta\.pending\{color:#745f4e;font-size:10px\}/);
});

test("desktop reference reports preserve vertical navigation at common widths and scale by width only", () => {
  assert.match(css, /@media\(max-width:1180px\)\{[\s\S]*?\.ref-deck\{grid-template-columns:minmax\(0,1fr\)/);
  assert.doesNotMatch(css, /@media\(max-width:1600px\)\{\s*\.ref-deck/);
  assert.match(deck, /useState\("curated"\)/);
  assert.match(css, /\.ref-deck-toolbar nav\{display:grid;grid-template-columns:34px minmax\(180px,1fr\) 34px auto auto/);
  assert.match(css, /\.ref-deck-toolbar \.ref-print\{grid-column:auto;width:auto\}/);

  const pageStackStart = css.indexOf(".ref-page-stack{");
  const pageStackEnd = css.indexOf("}", pageStackStart);
  assert.ok(pageStackStart >= 0 && pageStackEnd > pageStackStart, "missing .ref-page-stack rule");
  const pageStackRule = css.slice(pageStackStart, pageStackEnd + 1);
  assert.match(pageStackRule, /zoom:min\(1,calc\(100cqw\s*\/\s*1120px\)\)/);
  assert.doesNotMatch(pageStackRule, /100d?vh|792px/);
  assert.match(css, /@media screen and \(min-width:761px\)\{[\s\S]*?\.ref-page-stack\{zoom:max\(\.82,min\(1,calc\(100cqw \/ 1120px\)\)\)\}/);
  assert.match(css, /body:has\(\.reference-report-root\) \.sidebar\{display:none\}/);
  assert.match(css, /body:has\(\.reference-report-root\) \.main\{margin-left:0\}/);
  assert.match(deck, /title=\$\{label\}[\s\S]*?<b>\$\{label\}<\/b>/);
});

test("theme styles are revalidated and versioned on both entry points", () => {
  for (const path of ["/styles.css", "/metis-next.css", "/metis-gpt.css"]) {
    const offset = headers.indexOf(path);
    assert.ok(offset >= 0);
    assert.match(headers.slice(offset, offset + 110), /max-age=0, must-revalidate/);
  }
  assert.match(indexHtml, /metis-gpt\.css\?v=20260825-display5/);
  assert.match(nextPage, /metis-gpt\.css\?v=20260825-display5/);
  assert.match(indexHtml, /bundle\/metis-app\.js\?v=20260825-display5/);
  assert.match(nextPage, /bundle\/metis-app\.js\?v=20260825-display5/);
});
