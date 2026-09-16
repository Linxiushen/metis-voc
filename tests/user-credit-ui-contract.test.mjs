import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const cssSource = readFileSync(new URL("../public/metis-gpt.css", import.meta.url), "utf8");

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `missing source contract: ${startMarker}`);
  return source.slice(start, end);
}

const creditsSource = sourceBetween(appSource, "// ---------------- Accounts and credits", "// ---------------- Report action bar");

test("administrators receive a complete user and credit management surface", () => {
  for (const contract of [
    /api\(`\/admin\/users\?\$\{params\}`\)/,
    /api\("\/admin\/users", \{ method: "POST"/,
    /api\(`\/admin\/users\/\$\{user\.id\}`, \{ method: "PATCH"/,
    /api\(`\/admin\/users\/\$\{creditUser\.id\}\/credits`/,
    /api\(`\/admin\/users\/\$\{user\.id\}\/credit-ledger\?\$\{params\}`\)/,
    /api\(`\/admin\/users\/\$\{passwordUser\.id\}\/password`, \{ method: "PUT"/,
  ]) assert.match(creditsSource, contract);

  assert.match(creditsSource, /idempotency_key: crypto\.randomUUID\(\)/);
  assert.match(creditsSource, /当前所有登录会话都会被撤销/);
});

test("credit pricing rules are editable but explicitly default to no production impact", () => {
  assert.match(creditsSource, /api\("\/admin\/credit-rules"\)/);
  assert.match(creditsSource, /api\(`\/admin\/credit-rules\/\$\{encodeURIComponent\(rule\.key\)\}`/);
  assert.match(creditsSource, /research_generation/);
  assert.match(creditsSource, /scene_suite_generation/);
  assert.match(creditsSource, /默认关闭与 0 积分不会影响现网/);
});

test("members only receive their personal credit route while admin links stay role-gated", () => {
  assert.match(creditsSource, /api\("\/credits\/me"\)/);
  assert.match(creditsSource, /api\("\/health"\)/);
  assert.match(creditsSource, /account\.rules \|\| \[\]/);
  assert.match(creditsSource, /\u5f53\u524d\u4f59\u989d\u53ef\u6267\u884c/);
  assert.match(appSource, /store\.user\?\.role === "admin"[\s\S]{0,280}#\/admin\/users[\s\S]{0,240}#\/credits/);
  assert.match(appSource, /effectiveRoute\.startsWith\("#\/admin\/users"\)[\s\S]{0,220}store\.user\?\.role === "admin"/);
  assert.match(appSource, /effectiveRoute\.startsWith\("#\/credits"\).*PersonalCredits/);
});

test("every signed-in user has an account security route", () => {
  assert.match(appSource, /function AccountSecurity\(\)/);
  assert.match(appSource, /api\("\/account\/password"/);
  assert.match(appSource, /href="#\/account"/);
  assert.match(appSource, /effectiveRoute\.startsWith\("#\/account"\).*AccountSecurity/);
  assert.match(cssSource, /\.account-password-form\{/);
});

test("account controls retain a dedicated 420px layout without horizontal tables", () => {
  assert.match(cssSource, /@media\(max-width:420px\)\{[\s\S]*\.account-actions\{display:grid/);
  assert.match(cssSource, /\.credit-ledger-row\{grid-template-columns:minmax\(0,1fr\) auto;grid-template-areas/);
  assert.match(cssSource, /\.account-dialog,.account-dialog-wide\{width:100%/);
});
