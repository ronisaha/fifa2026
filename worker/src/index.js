// Cloudflare Worker: live-score proxy for World Cup 2026.
//
// Why this exists: API-Football's free tier allows only ~100 requests/day and
// requires a secret key (so it can't be called from the browser). This Worker
// holds the key, calls API-Football centrally, and serves CORS-enabled JSON to
// the static site. Browsers poll the Worker; the Worker throttles upstream calls.
//
// Budget safety (cannot exhaust the free 100/day quota):
//   1. `fixtures?live=all` returns ALL live matches in ONE request, so the number
//      of simultaneous matches/visitors never increases upstream cost.
//   2. Upstream is refreshed at most once per REFRESH_INTERVAL_S, shared across
//      all visitors via a single KV record (central cache).
//   3. A hard DAILY_BUDGET cap stops upstream calls for the rest of the UTC day
//      once reached; visitors keep getting the last-known scores (flagged stale).
//   4. A short edge cache (caches.default) absorbs bursts without touching KV.
//
// Worst case: live football 24h/day => 86400 / REFRESH_INTERVAL_S calls, still
// clamped to DAILY_BUDGET. With defaults (90s, 90) that's <= 90 < 100. Safe.

const DEFAULTS = {
  REFRESH_INTERVAL_S: 90, // min seconds between upstream API-Football calls
  DAILY_BUDGET: 90, // max upstream calls per UTC day (leave headroom under 100)
  EDGE_CACHE_S: 30, // edge cache TTL for the Worker response
  WC_LEAGUE_ID: 1, // API-Football league id for the FIFA World Cup
  UPSTREAM: 'https://v3.football.api-sports.io/fixtures?live=all',
};

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOW_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
  };
}

function json(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

export default {
  async fetch(request, env, ctx) {
    const cors = corsHeaders(env);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'GET') return json({ error: 'method not allowed' }, { status: 405, headers: cors });

    const cfg = {
      refresh: num(env.REFRESH_INTERVAL_S, DEFAULTS.REFRESH_INTERVAL_S),
      budget: num(env.DAILY_BUDGET, DEFAULTS.DAILY_BUDGET),
      edge: num(env.EDGE_CACHE_S, DEFAULTS.EDGE_CACHE_S),
      league: num(env.WC_LEAGUE_ID, DEFAULTS.WC_LEAGUE_ID),
    };

    // 1) Edge cache short-circuit: serves bursts without running the logic below.
    const cache = caches.default;
    const cacheKey = new Request(new URL(request.url).origin + '/live', { method: 'GET' });
    const cached = await cache.match(cacheKey);
    if (cached) {
      const r = new Response(cached.body, cached);
      for (const [k, v] of Object.entries(cors)) r.headers.set(k, v);
      r.headers.set('x-cache', 'edge');
      return r;
    }

    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);

    // 2) Central state (single KV record): last payload, fetch time, daily count.
    let state = null;
    if (env.LIVE_KV) {
      const raw = await env.LIVE_KV.get('state');
      if (raw) {
        try { state = JSON.parse(raw); } catch { state = null; }
      }
    }
    if (!state) state = { matches: [], fetchedAt: 0, date: today, count: 0 };
    if (state.date !== today) { state.date = today; state.count = 0; } // reset at UTC midnight

    const ageS = (now - state.fetchedAt) / 1000;
    let status = 'cache';

    if (ageS >= cfg.refresh) {
      if (state.count >= cfg.budget) {
        status = 'budget_capped'; // serve stale; protect the daily quota
      } else if (!env.APIFOOTBALL_KEY) {
        status = 'no_key';
      } else {
        try {
          const upstream = await fetch(DEFAULTS.UPSTREAM, {
            headers: { 'x-apisports-key': env.APIFOOTBALL_KEY },
            cf: { cacheTtl: 0 },
          });
          if (upstream.ok) {
            const data = await upstream.json();
            const matches = (data.response || [])
              .filter((f) => !cfg.league || f.league?.id === cfg.league)
              .map((f) => ({
                id: f.fixture?.id,
                short: f.fixture?.status?.short, // 1H, HT, 2H, ET, P, FT...
                elapsed: f.fixture?.status?.elapsed ?? null,
                home: f.teams?.home?.name,
                away: f.teams?.away?.name,
                goalsHome: f.goals?.home ?? null,
                goalsAway: f.goals?.away ?? null,
              }));
            state = { matches, fetchedAt: now, date: today, count: state.count + 1 };
            if (env.LIVE_KV) ctx.waitUntil(env.LIVE_KV.put('state', JSON.stringify(state)));
            status = 'fresh';
          } else {
            status = `upstream_${upstream.status}`;
          }
        } catch {
          status = 'upstream_error';
        }
      }
    }

    const body = {
      matches: state.matches,
      meta: {
        fetchedAt: state.fetchedAt ? new Date(state.fetchedAt).toISOString() : null,
        ageSeconds: state.fetchedAt ? Math.round((Date.now() - state.fetchedAt) / 1000) : null,
        refreshIntervalSeconds: cfg.refresh,
        budgetRemaining: Math.max(0, cfg.budget - state.count),
        status,
      },
    };

    const resp = json(body, {
      headers: { 'Cache-Control': `public, max-age=${cfg.edge}`, 'x-cache': 'miss' },
    });
    // Cache a clean copy at the edge (without CORS, which we add per-request).
    ctx.waitUntil(cache.put(cacheKey, resp.clone()));
    for (const [k, v] of Object.entries(cors)) resp.headers.set(k, v);
    return resp;
  },
};
