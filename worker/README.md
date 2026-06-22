# API-Football live-scores Worker (Cloudflare)

A tiny Cloudflare Worker that proxies [API-Football](https://www.api-football.com/)
for the World Cup 2026 site. It exists because API-Football needs a secret key and
isn't CORS-enabled, so the static browser app can't call it directly.

| Endpoint | Upstream | Free plan? | Used for |
|---|---|---|---|
| `GET /live` (also `/`) | `fixtures?live=all` | ✅ **yes** | real-time in-match scores (banner + cards) |
| `GET /fixtures` | `fixtures?league=&season=2026` | ❌ plan-blocked | (unused — see below) |

> **Free-plan reality:** `fixtures?live=all` is **not** season-scoped, so it works on
> the free tier and returns all currently in-play matches (the site filters to the
> WC match by team name). The season-scoped `/fixtures` query **is** blocked on free
> ("try from 2022 to 2024"), so the finished-results overlay is **disabled** — match
> results come from the free upbound feed instead.

## Budget (free tier: 100 requests/day + a per-minute limit)

- `fixtures?live=all` returns **all** live matches in **one** request.
- The Worker refreshes upstream at most once per `REFRESH_INTERVAL_S` (default
  **120s** ≈ 0.5 req/min — safely under the per-minute limit), shared across all
  visitors via KV, with a short edge cache on top.
- `LIVE_DAILY_CAP` (default **90**) bounds daily calls under the 100/day quota;
  at 120s that covers ~3h of live football/day before serving stale.
- The frontend only polls `/live` while a WC match is in its live window, so the
  budget is spent only during matches.

## Response shape

```json
{
  "matches": [
    { "id": 1489399, "dateUtc": "2026-06-22T17:00:00+00:00", "short": "2H",
      "elapsed": 47, "home": "Argentina", "away": "Austria",
      "goalsHome": 1, "goalsAway": 0 }
  ],
  "meta": {
    "fetchedAt": "...", "ageSeconds": 24, "refreshIntervalSeconds": 120,
    "budgetRemaining": 89, "status": "fresh",
    "upstream": { "results": 22, "errors": null }
  }
}
```

`meta.status`: `fresh` | `cache` | `edge` | `budget_capped` | `no_key` | `upstream_errors` | `upstream_*`.
`meta.upstream.errors` surfaces API-Football problems (e.g. `rateLimit`, `plan`).

## Deploy

```bash
cd worker
npm install

# 1) Create the KV namespace and paste its id into wrangler.toml (first time only)
npx wrangler kv namespace create LIVE_KV

# 2) Add your API-Football key (free: https://dashboard.api-football.com/)
npx wrangler secret put APIFOOTBALL_KEY

# 3) Deploy
npx wrangler deploy
```

> Re-run `npx wrangler deploy` after any change to `src/index.js` or `wrangler.toml`.

## Connect the site

- Local: copy `.env.example` to `.env` and set `VITE_LIVE_API_URL` to the Worker URL.
- GitHub Pages: add a repo **Variable** `LIVE_API_URL` (Settings → Secrets and
  variables → Actions → Variables) — the build bakes it into the live banner/cards.

If unset, the site falls back to periodic upbound results with no live banner.
