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

- **Schedule gate (server-side):** before spending a budget call, `/live` checks
  whether any WC fixture is actually in its live window *now*. The schedule is
  the site's own published `matches.json` (free, on GitHub Pages), cached in KV
  and re-pulled at most every `SCHEDULE_TTL_S` (default **1800s**). A fixture
  counts as live from `LIVE_PRE_MIN` (default **5**) before kickoff to
  `LIVE_WINDOW_MIN` (default **150**) after. **Between matches the budgeted
  upstream is never touched** — even if something polls `/live` directly. (Fails
  open only if a schedule has never loaded, so a Pages hiccup can't kill live.)
- `fixtures?live=all` returns **all** live matches in **one** request.
- The Worker refreshes upstream at most once per `REFRESH_INTERVAL_S` (default
  **120s** ≈ 0.5 req/min — safely under the per-minute limit), shared across all
  visitors via KV, with a short edge cache on top.
- `LIVE_DAILY_CAP` (default **90**) bounds daily calls under the 100/day quota;
  at 120s that covers ~3h of live football/day before serving stale.
- **Errors are never cached.** A rate-limit / plan / non-200 upstream response
  does **not** overwrite the last-good scores and is served with `no-store`; it
  only throttles the next retry by one refresh interval. So a transient
  rate-limit can't poison the cache or wipe the live banner.
- The frontend also only polls `/live` while a WC match is in its live window,
  so this gate is a server-side backstop for the same intent.

## Cron: driving the data-refresh Action

GitHub throttles `schedule:` crons heavily — a `*/10` cron in
`update-data.yml` actually fires only ~once an hour. So the Worker runs a
**Cloudflare cron** (`*/10 * * * *`, honoured precisely) that POSTs
`workflow_dispatch` to the Action — but only when data could actually have
changed. A schedule gate (`shouldDispatch`, sharing the cached `matches.json`)
fires the Action from `DISPATCH_PRE_MIN` before a kickoff to `DISPATCH_POST_MIN`
after, and keeps retrying up to `DISPATCH_PENDING_MIN` after kickoff while a
started match is still unsynced (not yet marked `finished` in our published
data). **Between matches — everything synced, next kickoff still far off — the
Action is not triggered at all** (logged as `cron: skipped dispatch …`).

Needs one secret — a GitHub PAT with **Actions: read and write** on the repo:

```bash
npx wrangler secret put GH_DISPATCH_TOKEN
```

Tunables live in `[vars]`: `GH_REPO`, `GH_WORKFLOW` (default `update-data.yml`),
`GH_REF` (default `main`). A successful dispatch logs `cron: dispatched …` in
`npx wrangler tail`; if the token/repo is unset the tick is a logged no-op.

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

`meta.status`: `fresh` | `cache` | `edge` | `idle_no_fixture` | `budget_capped` | `no_key` | `upstream_errors` | `upstream_*`.
`idle_no_fixture` means the schedule gate skipped the upstream call (no WC match
live now). `meta.upstream.errors` surfaces API-Football problems (e.g.
`rateLimit`, `plan`) — those responses are throttled, not cached.

## Deploy

```bash
cd worker
npm install

# 1) Create the KV namespace and paste its id into wrangler.toml (first time only)
npx wrangler kv namespace create LIVE_KV

# 2) Add your API-Football key (free: https://dashboard.api-football.com/)
npx wrangler secret put APIFOOTBALL_KEY

# 3) Add a GitHub PAT (Actions: read+write) so the cron can dispatch the Action
npx wrangler secret put GH_DISPATCH_TOKEN

# 4) Deploy
npx wrangler deploy
```

> Re-run `npx wrangler deploy` after any change to `src/index.js` or `wrangler.toml`.

## Connect the site

- Local: copy `.env.example` to `.env` and set `VITE_LIVE_API_URL` to the Worker URL.
- GitHub Pages: add a repo **Variable** `LIVE_API_URL` (Settings → Secrets and
  variables → Actions → Variables) — the build bakes it into the live banner/cards.

If unset, the site falls back to periodic upbound results with no live banner.
