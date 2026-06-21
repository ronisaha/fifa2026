// Cloudflare Worker: API-Football gateway for the World Cup 2026 site.
//
// Two endpoints, one shared key, one budget gatekeeper:
//   GET /live      -> currently-live World Cup matches (polled by the browser
//                     banner ~every 60s while a match is in progress).
//   GET /fixtures  -> the full season's fixtures with scores (polled by the
//                     GitHub Action to overlay authoritative finished results).
//
// Why a Worker: API-Football's free tier (~100 req/day) needs a secret key and
// isn't CORS-enabled, so the static browser app can't call it directly.
//
// Budget safety (cannot exhaust the free 100/day quota):
//   * Each endpoint refreshes upstream at most once per its REFRESH interval,
//     shared across all callers via a single KV record (central cache).
//   * Each endpoint has its OWN daily cap; the caps sum to < 100 so live polling
//     can never starve the fixtures refresh (or vice-versa). Defaults: 70 + 25.
//   * A short edge cache absorbs bursts without touching KV or upstream.
//   * `fixtures?live=all` / `fixtures?league=&season=` each return everything in
//     ONE request, so matches/visitors never increase upstream cost.

const API_BASE = 'https://v3.football.api-sports.io';

const DEFAULTS = {
  LEAGUE: 1, // API-Football league id for the FIFA World Cup
  SEASON: 2026,
  LIVE_REFRESH_S: 90,
  LIVE_DAILY_CAP: 70,
  LIVE_EDGE_S: 30,
  FIXTURES_REFRESH_S: 300,
  FIXTURES_DAILY_CAP: 25,
  FIXTURES_EDGE_S: 120,
};

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

const corsHeaders = (env) => ({
  'Access-Control-Allow-Origin': env.ALLOW_ORIGIN || '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
});

const json = (body, { status = 200, headers = {} } = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });

async function apiGet(env, path) {
  return fetch(`${API_BASE}${path}`, {
    headers: { 'x-apisports-key': env.APIFOOTBALL_KEY },
    cf: { cacheTtl: 0 },
  });
}

// Map API-Football fixtures to a slim shape used by both endpoints.
function slimFixtures(data, leagueId) {
  return (data.response || [])
    .filter((f) => !leagueId || f.league?.id === leagueId)
    .map((f) => ({
      id: f.fixture?.id,
      dateUtc: f.fixture?.date ?? null,
      short: f.fixture?.status?.short ?? null, // NS, 1H, HT, 2H, ET, P, FT, AET, PEN...
      elapsed: f.fixture?.status?.elapsed ?? null,
      home: f.teams?.home?.name,
      away: f.teams?.away?.name,
      goalsHome: f.goals?.home ?? null,
      goalsAway: f.goals?.away ?? null,
    }));
}

/**
 * Generic throttled/cached/budgeted endpoint handler.
 * `fetchUpstream(env)` resolves to the slim array to cache and serve.
 */
async function serve(request, env, ctx, opts) {
  const cors = corsHeaders(env);
  const cache = caches.default;
  const cacheKey = new Request(new URL(request.url).origin + opts.cachePath, { method: 'GET' });

  const cached = await cache.match(cacheKey);
  if (cached) {
    const r = new Response(cached.body, cached);
    for (const [k, v] of Object.entries(cors)) r.headers.set(k, v);
    r.headers.set('x-cache', 'edge');
    return r;
  }

  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);

  let state = null;
  if (env.LIVE_KV) {
    const rawState = await env.LIVE_KV.get(opts.kvKey);
    if (rawState) {
      try { state = JSON.parse(rawState); } catch { state = null; }
    }
  }
  if (!state) state = { matches: [], fetchedAt: 0, date: today, count: 0 };
  if (state.date !== today) { state.date = today; state.count = 0; } // reset at UTC midnight

  const ageS = (now - state.fetchedAt) / 1000;
  let status = 'cache';

  if (ageS >= opts.refreshS) {
    if (state.count >= opts.dailyCap) {
      status = 'budget_capped';
    } else if (!env.APIFOOTBALL_KEY) {
      status = 'no_key';
    } else {
      try {
        const upstream = await opts.fetchUpstream(env);
        if (upstream.ok) {
          const data = await upstream.json();
          // API-Football returns HTTP 200 even on problems (key/param/plan),
          // signalling them in `errors`. Surface that for diagnosis.
          const hasErrors = Array.isArray(data.errors)
            ? data.errors.length > 0
            : data.errors && Object.keys(data.errors).length > 0;
          state = {
            matches: slimFixtures(data, opts.leagueId),
            fetchedAt: now,
            date: today,
            count: state.count + 1,
            upstream: {
              results: data.results ?? (Array.isArray(data.response) ? data.response.length : 0),
              errors: hasErrors ? data.errors : null,
            },
          };
          if (env.LIVE_KV) ctx.waitUntil(env.LIVE_KV.put(opts.kvKey, JSON.stringify(state)));
          status = hasErrors ? 'upstream_errors' : 'fresh';
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
      refreshIntervalSeconds: opts.refreshS,
      budgetRemaining: Math.max(0, opts.dailyCap - state.count),
      status,
      upstream: state.upstream ?? null,
    },
  };

  const resp = json(body, {
    headers: { 'Cache-Control': `public, max-age=${opts.edgeS}`, 'x-cache': 'miss' },
  });
  ctx.waitUntil(cache.put(cacheKey, resp.clone()));
  for (const [k, v] of Object.entries(cors)) resp.headers.set(k, v);
  return resp;
}

export default {
  async fetch(request, env, ctx) {
    const cors = corsHeaders(env);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'GET')
      return json({ error: 'method not allowed' }, { status: 405, headers: cors });

    const league = num(env.WC_LEAGUE_ID, DEFAULTS.LEAGUE);
    const season = num(env.SEASON, DEFAULTS.SEASON);
    const path = new URL(request.url).pathname;

    if (path.endsWith('/fixtures')) {
      return serve(request, env, ctx, {
        cachePath: '/fixtures',
        kvKey: 'fixtures:state',
        refreshS: num(env.FIXTURES_REFRESH_S, DEFAULTS.FIXTURES_REFRESH_S),
        dailyCap: num(env.FIXTURES_DAILY_CAP, DEFAULTS.FIXTURES_DAILY_CAP),
        edgeS: num(env.FIXTURES_EDGE_S, DEFAULTS.FIXTURES_EDGE_S),
        leagueId: 0, // already filtered by the league+season query
        fetchUpstream: (e) => apiGet(e, `/fixtures?league=${league}&season=${season}`),
      });
    }

    // Default + /live: all currently-live matches. We do NOT filter by league
    // id here — the WC 2026 live league id can differ from our guess, and the
    // site pins the right match by team name (both teams must match). This makes
    // the banner robust regardless of how API-Football labels the competition.
    return serve(request, env, ctx, {
      cachePath: '/live',
      kvKey: 'live:state',
      refreshS: num(env.REFRESH_INTERVAL_S, DEFAULTS.LIVE_REFRESH_S),
      dailyCap: num(env.LIVE_DAILY_CAP, DEFAULTS.LIVE_DAILY_CAP),
      edgeS: num(env.EDGE_CACHE_S, DEFAULTS.LIVE_EDGE_S),
      leagueId: 0, // no filter; frontend matches by team name
      fetchUpstream: (e) => apiGet(e, `/fixtures?live=all`),
    });
  },
};
