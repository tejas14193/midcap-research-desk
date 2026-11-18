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
  assert.deepStrictEqual(v, { revenue: 17030, revenueGross: 17030, excise: 0, ebitda: 2776, pat: 891, interest: 1344, interestGross: 1344, finIncome: 0, jv: 29,
    pv: N.PARSER, eps: 1.43, debt: 63790, cash: 7134, equity: 13201 });
});
const rd = (f, s) => N.parse(fx(f), { symbol: s, end: "2026-09-30", basis: "consolidated" });
const co = () => ({ basis: "consolidated", resultDate: "2026-08-01", quarters: [100, 101, 102].map(i => ({ idx: i, period: E.plabel(i), revenue: 1000, ebitda: 200, pat: 100, interest: 10, eps: 5, debt: 50, cash: 20, equity: 900 })) });
const fil = (idx, o) => ({ idx, basis: "consolidated", revenue: 1000, ebitda: 200, pat: 100, interest: 10, eps: 5, debt: 1, cash: 1, equity: 1, xbrl: "https://x/f.xml", filed: "2026-11-10", ...o });
t("takes excise duty out of revenue (Godfrey Phillips Q2 FY27 matches Screener)", () => {
  const v = rd("godfryphlp-q2fy27-consolidated.xml", "GODFRYPHLP");
  assert.strictEqual(v.revenueGross, 4198); assert.strictEqual(v.excise, 2856); assert.strictEqual(v.revenue, 1342); assert.strictEqual(v.ebitda, 213);
  assert.deepStrictEqual(N.compare(v, { revenue: 1342, ebitda: 213, pat: 190, interest: 4 }).check, []);
  assert.deepStrictEqual(N.compare(v, { revenue: 4198, ebitda: 213, pat: 190, interest: 4 }).conv.revenue, "gross");  /* a source that keeps gross revenue still matches */
});
t("keeps finance income out of operating profit (Indus Towers Q2 FY27 matches Screener)", () => {
  const v = rd("industower-q2fy27-consolidated.xml", "INDUSTOWER");
  assert.strictEqual(v.finIncome, 113); assert.strictEqual(v.ebitda, 4590); assert.strictEqual(v.interest, 342); assert.strictEqual(v.interestGross, 455);
  assert.deepStrictEqual(N.compare(v, { revenue: 8516, ebitda: 4590, pat: 1793, interest: 342 }).check, []);
});
t("accepts operating profit after JV share, and a new NSE quarter follows it (Voltas Q2 FY27)", () => {
  const v = rd("voltas-q2fy27-consolidated.xml", "VOLTAS");
  assert.strictEqual(v.ebitda, 128); assert.strictEqual(v.jv, -41);
  const m = N.compare(v, { revenue: 2707, ebitda: 87, pat: 48, interest: 20 });
  assert.deepStrictEqual(m.check, []); assert.strictEqual(m.conv.ebitda, "with JV share");
  const c = co(); c.quarters[2].ebitda = 160;
  const r = N.overlay(c, { 102: fil(102, { ebitda: 200, jv: -40 }), 103: fil(103, { ebitda: 250, jv: -30 }) });
  assert.ok(r.added); assert.strictEqual(c.quarters[3].ebitda, 220);
});
t("still flags a real filing error (Glenmark Q2 FY27 data file leaves out other operating income)", () => {
  const v = rd("glenmark-q2fy27-consolidated.xml", "GLENMARK");
  const m = N.compare(v, { revenue: 4247, ebitda: 864, pat: 264, interest: 64 });
  assert.strictEqual(m.check.length, 2); assert.match(m.check[0], /Revenue: NSE filing ₹4157 cr, Screener ₹4247 cr/);
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

/* ---- target prices ---- */
const TG = require("./targets.js");
const mkA = o => ({ newInv: "BUY", fv: { base: 800 }, flags: [], blocks: [], quality: 80, latest: { idx: 100, period: "Q1 FY26" }, ...o });
const C = { id: "AAA", name: "Aaa Ltd." };
const PX = require("./px.js");
t("a filings run never replaces today's live prices with yesterday's close (18 Nov 2026 flip-flop)", () => {
  const live = { date: "2026-11-18", time: "15:23 IST", p: { KEI: 3720, HFCL: 196 } };
  assert.strictEqual(PX.pickPrices({ date: "2026-11-17", p: { KEI: 3851, HFCL: 188.19 } }, live, ["KEI", "HFCL"]), live);
  const c = PX.pickPrices({ date: "2026-11-18", p: { KEI: 3725 } }, live, ["KEI", "HFCL"]);
  assert.deepStrictEqual(c, { date: "2026-11-18", time: "close", src: "NSE end-of-day file", p: { KEI: 3725, HFCL: 196 } });
  const n = PX.pickPrices({ date: "2026-11-18", p: { KEI: 3725 } }, { date: "2026-11-17", time: "close", p: { HFCL: 188 } }, ["KEI", "HFCL"]);
  assert.deepStrictEqual(n.p, { KEI: 3725 });   /* a price from an older day is not carried into today's close */
  assert.strictEqual(PX.pickPrices(null, live, ["KEI"]), live);
});
t("sets a target at fair value only for buy-rated companies", () => {
  const T = {};
  assert.strictEqual(TG.step(T, C, mkA({ newInv: "WATCHLIST" }), 700, "2026-01-01"), null);
  const e = TG.step(T, C, mkA(), 700, "2026-01-01");
  assert.strictEqual(e.type, "set"); assert.strictEqual(T.open.AAA.target, 800); assert.strictEqual(T.open.AAA.setPrice, 700);
  assert.strictEqual(TG.step(T, C, mkA({ newInv: "WATCHLIST" }), 760, "2026-02-01"), null);   /* stays open after leaving BUY */
  assert.ok(T.open.AAA);
});
t("closes a target as reached, and records it", () => {
  const T = {}; TG.step(T, C, mkA(), 700, "2026-01-01");
  const e = TG.step(T, C, mkA({ newInv: "WATCHLIST" }), 805, "2026-07-01");
  assert.strictEqual(e.type, "reached"); assert.ok(!T.open.AAA); assert.strictEqual(T.closed[0].days, 181); assert.match(e.text, /\+15% in 181 days/);
  assert.deepStrictEqual(TG.record(T), { open: 0, reached: 1, withdrawn: 0, expired: 0, medianDays: 181 });
});
t("withdraws on weak quality or a new red flag, then waits before setting again", () => {
  let T = {}; TG.step(T, C, mkA(), 700, "2026-01-01");
  assert.match(TG.step(T, C, mkA({ quality: 50 }), 700, "2026-02-01").text, /withdrawn.*quality score fell to 50/);
  T = {}; TG.step(T, C, mkA(), 700, "2026-01-01");
  assert.strictEqual(TG.step(T, C, mkA({ flags: ["Net profit down 30% year on year"] }), 700, "2026-02-01").type, "withdrawn");
  assert.strictEqual(TG.step(T, C, mkA({ flags: ["x"] }), 700, "2026-02-10"), null);            /* cooldown */
  assert.strictEqual(TG.step(T, C, mkA({ flags: ["x"] }), 700, "2026-03-15").type, "set");
});
t("revises after a new result, withdraws if fair value drops below the price, expires after 3 years", () => {
  let T = {}; TG.step(T, C, mkA(), 700, "2026-01-01");
  assert.strictEqual(TG.step(T, C, mkA({ fv: { base: 850 } }), 700, "2026-02-01"), null);        /* no new result: target stays fixed */
  const e = TG.step(T, C, mkA({ fv: { base: 850 }, latest: { idx: 101, period: "Q2 FY26" } }), 700, "2026-02-01");
  assert.strictEqual(e.type, "revised"); assert.strictEqual(T.open.AAA.target, 850); assert.strictEqual(T.open.AAA.orig, 800);
  assert.match(TG.step(T, C, mkA({ fv: { base: 650 }, latest: { idx: 102, period: "Q3 FY26" } }), 700, "2026-05-01").text, /fair value fell to ₹650/);
  T = {}; TG.step(T, C, mkA(), 700, "2026-01-01");
  assert.strictEqual(TG.step(T, C, mkA({ blocks: ["No current price on file"] }), null, "2026-02-01"), null);   /* data gap: no decision */
  assert.strictEqual(TG.step(T, C, mkA(), 700, "2029-01-05").type, "expired");
});
t("time estimate uses the lower growth rate, cut and capped, and refuses weak growth", () => {
  const co = { industry: "Capital Goods" }, A = m => ({ m });
  let e = E.eta(co, A({ epsTtm: 13.225, eps1: 11.5, eps2: 10 }), 700, 800);                      /* 15% both ways */
  assert.strictEqual(e.fast.toFixed(1), "15.0"); assert.strictEqual(e.slow.toFixed(2), "11.25"); assert.strictEqual(e.lo, 11); assert.strictEqual(e.hi, 15);
  e = E.eta(co, A({ epsTtm: 20, eps1: 10, eps2: 5 }), 700, 800); assert.strictEqual(e.fast, 30); assert.strictEqual(e.slow, 20);   /* caps */
  assert.match(E.eta(co, A({ epsTtm: 10, eps1: 10.5, eps2: 9 }), 700, 800).none, /not growing/);
  assert.match(E.eta(co, A({ epsTtm: 10.6, eps1: 10, eps2: null }), 700, 800).none, /too slowly/);
  assert.match(E.eta(co, A({ epsTtm: 11.5, eps1: 10, eps2: null }), 700, 2000).none, /more than 3 years/);
  assert.strictEqual(E.eta({ industry: "Metals & Mining" }, A({ epsTtm: 12, eps1: 10 }), 700, 800).cyclical, true);
  assert.strictEqual(E.eta(co, A({ epsTtm: 12, eps1: 10 }), 810, 800).reached, true);
});
console.log(n + " tests passed");
