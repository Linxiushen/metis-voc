import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const reportSource = readFileSync(new URL("../public/report10x.js", import.meta.url), "utf8");
const styleSource = readFileSync(new URL("../public/metis-gpt.css", import.meta.url), "utf8");

test("the canonical report leads with research until an actual concept image exists", () => {
  const experienceStart = reportSource.indexOf("function ReferenceReportExperience");
  const experienceEnd = reportSource.indexOf("export function ReportView", experienceStart);
  const experience = reportSource.slice(experienceStart, experienceEnd);

  assert.ok(experienceStart >= 0 && experienceEnd > experienceStart);
  assert.match(reportSource, /export function reportHasConceptImageAsset\(report\)/);
  assert.match(reportSource, /const candidates=\[board,product,\.\.\.suiteSources\.flatMap\(suite=>Array\.isArray\(suite\)\?suite:\[\]\)\]/);
  assert.match(reportSource, /return reportConceptImageAssets\(report\)\.length>0/);
  assert.match(reportSource, /const assets=remoteAssets\.length\?remoteAssets:baselineAssets/);
  assert.match(experience, /useState\(\{scope:visibilityScope,visible:false\}\)/);
  assert.doesNotMatch(experience, /useState\(\(\)=>reportHasConceptImageAsset\(report\)\)/);
  assert.match(experience, /conceptFirst=conceptVisibility\.scope===visibilityScope&&conceptVisibility\.visible/);
  assert.match(experience, /setConceptVisibility\(\{scope:visibilityScope,visible:false\}\)/);
  assert.match(experience, /if\(scope!==visibilityScope\)return/);
  assert.match(experience, /conceptFirst\?\[conceptDock,referenceDeck\]:\[referenceDeck,conceptDock\]/);
  assert.match(experience, /class=\$\{"reference-report-experience "\+\(conceptFirst\?"concept-first":"report-first"\)\}/);
  assert.match(experience, /const experienceKey=String\(props\.run\?\.id\|\|"report"\)/);
  assert.match(experience, /key=\$\{`concept-\$\{visibilityScope\}`\}/);
  assert.equal((experience.match(/<\$\{ConceptPanel\}/g) || []).length, 1, "one concept panel owns the single status request");
  assert.match(experience, /canManageConcept=\$\{props\.canManageConcept\}/);
  assert.match(reportSource, /const loadedAssets=presentedAssets\.filter\(asset=>imageStateOf\(asset\)==="loaded"\)/);
  assert.match(reportSource, /const hasVisibleConceptImage=loadedAssets\.length>0/);
  assert.match(reportSource, /onAssetVisibilityChange\?\.\(hasVisibleConceptImage,visibilityScope\)/);
  assert.match(reportSource, /onLoad=\$\{event=>onLoad\?\.\(asset\?\.url,event\)\}/);
  assert.match(reportSource, /onError=\$\{event=>onError\?\.\(asset\?\.url,event\)\}/);
  assert.match(reportSource, /!image\?\.isConnected\|\|image\.getAttribute\("src"\)!==url/);
  assert.match(reportSource, /currentTarget\?\.naturalWidth\|\|!event\?\.currentTarget\?\.naturalHeight/);
  assert.match(reportSource, /nextState="failed"/);
  assert.match(reportSource, /imageLoadRegistry\.scope===imageLoadScope\?imageLoadRegistry\.states:\{\}/);
  assert.match(reportSource, /图片加载失败/);
  assert.match(reportSource, /其他已成功加载的图片仍可正常查看/);
  assert.match(reportSource, /reportFirst\?"返回正式报告 ↑":"跳到正式报告 ↓"/);
  assert.match(reportSource, /const compactBlocked=reportFirst&&loaded&&!hasVisibleConceptImage/);
  assert.match(reportSource, /class="concept-panel concept-panel-compact"/);
  assert.match(styleSource, /\.concept-panel-compact\{display:flex/);
});

test("only remotely verifiable Lovart states keep polling", () => {
  assert.match(
    reportSource,
    /\["queued","generating","archiving","confirmation_unknown"\]\.includes\(value\?\.status\)/,
  );
  assert.doesNotMatch(
    reportSource,
    /\["queued","generating","submission_unknown","confirmation_unknown"\]\.includes\(value\?\.status\)/,
  );
  assert.match(reportSource, /报告基线已就绪/);
  assert.match(reportSource, /报告基线图/);
  assert.match(reportSource, /retry_after_seconds/);
  assert.match(reportSource, /Math\.min\(60000,Math\.max\(1000,Math\.ceil\(retrySeconds\*1000\)\)\)/);
  assert.match(reportSource, /archiving: \["存档中"/);
});

test("the interactive concept surface is excluded from the canonical PDF contract", () => {
  assert.match(
    styleSource,
    /body\[data-print-mode="reference"\] \.reference-concept-dock\{display:none!important\}/,
  );
});

test("stored Lovart assets can enter the report only through the explicit adoption workflow", () => {
  assert.match(reportSource, /concept\/adopt/);
  assert.match(reportSource, /confirm_adoption:true/);
  assert.match(reportSource, /expected_report_hash:await sha256Json\(report\)/);
  assert.match(reportSource, /!asset\.stored\|\|!asset\.sha256/);
  assert.match(reportSource, /run\?\.reviewed/);
  assert.match(reportSource, /采用为终审概念/);
  assert.match(styleSource, /\.concept-asset\.adopted/);
});

test("scene-suite assets render as one hero with ordered semantic views", () => {
  assert.match(reportSource, /const sceneSuite=brief\.scene_suite\|\|\{\}/);
  assert.match(reportSource, /asset\?\.role\|\|slot\?\.role/);
  assert.match(reportSource, /asset\?\.title\|\|slot\?\.title/);
  assert.match(reportSource, /sequence:Number\.isFinite\(candidateSequence\)/);
  assert.match(reportSource, /\.sort\(\(a,b\)=>a\.sequence-b\.sequence\)/);
  assert.match(reportSource, /concept-suite-hero/);
  assert.match(reportSource, /concept-suite-thumbs/);
  assert.match(reportSource, /sceneRoleLabel\(selectedAsset\.role\)/);
  assert.match(reportSource, /role="tablist" aria-label="场景套图视图"/);
});

test("the suite surface separates completeness, durable storage, and human consistency review", () => {
  assert.match(reportSource, /套图完整度/);
  assert.match(reportSource, /图片已返回/);
  assert.match(reportSource, /永久存档/);
  assert.match(reportSource, /一致性待人工审查/);
  assert.match(reportSource, /生成完成不等于工程定稿/);
  assert.match(reportSource, /suiteReady=hasSceneSuite[\s\S]+suiteArtifactIndices\.length>=expectedSuiteCount/);
  assert.match(styleSource, /\.concept-consistency-review/);
});

test("administrators can adopt the complete suite while legacy single-image adoption remains available", () => {
  const suiteStart = reportSource.indexOf("const adoptSuite=async");
  const panelStart = reportSource.indexOf("return html`<section", suiteStart);
  const suiteAdoption = reportSource.slice(suiteStart, panelStart);

  assert.ok(suiteStart >= 0 && panelStart > suiteStart);
  assert.match(suiteAdoption, /concept\/adopt/);
  assert.match(suiteAdoption, /confirm_adoption:true/);
  assert.match(suiteAdoption, /adopt_suite:true/);
  assert.match(suiteAdoption, /hero_artifact_index:heroArtifactIndex/);
  assert.match(suiteAdoption, /artifact_indices:suiteArtifactIndices/);
  assert.match(suiteAdoption, /expected_report_hash:await sha256Json\(report\)/);
  assert.match(reportSource, /"采用整套"/);
  assert.match(reportSource, /"仅采用此图"/);
  assert.match(reportSource, /:presentedAssets\.length\?html`<div class="concept-gallery">/);
  assert.match(styleSource, /\.concept-adopt-suite/);
});

test("the scene-suite layout remains bounded on desktop and mobile", () => {
  assert.match(styleSource, /\.concept-suite-layout\{[\s\S]+grid-template-columns:minmax\(0,1fr\) 270px/);
  assert.match(styleSource, /\.concept-suite-hero\{[\s\S]+aspect-ratio:16\/10/);
  assert.match(styleSource, /@media\(max-width:820px\)\{[\s\S]+\.concept-suite-layout\{grid-template-columns:1fr\}/);
  assert.match(styleSource, /@media\(max-width:420px\)\{[\s\S]+\.concept-suite-thumbs\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
  assert.match(styleSource, /overflow-wrap:anywhere/);
});

test("paid Lovart continuation resubmits the quote snapshot and explicit consent", () => {
  assert.match(reportSource, /kind==="confirm"[\s\S]+confirm_generation:true/);
  assert.match(reportSource, /expected_concept_updated_at:concept\?\.updated_at/);
  assert.match(reportSource, /expected_estimated_cost:cost\?\?null/);
  assert.match(reportSource, /confirm_unknown_cost:cost==null/);
});

test("failed or uncertain concept status has an explicit read-only retry path", () => {
  const retryStart = reportSource.indexOf("const retryConceptStatus=()=>");
  const retryEnd = reportSource.indexOf("const act=async", retryStart);
  const retrySource = reportSource.slice(retryStart, retryEnd);

  assert.ok(retryStart >= 0 && retryEnd > retryStart);
  assert.match(retrySource, /setLoaded\(false\)/);
  assert.match(retrySource, /setPollKey\(value=>value\+1\)/);
  assert.doesNotMatch(retrySource, /method:"POST"|concept\/start|concept\/confirm/);
  assert.match(reportSource, /statusNeedsManualRetry=statusKey==="load_failed"\|\|concept\?\.status==="submission_unknown"/);
  assert.match(reportSource, /重新核验状态/);
  assert.match(reportSource, /不会重复提交或扣费/);
});

test("evidence and infrastructure blockers render as stable non-billable states", () => {
  assert.match(reportSource, /blocked:\s*\["证据暂未放行"/);
  assert.match(reportSource, /unavailable:\s*\["能力待开通"/);
  assert.match(reportSource, /generationAvailable=concept\?\.generation_available!==false/);
  assert.match(reportSource, /generationBlockReason=concept\?\.blocked_reason/);
  assert.match(reportSource, /\["blocked","unavailable"\]\.includes\(concept\?\.status\)/);
});

test("scene selection and image preview expose complete keyboard and dialog semantics", () => {
  assert.match(reportSource, /role="tablist" aria-label="场景套图视图" aria-orientation="horizontal"/);
  assert.match(reportSource, /tabIndex=\$\{isSelected\?0:-1\}/);
  assert.match(reportSource, /\["ArrowLeft","ArrowRight","Home","End"\]/);
  assert.match(reportSource, /onKeyDown=\$\{event=>onSceneThumbKeyDown\(event,index\)\}/);
  assert.match(reportSource, /role="tabpanel" aria-labelledby=/);
  assert.match(reportSource, /role="dialog" aria-modal="true" aria-label="产品概念图大图预览"/);
  assert.match(reportSource, /event\.key==="Escape"/);
  assert.match(reportSource, /aria-label="关闭大图预览" autoFocus/);
});
