# FIFA World Cup 2026 — Fixtures & Results Web App — Implementation Plan

> Status: **Plan only** (no code written yet). Awaiting review before build.
> Author date: 2026-06-17

## 1. Goal

A fast, static web app that shows the **FIFA World Cup 2026** schedule (fixtures),
results, group standings, a knockout bracket, and per-team views — deployed to
**GitHub Pages on a custom domain**. No backend server; all dynamic content is
pre-fetched into static JSON by a scheduled GitHub Action.

## 2. Locked requirements (from clarification)

| Decision | Choice |
|---|---|
| Data delivery | **Static JSON** committed by a scheduled **GitHub Action** |
| Data source | **upbound-web/worldcup-live.json** (**no API key**, refreshed frequently) |
| Result freshness | **Daily** (Action runs ~once/day); no live in-match scores |
| Features | Fixtures, Results, Group standings, Knockout bracket, Timezone localization, Team profiles & filtering |
| Stack | **React + Vite + Tailwind CSS** |
| Deployment | GitHub Pages, **custom domain** (Vite `base: '/'`) |

## 3. Data strategy

### Source
- Primary: `https://raw.githubusercontent.com/upbound-web/worldcup-live.json/master/2026/worldcup.json`
  - Contains fixtures **and** results: rounds, dates/times (UTC), teams, venues,
    full-time + half-time scores, goal scorers w/ minutes, group assignments.
  - Updated ~once per day upstream (good enough for the "daily" freshness choice).
- Fallback / cross-check (optional): TheStatsAPI free `fixtures.json`
  (CORS-enabled, no signup) for schedule + official knockout placeholders
  ("Winner Match 101") if openfootball lags on bracket slot labels.

### Pipeline (GitHub Action)
1. Scheduled workflow (`cron`, hourly; honour free api rate limit, only featch socre update after a match end for optimization, keep track of last call).
2. Node script `scripts/fetch-data.mjs`:
   - Downloads the upstream JSON.
   - **Validates** shape (expected groups, match count sanity check) — fail the
     job rather than commit corrupt data.
   - **Normalizes** into the app's own schema (decoupled from upstream changes):
     - `public/data/matches.json` — all matches (group + knockout), normalized.
     - `public/data/groups.json` — group memberships.
     - `public/data/standings.json` — **computed** standings (pts, W/D/L, GF/GA/GD)
       from finished group-stage results, with FIFA tiebreak ordering.
     - `public/data/teams.json` — team list (code, name, flag emoji/asset, group).
     - `public/data/bracket.json` — knockout tree (R32 → R16 → QF → SF → Final/3rd).
     - `public/data/meta.json` — `lastUpdated` timestamp + source attribution.
   - Writes files only if content changed (avoid empty commits).
3. Commit & push updated `public/data/*.json` back to the repo (bot commit).
4. The Pages deploy workflow rebuilds on push to `main`.

> Key point: the browser only ever reads **local static JSON** — no API keys, no
> CORS, no rate limits. Upgrading later to hourly/keyed results = swap the fetch
> script + add an Actions secret; the front end is unchanged.

## 4. App architecture (React + Vite + Tailwind)

```
fifa2026/
├─ public/
│  ├─ data/                # generated JSON (committed by Action)
│  ├─ CNAME                # custom domain
│  └─ flags/               # optional flag assets (or use emoji)
├─ scripts/
│  └─ fetch-data.mjs       # fetch + normalize + compute standings
├─ src/
│  ├─ main.tsx
│  ├─ App.tsx
│  ├─ routes/              # Schedule, Results, Standings, Bracket, Team
│  ├─ components/          # MatchCard, GroupTable, BracketView, Filters, TZSelect
│  ├─ lib/
│  │  ├─ data.ts           # load + cache JSON (fetch from import.meta.env.BASE_URL)
│  │  ├─ time.ts           # timezone localization (Intl API; default = browser TZ)
│  │  └─ standings.ts      # (shared types; computation lives in build script)
│  └─ types.ts
├─ .github/workflows/
│  ├─ update-data.yml      # scheduled fetch + commit
│  └─ deploy.yml           # build + deploy Pages on push
├─ index.html
├─ vite.config.ts          # base: '/'
├─ tailwind.config.js
└─ package.json
```

### Routing
HashRouter (or React Router with a 404→index fallback) so deep links work on
GitHub Pages. Routes:
- `/` Schedule (grouped by date; filter by group/team/date; TZ-aware times)
- `/results` Completed matches
- `/standings` Group tables (auto-computed)
- `/bracket` Knockout bracket visualization
- `/team/:code` Team profile (group, fixtures, results, path through tournament)

### Feature notes
- **Timezone localization:** render kickoff via `Intl.DateTimeFormat`; default to
  the visitor's timezone, with a selector (e.g. host cities / UTC) persisted in
  `localStorage`.
- **Standings:** computed in the build script (single source of truth), ordered by
  FIFA group-stage tiebreakers (points → GD → GF → head-to-head where derivable).
- **Bracket:** responsive columns R32→Final; placeholder slots until teams known.
- **Filtering/search:** client-side over `matches.json` (small dataset, 104 matches).
- **Offline-ish/perf:** data is tiny static JSON; add basic caching + a
  "last updated" badge from `meta.json`.

## 5. Deployment
- `deploy.yml`: build with Vite, publish `dist/` via `actions/deploy-pages`.
- `public/CNAME` holds the custom domain; Vite `base: '/'`.
- DNS: user points the custom domain (A/ALIAS or CNAME) to GitHub Pages and
  enables "Enforce HTTPS". (Requires the actual domain name — to be provided.)

## 6. Open inputs needed before/at build time
1. **Custom domain name** (for `CNAME` + DNS instructions).
2. **GitHub repo name / owner** (to initialize and push).
3. Visual preferences (brand colors, dark mode, logo) — otherwise I'll use a clean
   default theme with World-Cup-style accents.

## 7. Build steps (when approved to implement)
1. Scaffold Vite + React + TS, add Tailwind, ESLint/Prettier.
2. Define `types.ts` and `scripts/fetch-data.mjs`; run once to generate `public/data/*`.
3. Build data loaders + routes + components (Schedule → Results → Standings →
   Bracket → Team).
4. Add timezone + filtering.
5. Add `.github/workflows/update-data.yml` and `deploy.yml`, `CNAME`.
6. Local verify (`npm run dev`), then `npm run build` preview.
7. Push; confirm Pages deploy + scheduled data refresh.

## 8. Risks / mitigations
- **Upstream lag or schema drift** → normalization layer + validation that fails
  the job instead of committing bad data; optional TheStatsAPI fallback.
- **"Daily" not fresh enough during knockouts** → trivially upgrade cron frequency
  or switch to a keyed API in an Actions secret (front end unaffected).
- **SPA deep-link 404s on Pages** → HashRouter or 404.html fallback.
```
