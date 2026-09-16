import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  calculateUnitEconomics,
  evaluateBriefReadiness,
} from "../public/brief-model.js";

const validBrief = {
  mode: "category_keyword",
  keyword: "Nightstands",
  asins: [],
  markets: ["US"],
  priceMin: 30,
  priceMax: 90,
  bands: [
    { name: "Entry", lo: 30, hi: 50 },
    { name: "Premium", lo: 50, hi: 90 },
  ],
  goals: ["entry"],
  weights: [0.25, 0.2, 0.2, 0.2, 0.15],
  views: ["P1"],
};

test("unit economics includes MFN, Section 301, and Section 232 duties", () => {
  const result = calculateUnitEconomics({
    fob: 10,
    freight: 2,
    duty: 1,
    dutyBase: 3,
    duty301: 25,
    duty232: 10,
    fba: 6,
    acos: 20,
    price: 40,
  });

  assert.equal(result.complete, true);
  assert.equal(result.dutyRate, 38);
  assert.equal(result.dutyAmount, 3.8);
  assert.equal(result.landed, 15.8);
  assert.equal(result.referral, 6);
  assert.equal(result.advertising, 8);
  assert.equal(result.net, 4.2);
  assert.equal(result.netMargin, 10.5);
});

test("unit economics preserves the legacy single-duty field for imported briefs", () => {
  const result = calculateUnitEconomics({
    fob: 10,
    freight: 2,
    duty: 5,
    fba: 6,
    acos: 20,
    price: 40,
  });

  assert.equal(result.dutyRate, 5);
  assert.equal(result.dutyAmount, 0.5);
  assert.equal(result.landed, 12.5);
});

test("a complete brief passes every launch gate", () => {
  const result = evaluateBriefReadiness(validBrief);

  assert.equal(result.ready, true);
  assert.equal(result.completed, result.total);
  assert.deepEqual(result.blockers, []);
});

test("launch readiness reports invalid ASINs and decision-contract blockers", () => {
  const result = evaluateBriefReadiness({
    ...validBrief,
    mode: "asin_list",
    keyword: "",
    asins: ["bad-asin"],
    markets: [],
    priceMin: 90,
    priceMax: 30,
    goals: [],
    weights: [0, 0, 0, 0, 0],
    views: [],
  });

  assert.equal(result.ready, false);
  assert.deepEqual(
    result.blockers.map((item) => item.id),
    ["subject", "market", "price", "segments", "goals", "weights", "delivery"],
  );
  assert.deepEqual(result.invalidAsins, ["BAD-ASIN"]);
});

test("overlapping price segments block launch even when the total price band is valid", () => {
  const result = evaluateBriefReadiness({
    ...validBrief,
    bands: [
      { name: "Entry", lo: 30, hi: 60 },
      { name: "Premium", lo: 55, hi: 90 },
    ],
  });

  assert.equal(result.ready, false);
  assert.match(result.bandIssue, /重叠/);
  assert.equal(result.blockers.some((item) => item.id === "segments"), true);
});

test("the brief UI restores an owner-scoped session draft and clears it after submit", async () => {
  const [briefSource, appSource] = await Promise.all([
    readFile(new URL("../public/brief.js", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);

  assert.match(briefSource, /draftStorageKey = \(ownerKey\)/);
  assert.match(briefSource, /sessionStorage\.setItem\(draftKey/);
  assert.match(briefSource, /submittedRef\.current=true;\s*sessionStorage\.removeItem\(draftKey\)/);
  assert.match(briefSource, /evaluateBriefReadiness/);
  assert.match(appSource, /ownerKey=\$\{store\.user\?\.email\|\|store\.user\?\.id\}/);
});
