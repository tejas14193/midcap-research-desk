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
const PARSER = 2;  /* bump when parse() output changes, so cached filings are read again */
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
  let D = null, I = null, Dstart = null; const dims = [];
  for (const m of xml.matchAll(/<xbrli:context id="([^"]+)">([\s\S]*?)<\/xbrli:context>/g)) {
    const s = /<xbrli:startDate>([^<]+)</.exec(m[2]), e = /<xbrli:endDate>([^<]+)</.exec(m[2]), i = /<xbrli:instant>([^<]+)</.exec(m[2]);
    if (m[2].includes("xbrldi:")) { if (s && e) dims.push([m[1], s[1].trim(), e[1].trim()]); continue }  /* breakdown lines, not the company total */
    if (s && e && e[1].trim() === want.end) { const d = (new Date(e[1]) - new Date(s[1])) / 864e5; if (d >= 80 && d <= 100 && !D) { D = m[1]; Dstart = s[1].trim() } }
    if (i && i[1].trim() === want.end && !I) I = m[1];
  }
  if (!D) throw new Error("no three-month period ending " + want.end);
  const B = new Set(dims.filter(([, s, e]) => s === Dstart && e === want.end).map(([id]) => id));  /* breakdowns of the same quarter */
  const F = {};
  for (const m of xml.matchAll(/<[a-z0-9-]+:(\w+)\s+([^>]*?)>([^<]*)<\//g)) {
    const c = /contextRef="([^"]+)"/.exec(m[2]); if (!c || (c[1] !== D && c[1] !== I && !B.has(c[1]))) continue;
    const k = c[1] + "|" + m[1]; if (!(k in F)) F[k] = m[3].trim();
  }
  /* "Other expenses" breakdown: excise duty and finance income are reported inside it by some companies */
  let excise = 0, finInc = 0;
  for (const b of B) {
    const d = (F[b + "|DescriptionOfOtherExpenses"] || "").toLowerCase(), v = Number(F[b + "|OtherExpenses"]);
    if (!d || !isFinite(v)) continue;
    if (/excise/.test(d)) excise += v / 1e7;
    else if (/finance income|interest income/.test(d) && v < 0) finInc += -v / 1e7;
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
  const jv = cr(D, "ShareOfProfitLossOfAssociatesAndJointVenturesAccountedForUsingEquityMethod");
  return {
    /* revenue net of excise duty (as Screener and most analysts show it); operating profit excludes finance income;
       interest is net of finance income (as Screener shows it), with the gross figure kept */
    revenue: r0(revenue - excise), revenueGross: r0(revenue), excise: r0(excise),
    ebitda: r0(revenue - (exp - (fin || 0) - (dep || 0)) - finInc), pat: r0(pat),
    interest: r0(fin == null ? null : fin - finInc), interestGross: r0(fin), finIncome: r0(finInc), jv: r0(jv), pv: PARSER,
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
/* Screener and the filings can define a line differently without either being wrong. Accepted alternatives:
   revenue before or after excise duty; operating profit with or without the share of JV/associate results
   (Screener deducts it for some companies, e.g. UPL, Voltas). The convention that matched is remembered so a
   quarter added from NSE follows the same one as the Screener history. */
const ALT = { revenue: f => [["net", f.revenue], ["gross", f.revenueGross]], ebitda: f => [["standard", f.ebitda], ["with JV share", f.jv ? f.ebitda + f.jv : null]] };
const close = (a, b) => Math.abs(a - b) <= Math.max(2, Math.abs(b) * 0.02);
function compare(f, q) {
  const check = [], note = [], conv = {};
  for (const [k, l] of FIELDS) {
    if (q[k] == null) continue;
    const opts = (ALT[k] ? ALT[k](f) : [["standard", f[k]]]).filter(o => o[1] != null); if (!opts.length) continue;
    const hit = opts.find(o => close(o[1], q[k]));
    if (hit) { conv[k] = hit[0]; if (hit !== opts[0]) note.push(l + " matches Screener " + hit[0]); }
    else check.push(l + ": NSE filing ₹" + opts[0][1] + " cr, Screener ₹" + q[k] + " cr");
  }
  if (f.excise > 0) note.push("Revenue shown after excise duty of ₹" + f.excise + " cr");
  return { check, note, conv };
}
function adopt(f, conv) {
  const v = { ...f };
  if (conv.revenue === "gross" && f.revenueGross != null) v.revenue = f.revenueGross;
  if (conv.ebitda === "with JV share" && f.jv) v.ebitda = f.ebitda + f.jv;
  return v;
}
function overlay(co, filings) {
  const out = { added: null, held: null }; if (!filings) return out;
  const by = {}; co.quarters.forEach(q => by[q.idx] = q);
  let verified = null, conv = {};
  for (const f of Object.values(filings).sort((a, b) => a.idx - b.idx)) {
    if (f.basis !== co.basis) continue;
    const url = f.ixbrl || f.xbrl, q = by[f.idx], last = co.quarters.length ? Math.max(...co.quarters.map(x => x.idx)) : null;
    if (q && q.src === "NSE") {                                   /* added from NSE earlier, Screener has not caught up: refresh in case of a revision */
      const v = adopt(f, conv); for (const k of TAKE) q[k] = v[k];
      q.filing = url; q.filed = f.filed;
    } else if (q) {
      q.filing = url; q.filed = f.filed;
      const m = compare(f, q);
      q.check = m.check; q.basisNote = m.note.length ? m.note : undefined;
      verified = q.check.length === 0; conv = m.conv;
    } else if (last != null && f.idx === last + 1) {
      const p = by[last];
      if (verified !== true) { out.held = verified === false ? "its previous filing did not match Screener" : "no earlier filing has been checked against Screener"; continue }
      const v = adopt(f, conv);
      if (p && p.revenue > 0 && (v.revenue / p.revenue > 3 || v.revenue / p.revenue < 0.33)) { out.held = "revenue is far from the previous quarter"; continue }
      const n = { period: E.plabel(f.idx), idx: f.idx, revenue: v.revenue, ebitda: v.ebitda, pat: f.pat, eps: f.eps, interest: f.interest,
        debt: null, cash: null, equity: null, pledge: null, gnpa: null, src: "NSE", filing: url, filed: f.filed };
      co.quarters.push(n); by[f.idx] = n; if (co.quarters.length > 13) co.quarters = co.quarters.slice(-13);
      if (f.filed) co.resultDate = f.filed; out.added = n;
    }
  }
  return out;
}

module.exports = { PARSER, compare, recent, forSymbol, pick, parse, overlay, get, quarterOf, isoDate, sleep, FORMAT };
