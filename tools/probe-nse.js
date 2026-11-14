#!/usr/bin/env node
/* Test: can this machine read result filings straight from NSE? Prints one line per request. */
"use strict";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const H = { "User-Agent": UA, Accept: "*/*", "Accept-Language": "en-US,en;q=0.9", Referer: "https://www.nseindia.com/companies-listing/corporate-integrated-filing" };
async function hit(label, url, headers = H) {
  const t = Date.now();
  try {
    const r = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(30000) }), b = await r.text();
    console.log(label + ": HTTP " + r.status + ", " + b.length + " bytes, " + (Date.now() - t) + " ms, starts: " + b.slice(0, 80).replace(/\s+/g, " "));
    return { r, b };
  } catch (e) { console.log(label + ": FAILED " + (e.cause && e.cause.code || e.name + " " + e.message) + " after " + (Date.now() - t) + " ms"); return {} }
}
(async () => {
  const sym = process.argv[2] || "ASHOKLEY";
  const api = "https://www.nseindia.com/api/integrated-filing-results?index=equities&symbol=" + encodeURIComponent(sym) + "&period_ended=all&type=Integrated%20Filing-%20Financials&size=5&page=1";
  let { b } = await hit("NSE filing list (no cookies)", api);
  let j = null; try { j = JSON.parse(b) } catch (e) {}
  if (!j) {
    const home = await hit("NSE page for cookies", "https://www.nseindia.com/companies-listing/corporate-integrated-filing", { ...H, Accept: "text/html" });
    const ck = home.r && home.r.headers.getSetCookie ? home.r.headers.getSetCookie().map(c => c.split(";")[0]).join("; ") : "";
    console.log("cookies received: " + (ck ? ck.split(";").length : 0));
    ({ b } = await hit("NSE filing list (with cookies)", api, { ...H, Cookie: ck }));
    try { j = JSON.parse(b) } catch (e) {}
  }
  const f = j && j.data && j.data[0];
  if (f) {
    console.log("latest filing: " + f.symbol + " " + f.qe_Date + " " + f.consolidated + ", broadcast " + f.broadcast_Date);
    const x = await hit("NSE XBRL file", f.xbrl);
    const m = x.b && /RevenueFromOperations contextRef="OneD"[^>]*>([^<]+)</.exec(x.b);
    console.log("revenue read from XBRL: " + (m ? "₹" + (m[1] / 1e7).toFixed(0) + " crore" : "not found"));
  }
  await hit("NSE results API (older format)", "https://www.nseindia.com/api/corporates-financial-results?index=equities&period=Quarterly&symbol=" + encodeURIComponent(sym));
  await hit("NSE announcements", "https://www.nseindia.com/api/corporate-announcements?index=equities&symbol=" + encodeURIComponent(sym));
  await hit("NSE archive (control, known to work)", "https://nsearchives.nseindia.com/content/indices/ind_niftymidcap150list.csv");
  await hit("BSE announcements API", "https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w?pageno=1&strCat=Result&strPrevDate=20261113&strScrip=&strSearch=P&strToDate=20261114&strType=C&subcategory=-1", { ...H, Referer: "https://www.bseindia.com/", Origin: "https://www.bseindia.com" });
})();
