# Midcap Research Desk

Rule-based fundamental research signals for the Nifty Midcap 150. A static dashboard on GitHub Pages, kept up to date by GitHub Actions. Research signals only, not investment advice.

## Files

- `index.html`, `engine.js`: the dashboard and the scoring engine (rules v0.2).
- `data.json`, `prices.json`, `state.json`: fundamentals, latest prices, and the last signal per company. Updated by the workflow.
- `tools/update.js`: the updater (`full`, `research`, `filings`, `prices`). Node 18+, no dependencies.
- `tools/nse.js`: reads quarterly results from NSE "Integrated Filing - Financials" XBRL files (standard Ind AS format, non-financial companies).
- `tools/test.js`: tests for the NSE reader, using real filings in `tests/fixtures`. Run `node tools/test.js`.
- `tools/targets.js`, `targets.json`: target prices for buy-rated companies and their track record.
- `tools/e2e.js`: end-to-end test on dummy data, with no network. Scores made-up companies over three days and checks signals, targets, alerts and WhatsApp messages. Run `node tools/e2e.js`.
- `tools/ci.js`: runs the updater in GitHub Actions, checks the result, and sends alerts.
- `tools/mail.js`: sends alert emails through Gmail.
- `filings.json`: cache of NSE filings already read.
- `.github/workflows/update.yml`: the schedule.

## Schedule (India time)

- Price check: weekdays 11:22 and 15:22 (live prices from Yahoo Finance).
- NSE filings check: daily 17:10 and 19:10. Reads new results straight from NSE.
- Evening research: daily 21:39. Reloads Screener for companies near their result date (all 150 on Sundays), then checks NSE filings.

GitHub can start scheduled runs 5 to 30 minutes late. To run by hand: Actions → Midcap desk update → Run workflow.

## One-time setup

1. Settings → Pages → Source: **GitHub Actions**.
2. Actions → Midcap desk update → Run workflow (mode `deploy-only`) to publish the page.

## Alerts

When there is a new result, or a signal moves into or out of BUY, STRONG BUY or SELL, the workflow sends an email and opens an issue labelled `alert`. If a run fails, GitHub emails the repository owner.

Email needs two repository secrets: `SMTP_USER` (the Gmail address) and `SMTP_PASS` (a Gmail app password, from https://myaccount.google.com/apppasswords). Alerts go to the same address; set `SMTP_TO` to send them elsewhere. To check it works: Actions → Midcap desk update → Run workflow → `test-email`.

For WhatsApp (free, through CallMeBot, personal use): each person who wants alerts saves CallMeBot's number (see https://www.callmebot.com/?p=4333; +34 698 28 89 73 as of Nov 2026) in their phone and sends it "I allow callmebot to send me messages" on WhatsApp. The bot replies with an API key. Add a repository secret `WHATSAPP_RECIPIENTS` with one `phone:apikey` line per person, for example `+919800000000:123456`. To check it works: Run workflow → `test-whatsapp`.

For Telegram (recommended over WhatsApp; free and reliable): create a bot with @BotFather and save its token as the secret `TELEGRAM_BOT_TOKEN`. Open the bot and tap Start (for a group, add the bot and send `/start@<botname>`). Then Run workflow → `test-telegram`: the bot messages each chat its chat ID. Save the IDs, one per line, as the secret `TELEGRAM_CHAT_ID`, and run `test-telegram` again to confirm.

## Run on your own PC

```
node tools/update.js research .
npx serve .
```

## Data sources

- NSE: index list, end-of-day prices, and result filings (XBRL).
- Screener.in company pages: fundamentals history and 5-year median P/E (a scraped secondary source).
- Yahoo Finance, then Google Finance: intraday prices (may be delayed).

How NSE filings are used: for non-financial companies, each quarter on file is checked against the company's NSE filing and differences over 2% are shown on the company page. A new quarter is read from the filing before Screener has it, but only when the company's previous filing agreed with Screener; otherwise the app waits for Screener. Debt, cash and net worth always come from Screener. Banks, NBFCs and insurers file in other formats and use Screener only.

## Target prices

When a company becomes BUY or STRONG BUY, its base fair value that day is recorded as the target. The target stays open after the signal changes. It closes when the price reaches it, is withdrawn if quality falls below 55 or a new red flag appears, is revised after each new result, and expires after 3 years. The time estimate is a range that assumes the price rises only as fast as earnings per share; it is a rough guide, not a forecast. Closed targets are kept, and the dashboard shows the track record.
