// Cloudflare Worker: worldcup26.ir gateway for the WC 2026 site.
//
// Two endpoints served from ONE shared cache:
//   GET /live      -> in-progress matches (polled by the browser banner/cards).
//   GET /fixtures  -> all matches with scores (polled by the GitHub Action to
//                     overlay finished results).
//
// Upstream: the community API at worldcup26.ir (free, no API key, CORS-enabled).
// We still front it with a Worker for central caching (so we don't hammer a
// hobby server from every visitor), the /fixtures shape, and diagnostics.
//
// NOTE: whether this upstream streams true in-match live data (score + minute
// while a game is in play) is unverified; if it only flips notstarted->finished,
// /live simply stays empty and the site falls back to periodic results.

const API_BASE = 'https://worldcup26.ir';

const DEFAULTS = {
  REFRESH_S: 90, // one upstream fetch per 90s, shared across visitors/endpoints
  EDGE_S: 30,
  DAILY_CAP: 2000, // backstop only
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

const parseScore = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

// Normalize the upstream status into: finished | live | scheduled.
function normStatus(g) {
  const finished = String(g.finished).toUpperCase() === 'TRUE';
  const te = String(g.time_elapsed ?? '').toLowerCase();
  if (finished || te === 'finished') return 'finished';
  if (te && te !== 'notstarted') return 'live';
  return 'scheduled';
}

// "06/11/2026 13:00" (MM/DD/YYYY) -> ISO-ish (tz unknown; used only as a tiebreak
// in team-name matching, so the date part is what matters).
function toIso(local) {
  if (!local) return null;
  const m = String(local).match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const [, mm, dd, yyyy, hh = '00', mi = '00'] = m;
  return `${yyyy}-${mm}-${dd}T${hh.padStart(2, '0')}:${mi}:00Z`;
}

function slim(g) {
  const short = normStatus(g);
  const started = short !== 'scheduled';
  const elapsed = /^\d+$/.test(String(g.time_elapsed)) ? parseInt(g.time_elapsed, 10) : null;
  return {
    id: g.id,
    short, // finished | live | scheduled
    rawStatus: g.time_elapsed ?? null,
    elapsed,
    clock: g.time_elapsed ?? null,
    dateUtc: toIso(g.local_date),
    home: g.home_team_name_en ?? null,
    away: g.away_team_name_en ?? null,
    goalsHome: started ? parseScore(g.home_score) : null,
    goalsAway: started ? parseScore(g.away_score) : null,
  };
}

async function fetchAllMatches(env) {
  const res = await fetch(`${API_BASE}/get/games`, {
    headers: { accept: 'application/json' },
    cf: { cacheTtl: 0 },
  });
  if (!res.ok) {
    let detail = null;
    try { detail = await res.text(); } catch { /* ignore */ }
    return { ok: false, status: res.status, errors: detail?.slice(0, 200) || `HTTP ${res.status}` };
  }
  const data = await res.json();
  const rows = Array.isArray(data?.games) ? data.games : Array.isArray(data) ? data : [];
  return { ok: true, matches: rows };
}

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
    } else {
      const result = await fetchAllMatches(env);
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
      refreshS: num(env.REFRESH_S, DEFAULTS.REFRESH_S),
      edgeS: num(env.EDGE_S, DEFAULTS.EDGE_S),
      dailyCap: num(env.DAILY_CAP, DEFAULTS.DAILY_CAP),
    };

    const isFixtures = new URL(request.url).pathname.endsWith('/fixtures');
    const cachePath = isFixtures ? '/fixtures' : '/live';

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
