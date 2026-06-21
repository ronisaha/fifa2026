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

- **Source:** [upbound-web/worldcup-live.json](https://github.com/upbound-web/worldcup-live.json) — no API key, refreshed frequently during matches. Override with the `SRC_URL` env var.
- **`scripts/fetch-data.mjs`** downloads the upstream JSON, validates it, and emits the app's own schema:
  - `matches.json`, `teams.json`, `groups.json`, `standings.json` (computed), `bracket.json`, `meta.json`.
- **Optimization:** the Action runs hourly, but the script **skips the network** unless a match is expected to have ended since the last fetch (tracked via `meta.json → lastFetchAt`). Override with `FORCE=1`.

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

## Notes

- Routing uses `HashRouter` so deep links work on static hosting without 404 fallbacks.
- Standings tiebreakers: points → goal difference → goals for (FIFA also applies head-to-head / fair-play where teams stay level).
- Unofficial fan project; not affiliated with FIFA.
