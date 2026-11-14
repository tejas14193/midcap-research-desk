#!/usr/bin/env node
/* Tests for the NSE filing reader, using real filings saved in tests/fixtures. Run: node tools/test.js */
"use strict";
const assert = require("assert"), fs = require("fs"), path = require("path");
const N = require("./nse.js"), E = require("../engine.js");
const fx = n => fs.readFileSync(path.join(__dirname, "..", "tests", "fixtures", n), "utf8");
let n = 0; const t = (name, fn) => { fn(); n++; console.log("ok  " + name) };

t("quarter and date helpers", () => {
  assert.deepStrictEqual(N.quarterOf("30-SEP-2026"), { idx: E.colIdx("Sep 2026"), end: "2026-09-30" });
  assert.strictEqual(E.plabel(N.quarterOf("31-MAR-2026").idx), "Q4 FY26");
  assert.strictEqual(N.quarterOf("garbage"), null);
  assert.strictEqual(N.isoDate("14-Nov-2026 21:10:24"), "2026-11-14");
});
t("reads Ashok Leyland Q2 FY27 consolidated filing", () => {
  const v = N.parse(fx("ashokley-q2fy27-consolidated.xml"), { symbol: "ASHOKLEY", end: "2026-09-30", basis: "consolidated" });
  assert.deepStrictEqual(v, { revenue: 17030, ebitda: 2776, pat: 891, interest: 1344, eps: 1.43, debt: 63790, cash: 7134, equity: 13201 });
});
t("rejects a filing for another company, basis or quarter", () => {
  const x = fx("ashokley-q2fy27-consolidated.xml");
  assert.throws(() => N.parse(x, { symbol: "LUPIN", end: "2026-09-30", basis: "consolidated" }), /not LUPIN/);
  assert.throws(() => N.parse(x, { symbol: "ASHOKLEY", end: "2026-09-30", basis: "standalone" }), /expected standalone/);
  assert.throws(() => N.parse(x, { symbol: "ASHOKLEY", end: "2026-06-30", basis: "consolidated" }), /no three-month period/);
  assert.throws(() => N.parse("<html>Access Denied</html>", { symbol: "X", end: "2026-09-30", basis: "consolidated" }), /not an XBRL/);
});
t("rejects a filing that reports only the half year (Patanjali Q2 FY27)", () => {
  assert.throws(() => N.parse(fx("patanjali-q2fy27-halfyear-only.xml"), { symbol: "PATANJALI", end: "2026-09-30", basis: "consolidated" }), /no three-month period/);
});
t("picks the newest filing of the right format and basis", () => {
  const row = (o) => ({ symbol: "AAA", consolidated: "Consolidated", qe_Date: "30-SEP-2026", seq_Id: "1", type_Sub: "Original", broadcast_Date: "01-Nov-2026 10:00:00",
    xbrl: "https://x/INTEGRATED_FILING_INDAS_1_WEB.xml", ...o });
  const got = N.pick([row({}), row({ seq_Id: "5", type_Sub: "Revision" }), row({ consolidated: "Standalone", seq_Id: "9" }),
    row({ xbrl: "https://x/INTEGRATED_FILING_NBFC_INDAS_2_WEB.xml", seq_Id: "8" }), row({ symbol: "ZZZ", seq_Id: "7" })], new Map([["AAA", "consolidated"]]));
  assert.strictEqual(got.length, 1); assert.strictEqual(got[0].seq, 5); assert.strictEqual(got[0].revised, true); assert.strictEqual(got[0].filed, "2026-11-01");
});
const co = () => ({ basis: "consolidated", resultDate: "2026-08-01", quarters: [100, 101, 102].map(i => ({ idx: i, period: E.plabel(i), revenue: 1000, ebitda: 200, pat: 100, interest: 10, eps: 5, debt: 50, cash: 20, equity: 900 })) });
const fil = (idx, o) => ({ idx, basis: "consolidated", revenue: 1000, ebitda: 200, pat: 100, interest: 10, eps: 5, debt: 1, cash: 1, equity: 1, xbrl: "https://x/f.xml", filed: "2026-11-10", ...o });
t("adds the next quarter from NSE when the previous filing matched Screener", () => {
  const c = co(), r = N.overlay(c, { 102: fil(102), 103: fil(103, { revenue: 1100, pat: 120 }) });
  assert.ok(r.added); assert.strictEqual(c.quarters.length, 4);
  const q = c.quarters[3]; assert.strictEqual(q.src, "NSE"); assert.strictEqual(q.revenue, 1100); assert.strictEqual(q.debt, null); assert.strictEqual(c.resultDate, "2026-11-10");
  assert.deepStrictEqual(c.quarters[2].check, []);
});
t("holds back when the previous filing disagreed, or none was checked", () => {
  let c = co(), r = N.overlay(c, { 102: fil(102, { revenue: 3000 }), 103: fil(103) });
  assert.strictEqual(r.added, null); assert.match(r.held, /did not match/); assert.strictEqual(c.quarters.length, 3); assert.strictEqual(c.quarters[2].revenue, 1000);
  assert.strictEqual(c.quarters[2].check.length, 1);
  c = co(); r = N.overlay(c, { 103: fil(103) }); assert.strictEqual(r.added, null); assert.match(r.held, /no earlier filing/);
});
t("never skips a quarter, mixes basis, or accepts a wild jump", () => {
  let c = co(); assert.strictEqual(N.overlay(c, { 102: fil(102), 104: fil(104) }).added, null);
  c = co(); assert.strictEqual(N.overlay(c, { 102: fil(102), 103: fil(103, { basis: "standalone" }) }).added, null);
  c = co(); assert.match(N.overlay(c, { 102: fil(102), 103: fil(103, { revenue: 9000 }) }).held, /far from/);
});
t("refreshes an NSE-sourced quarter when the filing is revised", () => {
  const c = co(); N.overlay(c, { 102: fil(102), 103: fil(103) }); N.overlay(c, { 102: fil(102), 103: fil(103, { pat: 77 }) });
  assert.strictEqual(c.quarters.length, 4); assert.strictEqual(c.quarters[3].pat, 77);
});
console.log(n + " tests passed");
