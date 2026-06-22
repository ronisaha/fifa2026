// Cloudflare Worker: BALLDONTLIE FIFA World Cup gateway for the WC 2026 site.
//
// Two endpoints served from ONE shared cache:
//   GET /live      -> in-progress matches (polled by the browser banner/cards).
//   GET /fixtures  -> all season matches with scores (polled by the GitHub
//                     Action to overlay authoritative finished results).
//
// Why a Worker: the upstream needs a secret key and isn't CORS-enabled, so the
// static browser app can't call it directly.
//
// Budget safety: BALLDONTLIE's free tier limit is 5 requests/MINUTE. A single
// `/matches?seasons[]=2026` call returns the whole tournament, so we fetch it
// once and refresh at most every REFRESH_S (default 90s ≈ 0.7 req/min, well
// under 5/min) — shared across all visitors and both endpoints via one KV
// record. A short edge cache absorbs bursts. Pagination (104 > 100/page) adds at
// most one extra request per refresh.

const API_BASE = 'https://api.balldontlie.io/fifa/worldcup/v1';

const DEFAULTS = {
  SEASON: 2026,
  REFRESH_S: 90,
  EDGE_S: 30,
  DAILY_CAP: 2000, // backstop only; the real limiter is REFRESH_S vs 5/min
  MAX_PAGES: 4,
};

// BALLDONTLIE status -> normalized status used by the site/overlay.
const STATUS_NORM = {
  completed: 'finished',
  in_progress: 'live',
  scheduled: 'scheduled',
  postponed: 'postponed',
  cancelled: 'cancelled',
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

function slim(m) {
  const clock = m.clock_display ?? null;
  return {
    id: m.id,
    short: STATUS_NORM[m.status] || 'other', // finished | live | scheduled | ...
    rawStatus: m.status ?? null,
    elapsed: clock ? parseInt(clock, 10) : null,
    clock,
    dateUtc: m.datetime ?? null,
    home: m.home_team?.name ?? null,
    away: m.away_team?.name ?? null,
    goalsHome: m.home_score ?? null,
    goalsAway: m.away_score ?? null,
  };
}

// Fetch all season matches, following cursor pagination.
async function fetchAllMatches(env, season, maxPages) {
  const out = [];
  let cursor = null;
  let pages = 0;
  do {
    const url = new URL(`${API_BASE}/matches`);
    url.searchParams.append('seasons[]', String(season));
    url.searchParams.set('per_page', '100');
    if (cursor) url.searchParams.set('cursor', String(cursor));
    const res = await fetch(url, {
      headers: { Authorization: env.BALLDONTLIE_KEY, accept: 'application/json' },
      cf: { cacheTtl: 0 },
    });
    if (!res.ok) {
      let detail = null;
      try { detail = await res.json(); } catch { /* non-JSON */ }
      return { ok: false, status: res.status, errors: detail?.error ?? detail ?? `HTTP ${res.status}` };
    }
    const data = await res.json();
    const rows = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    out.push(...rows);
    cursor = data?.meta?.next_cursor ?? null;
    pages += 1;
  } while (cursor && pages < maxPages);
  return { ok: true, matches: out };
}

// Refresh (or reuse) the single shared KV record of all matches.
async function getSharedState(env, ctx, cfg) {
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);

  let state = null;
  if (env.LIVE_KV) {
    const raw = await env.LIVE_KV.get('wc:state');
    if (raw) {
      try { state = JSON.parse(raw); } catch { state = null; }
    }
  }
  if (!state) state = { matches: [], fetchedAt: 0, date: today, count: 0, upstream: null };
  if (state.date !== today) { state.date = today; state.count = 0; }

  const ageS = (now - state.fetchedAt) / 1000;
  state.status = 'cache';

  if (ageS >= cfg.refreshS) {
    if (state.count >= cfg.dailyCap) {
      state.status = 'budget_capped';
    } else if (!env.BALLDONTLIE_KEY) {
      state.status = 'no_key';
    } else {
      const result = await fetchAllMatches(env, cfg.season, cfg.maxPages);
      if (result.ok) {
        state = {
          matches: result.matches.map(slim),
          fetchedAt: now,
          date: today,
          count: state.count + 1,
          upstream: { results: result.matches.length, errors: null },
          status: 'fresh',
        };
        if (env.LIVE_KV) ctx.waitUntil(env.LIVE_KV.put('wc:state', JSON.stringify(state)));
      } else {
        state.status = `upstream_${result.status}`;
        state.upstream = { results: 0, errors: result.errors };
      }
    }
  }
  return state;
}

export default {
  async fetch(request, env, ctx) {
    const cors = corsHeaders(env);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'GET')
      return json({ error: 'method not allowed' }, { status: 405, headers: cors });

    const cfg = {
      season: num(env.SEASON, DEFAULTS.SEASON),
      refreshS: num(env.REFRESH_S, DEFAULTS.REFRESH_S),
      edgeS: num(env.EDGE_S, DEFAULTS.EDGE_S),
      dailyCap: num(env.DAILY_CAP, DEFAULTS.DAILY_CAP),
      maxPages: num(env.MAX_PAGES, DEFAULTS.MAX_PAGES),
    };

    const isFixtures = new URL(request.url).pathname.endsWith('/fixtures');
    const cachePath = isFixtures ? '/fixtures' : '/live';

    // Edge cache short-circuit.
    const cache = caches.default;
    const cacheKey = new Request(new URL(request.url).origin + cachePath, { method: 'GET' });
    const cached = await cache.match(cacheKey);
    if (cached) {
      const r = new Response(cached.body, cached);
      for (const [k, v] of Object.entries(cors)) r.headers.set(k, v);
      r.headers.set('x-cache', 'edge');
      return r;
    }

    const state = await getSharedState(env, ctx, cfg);

    // /fixtures = everything; /live = in-progress only.
    const matches = isFixtures ? state.matches : state.matches.filter((m) => m.short === 'live');

    const body = {
      matches,
      meta: {
        fetchedAt: state.fetchedAt ? new Date(state.fetchedAt).toISOString() : null,
        ageSeconds: state.fetchedAt ? Math.round((Date.now() - state.fetchedAt) / 1000) : null,
        refreshIntervalSeconds: cfg.refreshS,
        budgetRemaining: Math.max(0, cfg.dailyCap - state.count),
        status: state.status,
        upstream: state.upstream ?? null,
      },
    };

    const resp = json(body, {
      headers: { 'Cache-Control': `public, max-age=${cfg.edgeS}`, 'x-cache': 'miss' },
    });
    ctx.waitUntil(cache.put(cacheKey, resp.clone()));
    for (const [k, v] of Object.entries(cors)) resp.headers.set(k, v);
    return resp;
  },
};
