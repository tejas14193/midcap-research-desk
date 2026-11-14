/* Reads quarterly results straight from NSE "Integrated Filing - Financials" XBRL files.
   Covers the standard (Ind AS) format used by non-financial companies. Banks, NBFCs and insurers
   file in other formats and are left to Screener for now.
   Node 18+, no dependencies. Used by update.js; the parser is tested by tools/test.js. */
"use strict";
const E = require("../engine.js");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const HEAD = { "User-Agent": UA, Accept: "*/*", "Accept-Language": "en-US,en;q=0.9", Referer: "https://www.nseindia.com/companies-listing/corporate-integrated-filing" };
const API = "https://www.nseindia.com/api/integrated-filing-results?index=equities&period_ended=all&type=Integrated%20Filing-%20Financials";
const FORMAT = "INTEGRATED_FILING_INDAS_";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MON = { JAN: "Jan", FEB: "Feb", MAR: "Mar", APR: "Apr", MAY: "May", JUN: "Jun", JUL: "Jul", AUG: "Aug", SEP: "Sep", OCT: "Oct", NOV: "Nov", DEC: "Dec" };
const MNUM = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };

async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: HEAD, redirect: "follow", signal: AbortSignal.timeout(45000) });
      if (r.ok) return await r.text();
      if (r.status === 404) return null;
    } catch (e) {}
    await sleep(1500 * (i + 1));
  }
  return null;
}
async function list(url) { const t = await get(url); try { const j = JSON.parse(t); return Array.isArray(j.data) ? j.data : null } catch (e) { return null } }
/* Most recent filings across all companies (about two weeks' worth at 3000 in results season). */
const recent = (size = 1500) => list(API + "&size=" + size + "&page=1");
const forSymbol = sym => list(API + "&symbol=" + encodeURIComponent(sym) + "&size=12&page=1");

/* "30-SEP-2026" -> { idx (engine quarter index), end "2026-09-30" } */
function quarterOf(qe) {
  const m = /^(\d{2})-([A-Z]{3})-(\d{4})$/.exec(String(qe || "").toUpperCase()); if (!m || !MON[m[2]]) return null;
  const idx = E.colIdx(MON[m[2]] + " " + m[3]); return idx == null ? null : { idx, end: m[3] + "-" + MNUM[MON[m[2]]] + "-" + m[1] };
}
/* "14-Nov-2026 21:10:24" -> "2026-11-14" */
function isoDate(s) { const m = /^(\d{2})-([A-Za-z]{3})-(\d{4})/.exec(String(s || "")); const k = m && MON[m[2].toUpperCase()]; return k ? m[3] + "-" + MNUM[k] + "-" + m[1] : null }

/* From a list of NSE rows, keep the newest usable filing per company and quarter. */
function pick(rows, wanted /* Map symbol -> "consolidated"|"standalone" */) {
  const best = {};
  for (const r of rows || []) {
    const basis = wanted.get(r.symbol); if (!basis) continue;
    if (!r.xbrl || !r.xbrl.includes(FORMAT)) continue;
    if (String(r.consolidated || "").toLowerCase() !== basis) continue;
    const q = quarterOf(r.qe_Date); if (!q) continue;
    const seq = +r.seq_Id || 0, k = r.symbol + "|" + q.idx;
    if (!best[k] || seq > best[k].seq) best[k] = { symbol: r.symbol, idx: q.idx, end: q.end, basis, seq, xbrl: r.xbrl, ixbrl: r.ixbrl || null,
      filed: isoDate(r.broadcast_Date || r.creation_Date), filedAt: r.broadcast_Date || r.creation_Date || null, revised: /revis/i.test(r.type_Sub || "") };
  }
  return Object.values(best);
}

