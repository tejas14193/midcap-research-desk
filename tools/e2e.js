#!/usr/bin/env node
/* End-to-end test with dummy data. No network: twelve made-up companies are scored over three "days" through the
   same code the scheduled runs use (ci.js -> update.js recompute), and WhatsApp messages go to a local stand-in server.
   Checks signals, targets, the NSE-filing path, alerts and the saved files. Email is not sent here.
   node tools/e2e.js [--keep]   (--keep prints the folder so the dashboard can be opened on the dummy data) */
"use strict";
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path"), http = require("http"), { execFile } = require("child_process");
const E = require("../engine.js");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "desk-e2e-")), F = n => path.join(dir, n);
const W = (n, o) => fs.writeFileSync(F(n), JSON.stringify(o)), R = n => JSON.parse(fs.readFileSync(F(n), "utf8"));
const iso = d => d.toISOString().slice(0, 10), day = back => iso(new Date(Date.now() + 5.5 * 36e5 - back * 864e5));
const ist = new Date(Date.now() + 5.5 * 36e5), mth = ist.getUTCMonth(), yr = ist.getUTCFullYear();
const ended = E.colIdx(["Dec", "Mar", "Jun", "Sep"][Math.floor(mth / 3)] + " " + (mth < 3 ? yr - 1 : yr));
let n = 0; const ok = (name, cond, detail) => { assert.ok(cond, name + (detail ? ": " + detail : "")); n++; console.log("ok  " + name) };

/* ---------- dummy companies ---------- */
function quarter(o, idx, i) {
  const rev = o.rev0 * Math.pow(1 + o.g, i / 4), pat = rev * o.patM;
  return { period: E.plabel(idx), idx, revenue: Math.round(rev), ebitda: Math.round(rev * o.margin), pat: Math.round(pat), eps: +(pat / o.shares).toFixed(2),
    interest: o.interest, debt: o.debt, cash: o.cash, equity: o.equity, pledge: null, gnpa: o.gnpa == null ? null : o.gnpa };
}
function mk(id, industry, o) {
  o = { rev0: 1000, g: 0.12, margin: 0.2, patM: 0.12, shares: 100, debt: 0, cash: 500, equity: 2200, interest: 0, medPE: 30, n: 13, lag: 0, ...o };
  const last = ended - o.lag, quarters = []; for (let i = 0; i < o.n; i++) quarters.push(quarter(o, last - (o.n - 1) + i, i));
  return { id, name: id[0] + id.slice(1).toLowerCase() + " Dummy Ltd.", industry, sector: o.fin ? "fin" : "nonfin", basis: "consolidated", mcap: 20000, medPE: o.medPE, pledge: null,
    src: "https://example.invalid/" + id, asof: day(2), resultDate: day(20), nextDate: null, quarters, _o: o };
}
const good = { g: 0.12 }, cos = [
  mk("ALPHA", "Capital Goods", { g: 0.25, equity: 4000 }),
  mk("BRAVO", "Information Technology", { ...good, lag: 1 }),
  mk("CHARLIE", "Fast Moving Consumer Goods", good),
  mk("DELTA", "Chemicals", { g: -0.15, margin: 0.06, patM: -0.02, debt: 3000, cash: 100, equity: 2000, interest: 60 }),
  mk("ECHO", "Financial Services", { ...good, fin: true, gnpa: 2, medPE: 12 }),
  mk("FOXTROT", "Power", { ...good, n: 3 }),
  mk("GOLF", "Metals & Mining", { ...good, lag: 1 }),
  mk("HOTEL", "Consumer Services", good),
  mk("INDIA", "Healthcare", good),
  mk("JULIET", "Capital Goods", good), mk("KILO", "Capital Goods", good), mk("LIMA", "Capital Goods", good), mk("MIKE", "Capital Goods", good),
];
const by = id => cos.find(c => c.id === id);
const fv = c => { const A = E.analyse({ ...c, price: 1, priceDate: day(0) }); return A.fv || null };
const at = (id, mos) => +(fv(by(id)).base * (1 - mos / 100)).toFixed(2);          /* price that is mos% below fair value */
const px = { ALPHA: at("ALPHA", 30), BRAVO: at("BRAVO", 17), CHARLIE: at("CHARLIE", 5), DELTA: 50, ECHO: at("ECHO", 25), FOXTROT: 100, GOLF: at("GOLF", 18),
  HOTEL: at("HOTEL", 17), INDIA: at("INDIA", 0), JULIET: at("JULIET", 16), KILO: at("KILO", 17), LIMA: at("LIMA", 18), MIKE: at("MIKE", 19) };
const filing = (c, idx, over) => { const q = { ...quarter(c._o, idx, c._o.n - 1 + (idx - (ended - c._o.lag))), ...over };
  return { symbol: c.id, idx, end: "", basis: "consolidated", seq: idx, xbrl: "https://example.invalid/" + c.id + "-" + idx + ".xml", ixbrl: null, filed: day(1), revised: false,
    revenue: q.revenue, ebitda: q.ebitda, pat: q.pat, interest: q.interest, eps: q.eps, debt: 1, cash: 1, equity: 1 } };

