#!/usr/bin/env node
/* Runs the updater for GitHub Actions, checks the result is sane, and sends alerts.
   node tools/ci.js prices|filings|research|full [dir]
   Exits non-zero (so nothing is committed) if the update failed or the data looks broken.
   Alerts go out when there is a new result or a signal moves into or out of BUY, STRONG BUY or SELL:
   - email, when SMTP_USER and SMTP_PASS are set (Gmail app password; sent to SMTP_TO or to SMTP_USER itself)
   - a GitHub issue, when GITHUB_TOKEN and GITHUB_REPOSITORY are set
   - Telegram, when TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set */
"use strict";
const { spawnSync } = require("child_process"), fs = require("fs"), path = require("path");
const mode = process.argv[2], dir = path.resolve(process.argv[3] || ".");
const summary = s => { if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, s + "\n") };
const die = m => { console.error("FAILED: " + m); summary("**Failed:** " + m); process.exit(1) };

const r = spawnSync(process.execPath, [path.join(__dirname, "update.js"), mode, dir], { encoding: "utf8", maxBuffer: 64e6, timeout: 25 * 60e3 });
if (r.stderr) process.stderr.write(r.stderr);
if (r.status !== 0) die("updater exited with status " + r.status);
let s; try { s = JSON.parse(r.stdout.trim().split("\n").pop()) } catch (e) { die("updater printed no summary") }

if (mode === "prices") {
  if (s.priceMisses.length > 30) die("no live price for " + s.priceMisses.length + " companies");
} else {
  let n = 0; try { n = JSON.parse(fs.readFileSync(path.join(dir, "data.json"), "utf8")).companies.length } catch (e) {}
  if (n < 140) die("data.json has only " + n + " companies");
  if (s.checked.length && s.failed.length > s.checked.length / 2) die(s.failed.length + " of " + s.checked.length + " companies failed to load");
}

const site = process.env.GITHUB_REPOSITORY ? "https://" + process.env.GITHUB_REPOSITORY.split("/")[0] + ".github.io/" + process.env.GITHUB_REPOSITORY.split("/")[1] + "/" : null;
const L = [];
for (const x of s.newResults) {
  L.push("**" + x.name + " (" + x.id + ")** " + x.quarter + " result: " + x.verdict, "- New investors: " + x.signal + " · Holders: " + x.holder + (x.quality == null ? "" : " · Quality " + x.quality));
  L.push("- Source: " + x.source + (x.filing ? " " + x.filing : ""));
  if (x.flags && x.flags.length) L.push("- Red flags: " + x.flags.join("; "));
  for (const c of (x.changes || []).slice(0, 3)) L.push("- " + c);
  L.push("");
}
if (s.alerts.length) L.push("**Signal changes**", ...s.alerts.map(a => "- " + a), "");
if (s.strongBuy.length) L.push("**Strong buy list**", ...s.strongBuy.map(x => "- " + x.name + " ₹" + x.price + ", " + x.mos + "% below fair value"), "");
if (site) L.push("Dashboard: " + site);
L.push("Rule-based research signal, not investment advice.");
const body = L.join("\n"), notify = s.newResults.length > 0 || s.alerts.length > 0;

/* run log, for the Actions page only */
const log = ["Mode: " + mode + " · prices: " + (s.priceDate || "none") + " " + (s.priceTime || "") + (s.checked.length ? " · Screener checked " + s.checked.length + ", failed " + s.failed.length : "")];
if (s.nse) {
  log.push("NSE filings: " + (s.nse.ok ? "reachable" : "NOT reachable") + ", read " + s.nse.read + ", new results taken from NSE " + s.nse.added.length);
  if (s.nse.failed.length) log.push("NSE files not readable: " + s.nse.failed.join("; "));
  if (s.nse.held.length) log.push("New results waiting for Screener: " + s.nse.held.join("; "));
  if (s.nse.differs.length) log.push("NSE and Screener differ: " + s.nse.differs.join("; "));
}
console.log(log.join("\n") + "\n\n" + body);
summary(log.map(x => "- " + x).join("\n") + "\n\n" + body);

(async () => {
  if (!notify) return;
  const title = s.message || "Midcap desk update " + s.today, E = process.env, plain = body.replace(/\*\*/g, "");
  if (E.SMTP_USER && E.SMTP_PASS) {
    try { await require("./mail.js").send({ subject: title, text: plain }); console.log("Email: sent") }
    catch (e) { console.error("Email failed: " + e.message); summary("**Email failed:** " + e.message) }
  }
  if (E.GITHUB_TOKEN && E.GITHUB_REPOSITORY) {
    try {
      const x = await fetch("https://api.github.com/repos/" + E.GITHUB_REPOSITORY + "/issues", { method: "POST",
        headers: { Authorization: "Bearer " + E.GITHUB_TOKEN, Accept: "application/vnd.github+json", "User-Agent": "midcap-desk" },
        body: JSON.stringify({ title, body, labels: ["alert"] }) });
      console.log("GitHub issue: " + x.status);
    } catch (e) { console.error("GitHub issue failed: " + e.message) }
  }
  if (E.TELEGRAM_BOT_TOKEN && E.TELEGRAM_CHAT_ID) {
    try {
      const x = await fetch("https://api.telegram.org/bot" + E.TELEGRAM_BOT_TOKEN + "/sendMessage", { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: E.TELEGRAM_CHAT_ID, text: (title + "\n\n" + plain).slice(0, 4000), disable_web_page_preview: true }) });
      console.log("Telegram: " + x.status);
    } catch (e) { console.error("Telegram failed: " + e.message) }
  }
})();