/* Parse one XBRL file. Returns the quarter's figures in ₹ crore, or throws an Error saying what is wrong. */
function parse(xml, want /* { symbol, end, basis } */) {
  if (!xml || xml.indexOf("<xbrli:context") < 0) throw new Error("not an XBRL file");
  let D = null, I = null;
  for (const m of xml.matchAll(/<xbrli:context id="([^"]+)">([\s\S]*?)<\/xbrli:context>/g)) {
    if (m[2].includes("xbrldi:")) continue;                      /* segment or other breakdown, not the company total */
    const s = /<xbrli:startDate>([^<]+)</.exec(m[2]), e = /<xbrli:endDate>([^<]+)</.exec(m[2]), i = /<xbrli:instant>([^<]+)</.exec(m[2]);
    if (s && e && e[1].trim() === want.end) { const d = (new Date(e[1]) - new Date(s[1])) / 864e5; if (d >= 80 && d <= 100 && !D) D = m[1] }
    if (i && i[1].trim() === want.end && !I) I = m[1];
  }
  if (!D) throw new Error("no three-month period ending " + want.end);
  const F = {};
  for (const m of xml.matchAll(/<[a-z0-9-]+:(\w+)\s+([^>]*?)>([^<]*)<\//g)) {
    const c = /contextRef="([^"]+)"/.exec(m[2]); if (!c || (c[1] !== D && c[1] !== I)) continue;
    const k = c[1] + "|" + m[1]; if (!(k in F)) F[k] = m[3].trim();
  }
  const txt = (c, n) => F[c + "|" + n], raw = (c, n) => { const v = c && txt(c, n); if (v == null || v === "") return null; const x = Number(v); return isFinite(x) ? x : null };
  const cr = (c, n) => { const v = raw(c, n); return v == null ? null : v / 1e7 }, r0 = v => v == null ? null : Math.round(v);
  const sym = (txt(D, "Symbol") || "").replace(/&amp;/g, "&"); if (sym && sym !== want.symbol) throw new Error("file is for " + sym + ", not " + want.symbol);
  const nature = (txt(D, "NatureOfReportStandaloneConsolidated") || "").toLowerCase();
  if (nature && nature !== want.basis) throw new Error("file is " + nature + ", expected " + want.basis);
  const revenue = cr(D, "RevenueFromOperations"), exp = cr(D, "Expenses"), fin = cr(D, "FinanceCosts"), dep = cr(D, "DepreciationDepletionAndAmortisationExpense"), pat = cr(D, "ProfitLossForPeriod");
  if (!(revenue > 0)) throw new Error("no revenue figure");
  if (pat == null || exp == null) throw new Error("no profit or expenses figure");
  if (revenue > 5e5) throw new Error("revenue of ₹" + Math.round(revenue) + " cr is implausible (unit error?)");
  const sum = (a, b) => a == null && b == null ? null : (a || 0) + (b || 0);
  return {
    revenue: r0(revenue), ebitda: r0(revenue - (exp - (fin || 0) - (dep || 0))), pat: r0(pat), interest: r0(fin),
    eps: raw(D, "BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations"),
    debt: r0(sum(cr(I, "BorrowingsNoncurrent"), cr(I, "BorrowingsCurrent"))),
    cash: r0(sum(cr(I, "CashAndCashEquivalents"), cr(I, "BankBalanceOtherThanCashAndCashEquivalents"))),
    equity: r0(cr(I, "EquityAttributableToOwnersOfParent") ?? cr(I, "Equity")),
  };
}

/* Lay cached NSE filings over one company's quarters (which come from Screener).
   - A quarter both have keeps Screener's figures; differences over 2% are recorded in q.check.
   - A quarter Screener does not have yet is added from the filing, but only if it is the next quarter in
     sequence AND the company's previous filing agreed with Screener. Some companies report revenue on a
     different basis from Screener (for example including excise duty), and mixing the two would fake growth.
   - Debt, cash and net worth are not taken from the filing: Screener counts lease liabilities as debt and the
     filing has no separate figure for them, so the engine keeps using the last Screener balance sheet.
   Returns { added: quarter|null, held: reason|null }. */
const FIELDS = [["revenue", "Revenue"], ["ebitda", "Operating profit"], ["pat", "Net profit"], ["interest", "Interest"]];
const TAKE = ["revenue", "ebitda", "pat", "eps", "interest"];
function overlay(co, filings) {
  const out = { added: null, held: null }; if (!filings) return out;
  const by = {}; co.quarters.forEach(q => by[q.idx] = q);
  let verified = null;
  for (const f of Object.values(filings).sort((a, b) => a.idx - b.idx)) {
    if (f.basis !== co.basis) continue;
    const url = f.ixbrl || f.xbrl, q = by[f.idx], last = co.quarters.length ? Math.max(...co.quarters.map(x => x.idx)) : null;
    if (q && q.src === "NSE") {                                   /* added from NSE earlier, Screener has not caught up: refresh in case of a revision */
      for (const k of TAKE) q[k] = f[k];
      q.filing = url; q.filed = f.filed;
    } else if (q) {
      q.filing = url; q.filed = f.filed;
      q.check = FIELDS.filter(([k]) => f[k] != null && q[k] != null && Math.abs(f[k] - q[k]) > Math.max(2, Math.abs(q[k]) * 0.02))
        .map(([k, l]) => l + ": NSE filing ₹" + f[k] + " cr, Screener ₹" + q[k] + " cr");
      verified = q.check.length === 0;
    } else if (last != null && f.idx === last + 1) {
      const p = by[last];
      if (verified !== true) { out.held = verified === false ? "its previous filing did not match Screener" : "no earlier filing has been checked against Screener"; continue }
      if (p && p.revenue > 0 && (f.revenue / p.revenue > 3 || f.revenue / p.revenue < 0.33)) { out.held = "revenue is far from the previous quarter"; continue }
      const n = { period: E.plabel(f.idx), idx: f.idx, revenue: f.revenue, ebitda: f.ebitda, pat: f.pat, eps: f.eps, interest: f.interest,
        debt: null, cash: null, equity: null, pledge: null, gnpa: null, src: "NSE", filing: url, filed: f.filed };
      co.quarters.push(n); by[f.idx] = n; if (co.quarters.length > 13) co.quarters = co.quarters.slice(-13);
      if (f.filed) co.resultDate = f.filed; out.added = n;
    }
  }
  return out;
}

module.exports = { recent, forSymbol, pick, parse, overlay, get, quarterOf, isoDate, sleep, FORMAT };
