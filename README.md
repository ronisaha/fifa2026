# FIFA World Cup 2026 — Fixtures & Results

A fast, static web app for the **FIFA World Cup 2026** (Canada · Mexico · USA):
schedule, results, group standings, knockout bracket, per-team pages, and
timezone-localized kickoff times. Built with **React + Vite + Tailwind** and
deployed to **GitHub Pages**.

Data is pre-fetched into static JSON by a scheduled GitHub Action — the browser
only ever reads local files (no API keys, no CORS, no rate limits).

## How it works

```
upbound-web/worldcup-live.json  ──(hourly Action)──►  scripts/fetch-data.mjs
                                                          │ normalize + compute
                                                          ▼
                                            public/data/*.json (committed)
                                                          │ push to main
                                                          ▼
                                        deploy.yml → Vite build → GitHub Pages
```

- **Base source:** [upbound-web/worldcup-live.json](https://github.com/upbound-web/worldcup-live.json) — no API key; provides the full schedule, venues and knockout placeholders. Override with the `SRC_URL` env var.
- **Results:** come from the upbound feed (the API-Football season-scoped overlay is disabled — the free plan blocks the 2026 season). The pipeline keeps optional overlay support (`LIVE_FIXTURES_URL`) for a future paid key.
- **`scripts/fetch-data.mjs`** downloads the upstream JSON, validates it, and emits the app's own schema:
  - `matches.json`, `teams.json`, `groups.json`, `standings.json` (computed), `bracket.json`, `meta.json`.
- **Optimization:** the Action runs every 30 min, but the script **skips entirely** unless a match has started or ended since the last sync (tracked via `meta.json → lastFetchAt`). So most ticks are no-ops and the live API's request budget is only spent on match days. Override with `FORCE=1`.

## Local development

```bash
npm install
npm run fetch-data:force   # generate public/data/*.json
npm run dev                # http://localhost:5173
```

Other scripts:

```bash
npm run build       # type-check + production build to dist/
npm run preview     # preview the production build
npm run fetch-data  # respects the skip-optimization
```

## Deploying to GitHub Pages

1. Push to `main`. In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. The `deploy.yml` workflow builds and publishes on every push to `main`.
3. The `update-data.yml` workflow refreshes data hourly; when the data changes it commits the JSON **and** builds + deploys the site itself. (A `GITHUB_TOKEN` push does not trigger `deploy.yml`, so the data workflow handles its own deploy.)

### Custom domain

The site is served at **<https://fifa2026.xiidea.net>** via `public/CNAME` (committed
so the custom domain persists across Pages deployments). To change or set up a domain:

1. Edit `public/CNAME` to your domain (one line, e.g. `worldcup2026.example.com`).
2. Point DNS at GitHub Pages:
   - Apex domain: `A`/`AAAA` records to GitHub Pages IPs, **or** an `ALIAS`/`ANAME` to `<user>.github.io`.
   - Subdomain: `CNAME` record to `<user>.github.io`.
3. In **Settings → Pages**, set the custom domain and enable **Enforce HTTPS**.

`vite.config.ts` uses `base: '/'` (correct for a custom domain / user page). If you
deploy to a project subpath instead (`<user>.github.io/fifa2026`), change `base`
to `'/fifa2026/'`.

## Live scores (optional)

A small [Cloudflare Worker](worker/README.md) proxies [API-Football](https://www.api-football.com/)'s
`fixtures?live=all` (which **works on the free plan** — it isn't season-scoped) to
power **real-time in-match scores** in the schedule banner/cards (`/live`). The
Worker holds the key (off the client), refreshes every ~120s and caps daily calls
under the free 100/day quota. The site filters the global live feed to the WC match
by team name. See [`worker/README.md`](worker/README.md) to deploy it.

To enable it on the site, set the build-time env var `VITE_LIVE_API_URL` to the
Worker URL (locally via `.env`, or as a GitHub repo **Variable** named
`LIVE_API_URL` for the Actions build). If unset, the banner falls back to the
periodic data and shows a note about the expected lag. The banner displays how
fresh the live score is and refreshes while a match is in progress.

## Notes

- Routing uses `HashRouter` so deep links work on static hosting without 404 fallbacks.
- Standings tiebreakers: points → goal difference → goals for (FIFA also applies head-to-head / fair-play where teams stay level).
- Unofficial fan project; not affiliated with FIFA.
