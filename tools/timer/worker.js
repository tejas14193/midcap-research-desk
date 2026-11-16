// Midcap desk timer: starts the GitHub workflow at fixed India times,
// because GitHub's own schedule never fired on this repository.
// Secret needed: GH_TOKEN (fine-grained token, Actions read and write, this repo only).
const REPO = "tejas14193/midcap-research-desk";

// One cron trigger fires 15 times a day; the mode is worked out from the India time
// of each firing, and firings at other times start nothing.
export function pickMode(ms) {
  const d = new Date(ms + 5.5 * 3600 * 1000); // shift to IST, then read as UTC
  const hm = d.getUTCHours() * 100 + d.getUTCMinutes();
  const weekday = d.getUTCDay() >= 1 && d.getUTCDay() <= 5;
  if (hm === 1122 || hm === 1522) return weekday ? "prices" : null;
  if (hm === 1710 || hm === 1910) return "filings";
  if (hm === 2139) return "research";
  return null;
}

async function start(mode, env) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/update.yml/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "midcap-desk-timer",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: "main", inputs: { mode } }),
  });
  if (r.status !== 204) throw new Error(`GitHub refused to start ${mode}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  console.log(`started ${mode}`);
}

export default {
  async scheduled(event, env, ctx) {
    const mode = pickMode(event.scheduledTime);
    if (!mode) { console.log("no run due at this time"); return; }
    ctx.waitUntil(start(mode, env));
  },
  // Opening the Worker's address starts nothing. /check tests the token by reading
  // the workflow (a read, not a run) and says whether GitHub accepted it.
  async fetch(req, env) {
    if (new URL(req.url).pathname !== "/check") return new Response("Midcap desk timer is running. Open /check to test the token.\n");
    if (!env.GH_TOKEN) return new Response("No GH_TOKEN secret found. Add it under Settings, Variables and Secrets.\n");
    const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/update.yml`, {
      headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "midcap-desk-timer" },
    });
    const msg = r.status === 200 ? "Token OK: GitHub accepted it." : `Token problem: GitHub answered HTTP ${r.status}. Check the token's repository and Actions permission.`;
    return new Response(msg + "\n");
  },
};
