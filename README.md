# Midcap Research Desk

Rule-based fundamental research signals for the Nifty Midcap 150. A static dashboard on GitHub Pages, kept up to date by GitHub Actions. Research signals only, not investment advice.

## Files

- `index.html`, `engine.js`: the dashboard and the scoring engine (rules v0.2).
- `data.json`, `prices.json`, `state.json`: fundamentals, latest prices, and the last signal per company. Updated by the workflow.
- `tools/update.js`: the updater (`full`, `research`, `prices`). Node 18+, no dependencies.
- `tools/ci.js`: runs the updater in GitHub Actions, checks the result, and sends alerts.
- `.github/workflows/update.yml`: the schedule.

## Schedule (India time)

- Price check: weekdays 11:22 and 15:22 (live prices from Yahoo Finance).
- Evening research: daily 21:38. Reloads companies near their result date; reloads all 150 on Sundays.

GitHub can start scheduled runs 5 to 30 minutes late. To run by hand: Actions → Midcap desk update → Run workflow.

## One-time setup

1. Settings → Pages → Source: **GitHub Actions**.
2. Actions → Midcap desk update → Run workflow (mode `deploy-only`) to publish the page.

## Alerts

When there is a new result or a signal moves into or out of STRONG BUY or SELL, the workflow opens an issue labelled `alert`. GitHub emails the repository owner for each one. If a run fails, GitHub emails that too.

For Telegram as well, add two repository secrets (Settings → Secrets and variables → Actions): `TELEGRAM_BOT_TOKEN` (from @BotFather) and `TELEGRAM_CHAT_ID`.

## Run on your own PC

```
node tools/update.js research .
npx serve .
```

## Data sources

NSE (index list, end-of-day prices), Screener.in company pages (fundamentals, a scraped secondary source), Yahoo Finance (intraday prices, may be delayed).
