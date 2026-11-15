/* Target prices for buy-rated companies. A target is the base fair value on the day the company becomes BUY or STRONG BUY.
   It stays open until the price reaches it, the business weakens, or three years pass, and is revised after each new result.
   targets.json: { open: { SYMBOL: {...} }, closed: [ {...} ] }. Pure functions; tested in tools/test.js. */
"use strict";
const E = require("../engine.js");
const days = (a, b) => Math.round((new Date(a) - new Date(b)) / 864e5);

/* One company, one run. Mutates T. Returns null or an event { type: set|revised|reached|withdrawn|expired, id, name, text, t }. */
function step(T, c, A, price, date) {
  T.open = T.open || {}; T.closed = T.closed || [];
  const R = E.RULES, t = T.open[c.id], buy = A.newInv === "BUY" || A.newInv === "STRONG BUY", fv = A.fv ? Math.round(A.fv.base) : null;
  if (!t) {
    if (!buy || !fv || !(price > 0) || fv <= price) return null;
    const last = T.closed.filter(x => x.id === c.id && x.outcome === "withdrawn").map(x => x.closed).sort().pop();
    if (last && days(date, last) < R.target.cooldownDays) return null;
    const n = T.open[c.id] = { name: c.name, set: date, setPrice: price, orig: fv, target: fv, signal: A.newInv, flags: A.flags.length, idx: A.latest.idx, revised: [] };
    return { type: "set", id: c.id, name: c.name, t: n, text: c.name + " (" + c.id + "): target ₹" + fv + " set at ₹" + price };
  }
  const close = (outcome, why) => {
    delete T.open[c.id];
    const x = { id: c.id, name: c.name, set: t.set, setPrice: t.setPrice, orig: t.orig, target: t.target, closed: date, closePrice: price > 0 ? price : null, days: days(date, t.set), outcome, why };
    T.closed.push(x);
    const gain = price > 0 ? ((price / t.setPrice - 1) * 100).toFixed(0) : null;
    return { type: outcome, id: c.id, name: c.name, t: x, text: c.name + " (" + c.id + "): target ₹" + t.target + " " +
      (outcome === "reached" ? "reached at ₹" + price + " (" + (gain >= 0 ? "+" : "") + gain + "% in " + x.days + " days since ₹" + t.setPrice + "). Review the holding"
        : outcome + " at ₹" + (price > 0 ? price : "n/a") + ": " + why) };
  };
  if (days(date, t.set) > R.target.maxMonths / 12 * 365) return close("expired", "not reached within " + R.target.maxMonths / 12 + " years");
  if (A.blocks.length || !(price > 0)) return null;                  /* data gap today: decide nothing */
  if (price >= t.target) return close("reached", "");
  if (A.quality < R.watchQuality) return close("withdrawn", "quality score fell to " + Math.round(A.quality) + " (below " + R.watchQuality + ")");
  if (A.flags.length > t.flags) return close("withdrawn", "new red flag: " + A.flags[A.flags.length - 1]);
  if (A.latest.idx > t.idx) {                                        /* a new result: revise the target to the new fair value */
    t.idx = A.latest.idx;
    if (!fv) return close("withdrawn", "no fair value after the " + A.latest.period + " result (" + (A.valNote || "earnings not positive") + ")");
    if (fv <= price) return close("withdrawn", "fair value fell to ₹" + fv + " after the " + A.latest.period + " result, below the price");
    if (fv !== t.target) { const from = t.target; t.revised.push({ date, from, to: fv, period: A.latest.period }); t.target = fv;
      return { type: "revised", id: c.id, name: c.name, t, text: c.name + " (" + c.id + "): target revised ₹" + from + " → ₹" + fv + " after the " + A.latest.period + " result" } }
  }
  return null;
}
/* Track record of closed targets. */
function record(T) {
  const c = T.closed || [], by = o => c.filter(x => x.outcome === o), r = by("reached"), d = r.map(x => x.days).sort((a, b) => a - b);
  return { open: Object.keys(T.open || {}).length, reached: r.length, withdrawn: by("withdrawn").length, expired: by("expired").length,
    medianDays: d.length ? d[Math.floor(d.length / 2)] : null };
}
module.exports = { step, record };
