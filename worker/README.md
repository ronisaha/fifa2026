# Live-score Worker (Cloudflare)

A tiny Cloudflare Worker that proxies **API-Football** live scores for the World Cup
2026 site. It exists because API-Football's free tier (~100 requests/day) needs a
secret key and isn't CORS-enabled, so it can't be called directly from the static
browser app.

## How it stays within the free 100/day quota

- `fixtures?live=all` returns **all** live matches in **one** request → number of
  matches or visitors never increases upstream cost.
- Upstream is refreshed at most once per `REFRESH_INTERVAL_S` (default **90s**),
  shared across all visitors via a **single KV record** (central cache).
- A hard `DAILY_BUDGET` (default **90**) stops upstream calls for the rest of the
  UTC day once hit; visitors keep getting the last scores (flagged `budget_capped`).
- A short edge cache (`EDGE_CACHE_S`, default **30s**) absorbs bursts.

Worst case (live football 24h/day) = `86400 / 90 = 960` attempts, clamped to 90 → **never exceeds 100**.

## Response shape

```json
{
  "matches": [
    { "id": 123, "short": "2H", "elapsed": 67, "home": "Tunisia", "away": "Japan", "goalsHome": 0, "goalsAway": 1 }
  ],
  "meta": {
    "fetchedAt": "2026-06-21T05:30:00.000Z",
    "ageSeconds": 24,
    "refreshIntervalSeconds": 90,
    "budgetRemaining": 71,
    "status": "fresh"
  }
}
```

`meta.status`: `fresh` | `cache` | `edge` | `budget_capped` | `no_key` | `upstream_*`.

## Deploy

```bash
cd worker
npm install

# 1) Create the KV namespace and paste its id into wrangler.toml
npx wrangler kv namespace create LIVE_KV

# 2) Add your API-Football key (free: https://dashboard.api-football.com/)
npx wrangler secret put APIFOOTBALL_KEY

# 3) (optional) set ALLOW_ORIGIN in wrangler.toml to your domain

# 4) Deploy
npx wrangler deploy
```

Deployment prints a URL like `https://wc2026-live-scores.xiidea.workers.dev`.

## Connect the site

Set the Worker URL as a build-time env var for the site so the banner polls it:

- Local: copy `.env.example` to `.env` and set `VITE_LIVE_API_URL`.
- GitHub Pages: add a repo **Variable** named `LIVE_API_URL` (Settings → Secrets
  and variables → Actions → Variables). The workflows pass it into the build.

If `VITE_LIVE_API_URL` is unset, the site simply falls back to periodic scores —
the live feature is fully optional.
