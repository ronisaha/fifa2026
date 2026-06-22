# BALLDONTLIE FIFA gateway Worker (Cloudflare)

A tiny Cloudflare Worker that proxies the [BALLDONTLIE FIFA World Cup API](https://fifa.balldontlie.io/)
for the World Cup 2026 site. It exists because the upstream needs a secret key
and isn't CORS-enabled, so the static browser app can't call it directly.

> We use BALLDONTLIE because its **free tier covers the 2026 season** with
> real-time live scores. (API-Football's free tier is restricted to 2022–2024.)

Two endpoints, served from **one shared cache**:

| Endpoint | Used by | Returns |
|---|---|---|
| `GET /live` (also `/`) | browser banner + match cards (~60s while live) | in-progress matches only |
| `GET /fixtures` | GitHub Action (per non-skipped run) | all season matches → finished-score overlay |

## How it stays within the free 5 requests/MINUTE limit

- A single `GET /matches?seasons[]=2026` call returns the whole tournament, so we
  fetch it **once** and serve both endpoints from one KV record.
- It refreshes **at most once per `REFRESH_S`** (default 90s ≈ 0.7 req/min). With
  pagination (104 matches > 100/page) that's ~1.4 req/min — comfortably under 5.
- A short **edge cache** (`EDGE_S`, default 30s) absorbs bursts.
- `DAILY_CAP` is a backstop only; the real limiter is the refresh interval.

## Response shape (both endpoints)

```json
{
  "matches": [
    { "id": 1, "short": "live", "rawStatus": "in_progress", "elapsed": 47,
      "clock": "47:15", "dateUtc": "2026-06-28T15:00:00.000Z",
      "home": "Mexico", "away": "South Africa", "goalsHome": 1, "goalsAway": 0 }
  ],
  "meta": {
    "fetchedAt": "2026-06-28T15:30:00.000Z",
    "ageSeconds": 24,
    "refreshIntervalSeconds": 90,
    "budgetRemaining": 1990,
    "status": "fresh",
    "upstream": { "results": 104, "errors": null }
  }
}
```

`short` is normalized: `finished` | `live` | `scheduled` | `postponed` | `cancelled`.
`meta.status`: `fresh` | `cache` | `edge` | `budget_capped` | `no_key` | `upstream_*`.
`meta.upstream.errors` surfaces upstream problems (e.g. bad key) instead of a silent `[]`.

## Deploy

```bash
cd worker
npm install

# 1) Create the KV namespace and paste its id into wrangler.toml
npx wrangler kv namespace create LIVE_KV

# 2) Add your BALLDONTLIE key (free: https://balldontlie.io)
npx wrangler secret put BALLDONTLIE_KEY

# 3) (optional) set ALLOW_ORIGIN / SEASON / REFRESH_S in wrangler.toml

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
