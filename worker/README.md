# API-Football gateway Worker (Cloudflare)

A tiny Cloudflare Worker that proxies **API-Football** for the World Cup 2026 site.
It exists because API-Football's free tier (~100 requests/day) needs a secret key
and isn't CORS-enabled, so the static browser app can't call it directly.

Two endpoints, one shared key, one budget gatekeeper:

| Endpoint | Used by | Purpose |
|---|---|---|
| `GET /live` (also `/`) | browser banner (~60s while a match is live) | currently-live World Cup matches |
| `GET /fixtures` | GitHub Action (per non-skipped run) | full season fixtures → authoritative finished-score overlay |

## How it stays within the free 100/day quota

- Each endpoint refreshes upstream **at most once per its refresh interval**,
  shared across all callers via a single KV record (central cache).
- Each endpoint has its **own daily cap**, and the caps sum to **< 100**, so live
  polling can never starve the fixtures refresh (or vice-versa).
  Defaults: `LIVE_DAILY_CAP=70` + `FIXTURES_DAILY_CAP=25` = 95.
- A short **edge cache** absorbs bursts without touching KV or upstream.
- `fixtures?live=all` and `fixtures?league=&season=` each return everything in
  **one** request, so the number of matches/visitors never increases cost.

Once a cap is hit, that endpoint serves the last-known data (flagged
`budget_capped`) until the UTC-midnight reset.

## Response shape (both endpoints)

```json
{
  "matches": [
    { "id": 123, "dateUtc": "2026-06-21T04:00:00+00:00", "short": "FT",
      "elapsed": 90, "home": "Tunisia", "away": "Japan", "goalsHome": 0, "goalsAway": 1 }
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

# 3) (optional) set ALLOW_ORIGIN / caps in wrangler.toml

# 4) Deploy
npx wrangler deploy
```

Deployment prints a URL like `https://wc2026-live-scores.xiidea.workers.dev`.

> Re-run `npx wrangler deploy` after any change to `src/index.js` or `wrangler.toml`.

## Connect the site

Set the Worker base URL as a build-time env var for the site:

- Local: copy `.env.example` to `.env` and set `VITE_LIVE_API_URL`.
- GitHub Pages: add a repo **Variable** named `LIVE_API_URL` (Settings → Secrets
  and variables → Actions → Variables). The workflows pass it into the build and,
  for the data pipeline, append `/fixtures` automatically for the score overlay.

If unset, the site falls back entirely to the periodic upbound data — both the
live banner and the score overlay are optional.
