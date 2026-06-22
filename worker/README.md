# worldcup26.ir gateway Worker (Cloudflare)

A tiny Cloudflare Worker that proxies the community API at
[worldcup26.ir](https://worldcup26.ir) (`GET /get/games`) for the World Cup 2026
site. The upstream is **free and needs no API key**, but we still front it with a
Worker for central caching (so a hobby server isn't hit by every visitor), the
`/fixtures` shape, and diagnostics.

> Why this upstream: no reputable *free* API offers WC 2026 real-time scores
> (API-Football free is blocked from 2026; BALLDONTLIE's free tier excludes
> matches). worldcup26.ir is free and no-key. **Caveat:** whether it streams true
> in-match data (score + minute while a game is in play) is unverified — if it
> only flips `notstarted → finished`, `/live` stays empty and the site falls back
> to periodic results.

Two endpoints, served from **one shared cache**:

| Endpoint | Used by | Returns |
|---|---|---|
| `GET /live` (also `/`) | browser banner + match cards | in-progress matches only |
| `GET /fixtures` | GitHub Action | all matches → finished-score overlay |

## Budget

`GET /get/games` returns all 104 matches in one call. The Worker refreshes it at
most once per `REFRESH_S` (default 90s ≈ 0.7 req/min), shared across all visitors
and both endpoints, with a short edge cache on top — gentle on the upstream.

## Response shape (both endpoints)

```json
{
  "matches": [
    { "id": "1", "short": "finished", "rawStatus": "finished", "elapsed": null,
      "clock": "finished", "dateUtc": "2026-06-11T13:00:00Z",
      "home": "Mexico", "away": "South Africa", "goalsHome": 2, "goalsAway": 0 }
  ],
  "meta": {
    "fetchedAt": "2026-06-22T04:00:00.000Z", "ageSeconds": 24,
    "refreshIntervalSeconds": 90, "budgetRemaining": 1999,
    "status": "fresh", "upstream": { "results": 104, "errors": null }
  }
}
```

`short` is normalized: `finished` | `live` | `scheduled`.
`meta.status`: `fresh` | `cache` | `edge` | `budget_capped` | `upstream_*`.

## Deploy

```bash
cd worker
npm install

# 1) Create the KV namespace and paste its id into wrangler.toml (first time only)
npx wrangler kv namespace create LIVE_KV

# 2) (optional) set ALLOW_ORIGIN / REFRESH_S in wrangler.toml

# 3) Deploy — no API key/secret required for this upstream
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

If unset, the site falls back entirely to the periodic upbound data.