/* ---------- local stand-in for the WhatsApp service ---------- */
const sent = [];
const server = http.createServer((req, res) => { const u = new URL(req.url, "http://x"); sent.push({ phone: u.searchParams.get("phone"), key: u.searchParams.get("apikey"), text: u.searchParams.get("text") }); res.end("Message queued.") });
const run = () => new Promise((resolve, reject) => {
  const env = { ...process.env, WHATSAPP_RECIPIENTS: "+910000000001:key1\n+910000000002:key2", WHATSAPP_API_URL: "http://127.0.0.1:" + server.address().port + "/whatsapp.php" };
  for (const k of ["GITHUB_TOKEN", "GITHUB_REPOSITORY", "GITHUB_STEP_SUMMARY", "SMTP_USER", "SMTP_PASS", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"]) delete env[k];
  execFile(process.execPath, [path.join(__dirname, "ci.js"), "recompute", dir], { env, maxBuffer: 32e6 }, (err, out, errOut) => err ? reject(new Error(errOut || err.message)) : resolve(out));
});
const sig = id => R("state.json").signals[id];

(async () => {
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const strip = c => { const { _o, ...x } = c; return x };
  W("data.json", { built: day(2), universe: "Dummy data", source: "made-up figures for testing", failed: [], companies: cos.map(strip) });
  W("filings.json", { _failed: {}, BRAVO: { [ended - 1]: filing(by("BRAVO"), ended - 1) }, GOLF: { [ended - 1]: filing(by("GOLF"), ended - 1) } });

  /* ---- Day 1: first run. Signals for every rule, targets set, no alerts ---- */
  W("prices.json", { date: day(2), time: "close", src: "dummy prices", p: { ...px } });
  let out = await run(), s = R("state.json").signals, T = R("targets.json");
  ok("day 1: strong buy needs every rule (ALPHA)", s.ALPHA.n === "STRONG BUY" && s.ALPHA.h === "ADD", JSON.stringify(s.ALPHA));
  ok("day 1: buy when cheap but under the strong-buy discount (BRAVO, HOTEL)", s.BRAVO.n === "BUY" && s.HOTEL.n === "BUY");
  ok("day 1: watchlist when quality is good but price is not (CHARLIE, INDIA)", s.CHARLIE.n === "WATCHLIST" && s.INDIA.n === "WATCHLIST" && s.INDIA.h === "HOLD");
  ok("day 1: avoid, and sell for holders, when the business is weak (DELTA)", s.DELTA.n === "AVOID" && s.DELTA.h === "SELL", JSON.stringify(s.DELTA));
  ok("day 1: a financial company can be buy but never strong buy (ECHO)", s.ECHO.n === "BUY");
  ok("day 1: insufficient data with only 3 quarters (FOXTROT)", s.FOXTROT.n === "INSUFFICIENT DATA");
  const A = E.analyse({ ...strip(by("DELTA")), price: 50, priceDate: day(2) });
  ok("day 1: red flags raised for losses and weak interest cover (DELTA)", A.flags.some(f => /Net loss/.test(f)) && A.flags.some(f => /Interest cover/.test(f)), A.flags.join("; "));
  const buys = Object.keys(s).filter(k => /BUY/.test(s[k].n)).sort();
  ok("day 1: a target is set for every buy-rated company and no other", JSON.stringify(Object.keys(T.open).sort()) === JSON.stringify(buys), Object.keys(T.open).join(","));
  ok("day 1: target equals fair value on the day it is set", T.open.ALPHA.target === Math.round(fv(by("ALPHA")).base) && T.open.ALPHA.setPrice === px.ALPHA);
  ok("day 1: first run sends no alerts", sent.length === 0 && !/Signal changes/.test(out));
  const eA = E.eta(by("ALPHA"), E.analyse({ ...strip(by("ALPHA")), price: px.ALPHA, priceDate: day(2) }), px.ALPHA, T.open.ALPHA.target);
  ok("day 1: time estimate is a range and the cautious end is later (ALPHA)", eA.lo >= 1 && eA.hi >= eA.lo && /months/.test(eA.text), JSON.stringify(eA));
  ok("day 1: commodity sectors are marked as less reliable (GOLF)", E.eta(by("GOLF"), { m: { epsTtm: 12, eps1: 10 } }, 100, 120).cyclical === true);

  /* ---- Day 2: prices move, and GOLF files a bad quarter on NSE ---- */
  const t0 = { ...T.open };
  px.CHARLIE = at("CHARLIE", 25); px.HOTEL = +(t0.HOTEL.target * 1.02).toFixed(2);
  W("prices.json", { date: day(1), time: "close", src: "dummy prices", p: { ...px } });
  const f = R("filings.json"); f.GOLF[ended] = filing(by("GOLF"), ended, { pat: Math.round(by("GOLF").quarters[9].pat * 0.3), eps: +(by("GOLF").quarters[9].eps * 0.3).toFixed(2) }); W("filings.json", f);
  out = await run(); s = R("state.json").signals; T = R("targets.json");
  ok("day 2: price fall turns watchlist into a buy, with an alert and a target (CHARLIE)", /Charlie Dummy Ltd\. \(CHARLIE\): WATCHLIST → (STRONG )?BUY at ₹[\d.]+; target ₹\d+/.test(out) && !!T.open.CHARLIE, out.match(/Charlie.*/));
  ok("day 2: the buy alert includes the likely time", /CHARLIE\).*likely in about \d+/.test(out));
  ok("day 2: target reached closes the target and alerts (HOTEL)", /HOTEL\): target ₹\d+ reached at ₹[\d.]+ \(\+\d+% in 1 days/.test(out) && !T.open.HOTEL && T.closed.some(x => x.id === "HOTEL" && x.outcome === "reached"));
  ok("day 2: leaving buy is alerted (HOTEL)", /HOTEL\): BUY → WATCHLIST/.test(out));
  const g = R("data.json").companies.find(c => c.id === "GOLF"), gq = g.quarters[g.quarters.length - 1];
  ok("day 2: new result read from the NSE filing before Screener has it (GOLF)", gq.idx === ended && gq.src === "NSE" && /^https:/.test(gq.filing) && gq.debt === null);
  ok("day 2: the new result is reported with its source and red flag", /Golf Dummy Ltd\. \(GOLF\)\*\* .* result/.test(out) && /Source: NSE filing/.test(out) && /Red flags: .*Net profit down/.test(out));
  ok("day 2: a new red flag withdraws the target (GOLF)", /GOLF\): target ₹\d+ withdrawn/.test(out) && !T.open.GOLF && T.closed.some(x => x.id === "GOLF" && x.outcome === "withdrawn"), out.match(/GOLF\): target.*/));
  ok("day 2: untouched targets stay fixed (ALPHA)", T.open.ALPHA.target === t0.ALPHA.target && T.open.ALPHA.set === t0.ALPHA.set);
  ok("day 2: one WhatsApp per recipient, to the right numbers", sent.length === 2 && sent[0].phone === "+910000000001" && sent[0].key === "key1" && sent[1].phone === "+910000000002");
  ok("day 2: the WhatsApp text carries results, signal changes and targets", /Golf Dummy/.test(sent[0].text) && /Signal changes:/.test(sent[0].text) && /Targets:/.test(sent[0].text) && /not investment advice/.test(sent[0].text));
  ok("day 2: phone numbers are masked in the log", /WhatsApp \+91…001: sent/.test(out) && !/910000000001/.test(out));

  /* ---- Day 3: BRAVO files a good quarter, INDIA becomes very expensive, GOLF must wait before a new target ---- */
  const before = T.open.BRAVO.target; sent.length = 0;
  px.INDIA = +(fv(by("INDIA")).bull * 1.6).toFixed(2);
  W("prices.json", { date: day(0), time: "close", src: "dummy prices", p: { ...px } });
  const f3 = R("filings.json"); f3.BRAVO[ended] = filing(by("BRAVO"), ended); W("filings.json", f3);
  out = await run(); s = R("state.json").signals; T = R("targets.json");
  ok("day 3: a new result revises the target and keeps the first one on record (BRAVO)", /BRAVO\): target revised ₹\d+ → ₹\d+/.test(out) && T.open.BRAVO.target > before && T.open.BRAVO.orig === before && T.open.BRAVO.revised.length === 1);
  ok("day 3: holders get a sell alert when price is far above fair value (INDIA)", s.INDIA.h === "SELL" && /INDIA\) for holders: HOLD → SELL/.test(out));
  ok("day 3: yesterday's events are not repeated", !/HOTEL\): target/.test(out) && !/CHARLIE\): WATCHLIST/.test(out));
  ok("day 3: no new target within 30 days of a withdrawal (GOLF)", !T.open.GOLF);
  const rec = require("./targets.js").record(T);
  ok("day 3: track record counts are right", rec.reached === 1 && rec.withdrawn === 1 && rec.expired === 0 && rec.medianDays === 1 && rec.open === Object.keys(T.open).length, JSON.stringify(rec));
  ok("day 3: strong buy list is in the alert", /\*\*Strong buy list\*\*\n- Alpha Dummy Ltd\./.test(out));

  /* ---- Day 3 again: nothing changed, so nothing is sent ---- */
  sent.length = 0; out = await run();
  ok("re-run with no changes sends nothing", sent.length === 0 && !/Signal changes|\*\*Targets\*\*/.test(out));

  server.close();
  console.log(n + " end-to-end checks passed");
  if (process.argv.includes("--keep")) console.log("DIR " + dir); else fs.rmSync(dir, { recursive: true, force: true });
})().catch(e => { console.error("FAILED  " + e.message); server.close(); process.exit(1) });
