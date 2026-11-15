/* WhatsApp alerts through CallMeBot (free, personal use). Node 18+, no dependencies.
   Each recipient activates CallMeBot once from their own WhatsApp and gets their own API key.
   Recipients come from the WHATSAPP_RECIPIENTS secret: one "phone:apikey" pair per line (or separated by commas),
   for example "+919800000000:123456". Phone numbers are never written to the repository or the logs. */
"use strict";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const mask = p => p.slice(0, 3) + "…" + p.slice(-3);

function recipients(raw = process.env.WHATSAPP_RECIPIENTS || "") {
  return raw.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean).map(s => {
    const m = /^(\+?[\d\s-]{8,20})\s*[:=|]\s*(\S+)$/.exec(s);
    return m ? { phone: "+" + m[1].replace(/\D/g, ""), key: m[2] } : null;
  }).filter(Boolean);
}

/* Sends the same text to every recipient. Never throws; returns one line per recipient for the run log. */
async function sendAll(text, list = recipients()) {
  const out = [], body = text.length > 1500 ? text.slice(0, 1480) + "\n… (more on the dashboard)" : text;
  for (const r of list) {
    const url = "https://api.callmebot.com/whatsapp.php?phone=" + encodeURIComponent(r.phone) + "&apikey=" + encodeURIComponent(r.key) + "&text=" + encodeURIComponent(body);
    let ok = false, why = "";
    for (let i = 0; i < 2 && !ok; i++) {
      try {
        const x = await fetch(url, { signal: AbortSignal.timeout(30000) }), t = await x.text();
        ok = x.ok && !/error|invalid|not\s+(valid|activated)|wrong/i.test(t.replace(/<[^>]+>/g, " ").slice(0, 600));
        if (!ok) why = "HTTP " + x.status + ": " + t.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 140);
      } catch (e) { why = e.message }
      if (!ok) await sleep(8000);
    }
    out.push("WhatsApp " + mask(r.phone) + ": " + (ok ? "sent" : "failed (" + why + ")"));
    await sleep(3000);                                               /* CallMeBot is a shared free service; space out requests */
  }
  return out;
}
module.exports = { recipients, sendAll };

if (require.main === module) {
  const list = recipients();
  if (!list.length) { console.error("WhatsApp: WHATSAPP_RECIPIENTS is empty or not in phone:apikey form"); process.exit(1) }
  sendAll(process.argv[2] || "Midcap desk: test message.\nWhatsApp alerts from the Midcap Research Desk are working. You will get a message like this for new results and buy/sell signal changes.")
    .then(lines => { lines.forEach(l => console.log(l)); if (lines.some(l => /failed/.test(l))) process.exit(1) });
}
