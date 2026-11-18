/* Which prices a filings or research run should use.
   NSE's end-of-day file for today appears only in the evening, so before then the newest file is yesterday's.
   A run must never replace newer prices (today's live prices from the price check) with that older close:
   on 18 Nov 2026 the 17:10 run did, which flipped three signals back and the 19:10 run flipped them again. */
function pickPrices(close, old, ids) {
  if (!close) return old || null;
  if (old && old.date && old.date > close.date) return old;          /* old prices are from a later day */
  const px = { date: close.date, time: "close", src: "NSE end-of-day file", p: {} };
  for (const id of ids) {
    if (close.p[id] > 0) px.p[id] = close.p[id];
    else if (old && old.p && old.p[id] > 0 && old.date === close.date) px.p[id] = old.p[id];  /* missing from the file: keep today's live price */
  }
  return px;
}
module.exports = { pickPrices };
