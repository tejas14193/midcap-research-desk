/* Minimal SMTP sender for Gmail (port 465, TLS, AUTH LOGIN). Node 18+, no dependencies.
   Credentials come from the environment (SMTP_USER, SMTP_PASS); the mail goes to SMTP_TO, or to SMTP_USER itself. */
"use strict";
const tls = require("tls");

function send({ subject, text, host = process.env.SMTP_HOST || "smtp.gmail.com", port = +(process.env.SMTP_PORT || 465),
  user = process.env.SMTP_USER, pass = process.env.SMTP_PASS, to = process.env.SMTP_TO || process.env.SMTP_USER }) {
  if (!user || !pass) return Promise.reject(new Error("SMTP_USER or SMTP_PASS is not set"));
  pass = pass.replace(/\s+/g, "");                                   /* Google shows app passwords in groups of four */
  const b64 = s => Buffer.from(s, "utf8").toString("base64");
  const head = s => /^[\x20-\x7e]*$/.test(s) ? s : "=?UTF-8?B?" + b64(s) + "?=";
  const body = b64(text).replace(/.{76}/g, "$&\r\n");
  const msg = ["From: Midcap Research Desk <" + user + ">", "To: " + to, "Subject: " + head(subject), "Date: " + new Date().toUTCString(),
    "Message-ID: <" + Date.now() + "." + Math.random().toString(36).slice(2) + "@midcap-desk>", "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", body].join("\r\n");
  const steps = [[null, 220], ["EHLO midcap-desk", 250], ["AUTH LOGIN", 334], [b64(user), 334], [b64(pass), 235],
    ["MAIL FROM:<" + user + ">", 250], ["RCPT TO:<" + to + ">", 250], ["DATA", 354], [msg + "\r\n.", 250], ["QUIT", 221]];
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host, port, servername: host }), timer = setTimeout(() => { sock.destroy(); reject(new Error("SMTP timed out")) }, 30000);
    let buf = "", i = 0;
    const fail = e => { clearTimeout(timer); sock.destroy(); reject(e) };
    const next = () => { i++; if (i >= steps.length) { clearTimeout(timer); sock.end(); return resolve() } sock.write(steps[i][0] + "\r\n") };
    sock.on("error", fail);
    sock.on("data", d => {
      buf += d.toString("utf8");
      const lines = buf.split("\r\n"); buf = lines.pop();
      for (const l of lines) {
        if (/^\d{3}-/.test(l)) continue;                             /* multi-line reply, wait for the last line */
        const code = +l.slice(0, 3), want = steps[i][1];
        if (code !== want) return fail(new Error("SMTP step " + i + " expected " + want + ", got: " + (i === 4 ? code + " (login refused: check the app password)" : l.slice(0, 120))));
        next();
      }
    });
  });
}
module.exports = { send };
if (require.main === module) send({ subject: process.argv[2] || "Midcap desk: test email",
  text: process.argv[3] || "Email alerts from the Midcap Research Desk are working.\n\nYou will get an email like this when a company reports a new result, or when a signal moves into or out of BUY, STRONG BUY or SELL.\n\nRule-based research signal, not investment advice." })
  .then(() => console.log("Email sent"), e => { console.error("Email failed: " + e.message); process.exit(1) });
