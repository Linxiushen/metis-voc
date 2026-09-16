import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [source, appSource] = await Promise.all([
  readFile(new URL("../public/brief.js", import.meta.url), "utf8"),
  readFile(new URL("../public/app.js", import.meta.url), "utf8"),
]);

test("KeepaMore is available in settings and every brief persistence path", () => {
  assert.match(appSource, /\["keepamore_api_key","KeepaMore API Key","免费版不含 API · 套餐 Key 用于价格\/BSR\/评分历史"\]/);
  assert.match(source, /\["keepamore","KeepaMore"\]/);
  assert.match(source, /keepamore:false/);
  assert.match(source, /fromDraft\(saved,"sources",\{\}\)/);
  assert.match(source, /SOURCE_OPTIONS\.forEach\(\(\[k,l\]\)=>/);
  assert.match(source, /SOURCE_OPTIONS\.forEach\(\(\[k\]\)=>/);
  assert.match(source, /SOURCE_OPTIONS\.map\(\(\[k,l\]\)=>/);
  assert.match(source, /sources,win,gate,strict,scope/);
});

test("Gate-0 distinguishes KeepaMore evidence runs from framework demos", () => {
  assert.match(appSource, /const usesKeepaMore = !isPrivateOnly && requestedSources\.includes\("KEEPAMORE"\)/);
  assert.match(appSource, /PARTIAL VERIFIED/);
  assert.match(appSource, /确认并执行真实数据研究/);
  assert.match(appSource, /前 100 个自然搜索商品、完整商品详情与所选窗口价格历史/);
  assert.match(appSource, /不包含评论正文、精确销量或内部成本/);
});

test("brief feedback is inline and destructive draft clearing is cancellable", () => {
  assert.doesNotMatch(source, /\b(?:alert|confirm)\s*\(/);
  assert.match(source, /brief-io-feedback/);
  assert.match(source, /ioFeedback\.tone==="error"\?"alert":"status"/);
  assert.match(source, /clearDraftPending\?html`[\s\S]*确认清空[\s\S]*取消/);
  assert.match(source, /event\.key==="Escape"[\s\S]*cancelClearDraft\(\)/);
  assert.match(source, /returnClearDraftFocusRef/);
  assert.match(source, /clearDraftPending\?clearDraftConfirmRef\.current:clearDraftTriggerRef\.current/);
  assert.doesNotMatch(source, /class=\$\{"brief-readiness"[^\n]*role="status"/);
  assert.match(source, /class="sr-only" role="status" aria-live="polite" aria-atomic="true"/);
});

test("brief sections expose persisted native disclosure state", () => {
  assert.match(source, /<details class="briefsec"/);
  assert.match(source, /<summary class="bshead"[\s\S]*aria-expanded=\$\{expanded\}[\s\S]*aria-controls=\$\{bodyId\}/);
  assert.match(source, /role="region" aria-labelledby=\$\{headingId\}/);
  assert.match(source, /class="briefsec-meta"[\s\S]*\$\{track\}[\s\S]*briefsec-status \$\{tone\}[\s\S]*\$\{status\}/);
  assert.match(source, /track:"高级可选",status:"可选",tone:"optional"/);
  assert.match(source, /track:"启动必填"[\s\S]*status:missing\?`\$\{missing\}项待补`:"已完成"/);
  assert.match(source, /openSteps:Array\.from\(openSteps\)\.sort\(\)/);
  assert.match(source, /addEventListener\("beforeunload",onBeforeUnload\)/);
});

test("brief opens the first blocker unless a draft already owns disclosure state", () => {
  assert.match(source, /Array\.isArray\(saved\?\.openSteps\)[\s\S]*saved\.openSteps\.map\(String\)/);
  assert.match(source, /if\(Array\.isArray\(savedEnvelope\?\.values\?\.openSteps\)\)return;/);
  assert.match(source, /const firstBlockingStep=readiness\.blockers\[0\]\?\.step\|\|"3";/);
  assert.match(source, /setOpenSteps\(new Set\(\[String\(firstBlockingStep\)\]\)\)/);
});

test("delivery capability is explicit and reacts to scope and requested sources", () => {
  assert.match(source, /const deliveryCapability=scope==="private_only"/);
  assert.match(source, /level:requestedSourceCount\?"私域证据计划（待校验）":"框架演示"/);
  assert.match(source, /level:"证据增强计划（待校验）"/);
  assert.match(source, /<span>本次可交付等级<\/span><b>\$\{deliveryCapability\.level\}<\/b>/);
  assert.match(source, /请求来源：\$\{requestedSourceLabels\.length\?requestedSourceLabels\.join\("、"\):"未选择"\}/);
});

test("visible step language is business-facing Chinese", () => {
  for (const phrase of [
    "卖家画像 Seller Profile",
    "研究目标 Research Goals",
    "品类与范围 Category & Scope",
    "数据与方法 Data & Methods",
    "机会分权重自定义 Opportunity Weights",
    "交付偏好 Delivery",
    "opportunity-scoring.yaml",
    "需求 demand",
    "变现 monetization",
  ]) assert.doesNotMatch(source, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(source, /企业能力画像/);
  assert.match(source, /市场需求/);
  assert.match(source, /机构白标版/);
});

test("KeepaMore free import is an isolated cat-bed sample, not a generic capability", () => {
  assert.match(source, /const KEEPAMORE_CAT_BED_SAMPLE = \{category:"cat bed",marketplace:"US",currency:"USD"\}/);
  assert.match(source, /fd\.append\("category",KEEPAMORE_CAT_BED_SAMPLE\.category\)/);
  assert.match(source, /fd\.append\("marketplace",KEEPAMORE_CAT_BED_SAMPLE\.marketplace\)/);
  assert.doesNotMatch(source, /kw\.trim\(\)\|\|"cat bed"/);
  assert.match(source, /导入猫窝示例数据/);
  assert.match(source, /不代表其他品类或站点已经接入数据/);
});

test("brief validation expands a blocked section and focuses its real field", () => {
  assert.match(source, /scrollToStep=\(step,fieldId=""\)/);
  assert.match(source, /element\.open=true/);
  assert.match(source, /querySelector\(`\[data-brief-field=/);
  assert.match(source, /focus\(\{preventScroll:true\}\)/);
  assert.match(source, /setRevealedIssues\(new Set\(readiness\.blockers\.map\(item=>item\.id\)\)\)/);
  assert.match(source, /aria-invalid=\$\{issueVisible\("subject"\)\}/);
  assert.match(source, /aria-describedby=\$\{issueVisible\("subject"\)\?issueId\("subject"\):undefined\}/);
});

test("readiness navigation respects motion preferences and always transfers focus", () => {
  assert.match(source, /matchMedia\?\.\("\(prefers-reduced-motion: reduce\)"\)/);
  assert.match(source, /const field=fieldId\?element\.querySelector/);
  assert.match(source, /focusTarget\|\|element\.querySelector\("summary"\)/);
  assert.match(source, /invalid&&i===0&&columnIndex===0\?describedBy/);
  assert.match(source, /class="btn brief-rail-submit"/);
});

test("brief submission and file IO reject duplicate actions while pending", () => {
  assert.match(source, /if\(submitInFlightRef\.current\)return;/);
  assert.match(source, /submitInFlightRef\.current=true;\s*setBusy\(true\)/);
  assert.match(source, /submitInFlightRef\.current=false;\s*setSubmitError/);
  assert.match(source, /disabled=\$\{busy\} aria-busy=\$\{busy\}/);
  assert.match(source, /if\(ioInFlightRef\.current\)return;/);
  assert.match(source, /disabled=\$\{!!ioBusy\} aria-busy=/);
});

test("pill removal and advanced disclosure remain keyboard and screen-reader operable", () => {
  assert.doesNotMatch(source, /<b(?:\s|>)[^>]*onClick/);
  assert.match(source, /<button type="button" aria-label=\$\{`移除\$\{accessibleLabel\}：\$\{v\}`\}/);
  assert.match(source, /aria-expanded=\$\{advOpen\} aria-controls="brief-advanced-panel"/);
  assert.match(source, /id="brief-advanced-panel" role="region" aria-label="高级自定义"/);
});
