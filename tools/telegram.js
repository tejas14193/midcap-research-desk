/* Telegram alerts through the user's own bot. Node 18+, no dependencies.
   Secrets: TELEGRAM_BOT_TOKEN (from @BotFather) and TELEGRAM_CHAT_ID (one or more chat IDs, separated by commas or new lines;
   a person's chat or a group the bot was added to). Chat IDs are masked in the logs because Actions logs are public.
   node tools/telegram.js        setup and test: finds every chat that has started the bot (or added it to a group) in the last
                                 24 hours, and sends each one a test message that includes its own chat ID; also sends to TELEGRAM_CHAT_ID. */
"use strict";
require("dns").setDefaultResultOrder("ipv4first");          /* GitHub runners have no IPv6 route; Node's fetch can hang on api.telegram.org's IPv6 address */
const token = () => String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
const base = () => (process.env.TELEGRAM_API_URL || "https://api.telegram.org") + "/bot" + token();
const mask = id => { id = String(id); return id.slice(0, 2) + "…" + id.slice(-3) };
const chats = (raw = process.env.TELEGRAM_CHAT_ID || "") => [...new Set(raw.split(/[\s,;]+/).map(s => s.trim()).filter(s => /^-?\d{3,}$/.test(s)))];

async function call(method, body) {
  let last;
  for (let i = 0; i < 3; i++) {
    let r;
    try { r = await fetch(base() + "/" + method, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(45000) }) }
    catch (e) { last = new Error("network: " + (e.cause && e.cause.code || e.name || e.message)); await new Promise(r => setTimeout(r, 5000 * (i + 1))); continue }
    const j = await r.json().catch(() => ({ ok: false, description: "HTTP " + r.status }));
    if (!j.ok) { const e = new Error(j.description || "HTTP " + r.status); e.status = r.status; throw e }
    return j.result;
  }
  throw last;
}
/* Sends the same text to every chat. Never throws; returns one line per chat for the run log. */
async function sendAll(text, list = chats()) {
  const out = [], parts = [];
  for (let t = text; t.length; t = t.slice(4000)) parts.push(t.slice(0, 4000));
  for (const id of list) {
    try { for (const p of parts) await call("sendMessage", { chat_id: id, text: p, disable_web_page_preview: true }); out.push("Telegram " + mask(id) + ": sent") }
    catch (e) { out.push("Telegram " + mask(id) + ": failed (" + e.message.slice(0, 140) + ")") }
  }
  return out;
}
/* Chats that have talked to the bot recently (Telegram keeps updates for 24 hours). */
async function discover() {
  const ups = await call("getUpdates", { allowed_updates: ["message", "my_chat_member", "channel_post"] }), found = {};
  for (const u of ups) {
    const c = (u.message || u.channel_post || u.my_chat_member || {}).chat;
    if (c && c.id != null) found[c.id] = { id: c.id, type: c.type, name: c.title || [c.first_name, c.last_name].filter(Boolean).join(" ") || c.username || "" };
  }
  return Object.values(found);
}
module.exports = { sendAll, discover, chats, mask };

if (require.main === module) (async () => {
  if (!token()) { console.error("Telegram: the TELEGRAM_BOT_TOKEN secret is not set"); process.exit(1) }
  let me; try { me = await call("getMe") } catch (e) {
    console.error(/^network/.test(e.message) ? "Telegram: could not reach api.telegram.org (" + e.message + ")" : "Telegram: the bot token was refused (" + e.message + "). Copy it again from @BotFather, with no spaces.");
    process.exit(1) }
  console.log("Bot: @" + me.username);
  const saved = chats(), found = await discover().catch(e => { console.error("Could not read new chats: " + e.message); return [] });
  console.log("Chat IDs saved in TELEGRAM_CHAT_ID: " + (saved.length ? saved.map(mask).join(", ") : "none"));
  console.log("Chats that started the bot in the last 24 hours: " + (found.length ? found.map(c => c.type + " " + mask(c.id)).join(", ") : "none. Open the bot in Telegram, tap Start (or send /start@" + me.username + " in a group), then run this again."));
  const lines = [];
  for (const c of found) {
    const isSaved = saved.includes(String(c.id));
    lines.push(...await sendAll("Midcap desk: Telegram test.\n\n" + (isSaved
      ? "This chat is set up and will receive alerts for new results, buy/sell signal changes and targets."
      : "This chat's ID is " + c.id + "\n\nTo receive alerts here, add it to the TELEGRAM_CHAT_ID secret in GitHub (Settings → Secrets and variables → Actions). For several chats, put one ID per line.") +
      "\n\nRule-based research signal, not investment advice.", [String(c.id)]));
  }
  for (const id of saved.filter(id => !found.some(c => String(c.id) === id)))
    lines.push(...await sendAll("Midcap desk: Telegram test.\n\nThis chat is set up and will receive alerts for new results, buy/sell signal changes and targets.\n\nRule-based research signal, not investment advice.", [id]));
  lines.forEach(l => console.log(l));
  if (!lines.length || lines.some(l => /failed/.test(l))) process.exit(1);
})();
