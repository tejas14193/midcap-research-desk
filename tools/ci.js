#!/usr/bin/env node
/* Runs the updater for GitHub Actions, checks the result is sane, and sends alerts.
   node tools/ci.js prices|research|full [dir]
   Exits non-zero (so nothing is committed) if the update failed or the data looks broken.
   Alerts: opens a GitHub issue when GITHUB_TOKEN and GITHUB_REPOSITORY are set (GitHub emails the owner),
   and sends a Telegram message when TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set. */
"use strict";
const { spawnSync } = require("child_process"), fs = require("fs"), path = require("path");
const mode = process.argv[2], dir = path.resolve(process.argv[3] || ".");
const die = m => { console.error("FAILED: " + m); if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, "**Failed:** " + m + "\n"); process.exit(1) };

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

const L = [];
L.push("Mode: " + mode + " · prices: " + (s.priceDate || "none") + " " + (s.priceTime || "") + (mode === "prices" ? "" : " · checked " + s.checked.length + ", failed " + s.failed.length));
for (const x of s.newResults) {
  L.push("", "**" + x.name + " (" + x.id + ")** " + x.quarter + ": " + x.verdict, "- New investors: " + x.signal + " · Holders: " + x.holder + (x.quality == null ? "" : " · Quality " + x.quality));
  if (x.flags && x.flags.length) L.push("- Red flags: " + x.flags.map(f => typeof f === "string" ? f : f.text || f.label || JSON.stringify(f)).join("; "));
  for (const c of (x.changes || []).slice(0, 2)) L.push("- " + (typeof c === "string" ? c : c.text || JSON.stringify(c)));
}
if (s.alerts.length) L.push("", "**Signal changes**", ...s.alerts.map(a => "- " + a));
if (s.strongBuy.length) L.push("", "**Strong buy list**", ...s.strongBuy.map(x => "- " + x.name + " ₹" + x.price + ", " + x.mos + "% below fair value"));
L.push("", "Rule-based research signal, not investment advice.");
const body = L.join("\n"), notify = s.newResults.length || s.alerts.length;
console.log(body);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, body + "\n");

(async () => {
  if (!notify) return;
  const title = s.message || "Midcap desk update " + s.today, E = process.env;
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
        body: JSON.stringify({ chat_id: E.TELEGRAM_CHAT_ID, text: (title + "\n\n" + body.replace(/\*\*/g, "")).slice(0, 4000), disable_web_page_preview: true }) });
      console.log("Telegram: " + x.status);
    } catch (e) { console.error("Telegram failed: " + e.message) }
  }
})();
