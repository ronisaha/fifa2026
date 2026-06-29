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
//   * Schedule gate: /live only spends a budget call when a WC fixture is
//     actually in its live window now. The schedule comes from the site's own
//     public matches.json (free, on GitHub Pages), cached in KV. Between
//     matches the budgeted upstream is never touched.
//   * Each endpoint refreshes upstream at most once per its REFRESH interval,
//     shared across all callers via a single KV record (central cache).
//   * Each endpoint has its OWN daily cap; the caps sum to < 100 so live polling
//     can never starve the fixtures refresh (or vice-versa).
//   * A short edge cache absorbs bursts without touching KV or upstream.
//   * Error responses (rate-limit / plan / non-200) are NEVER cached and never
//     overwrite the last-good scores — they only throttle the next retry.

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
  // Schedule gate (the site's own published fixtures, fetched for free).
  SCHEDULE_URL: 'https://fifa2026.xiidea.net/data/matches.json',
  SCHEDULE_TTL_S: 1800, // re-pull the schedule at most this often
  LIVE_PRE_MIN: 5, // start allowing live calls this long before kickoff
  LIVE_WINDOW_MIN: 150, // ...until this long after kickoff (covers ET + stoppage)
  // Data-refresh cron gate (when to fire the update-data Action).
  DISPATCH_PRE_MIN: 10, // begin dispatching this long before kickoff
  DISPATCH_POST_MIN: 150, // ...through this long after (final result lands here)
  DISPATCH_PENDING_MIN: 360, // keep retrying an unsynced result up to this long after KO
  HEARTBEAT_MIN: 60, // safety net: dispatch at least this often even when idle
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

// ---------------------------------------------------------------------------
// Schedule gate: read the site's own published matches.json (free, GitHub
// Pages) and cache it in KV so we don't re-fetch/parse on every request. Each
// fixture is reduced to { k: kickoffMs, finished }. Fails OPEN only when we
// have never managed to load a schedule (so a transient Pages hiccup can't kill
// live scores or freeze the data cron); a stale cached schedule is fine —
// kickoff times don't move, and `finished` self-heals on the next re-pull.
// ---------------------------------------------------------------------------
async function getScheduleFixtures(env, ctx, now) {
  const ttlMs = num(env.SCHEDULE_TTL_S, DEFAULTS.SCHEDULE_TTL_S) * 1000;

  let sched = null;
  if (env.LIVE_KV) {
    const raw = await env.LIVE_KV.get('schedule:state');
    if (raw) {
      try { sched = JSON.parse(raw); } catch { sched = null; }
    }
  }
  // Reuse cache only if it's fresh AND in the current { fixtures } shape.
  if (sched && Array.isArray(sched.fixtures) && now - sched.fetchedAt < ttlMs) {
    return sched.fixtures;
  }

  const url = env.SCHEDULE_URL || DEFAULTS.SCHEDULE_URL;
  try {
    const r = await fetch(url, {
      headers: { accept: 'application/json' },
      cf: { cacheTtl: num(env.SCHEDULE_TTL_S, DEFAULTS.SCHEDULE_TTL_S) },
    });
    if (r.ok) {
      const arr = await r.json();
      const fixtures = (Array.isArray(arr) ? arr : [])
        .map((m) => ({ k: m && m.kickoff ? Date.parse(m.kickoff) : NaN, finished: !!(m && m.finished) }))
        .filter((f) => Number.isFinite(f.k));
      const next = { fetchedAt: now, fixtures };
      if (env.LIVE_KV) ctx.waitUntil(env.LIVE_KV.put('schedule:state', JSON.stringify(next)));
      return fixtures;
    }
  } catch {
    /* fall through to stale */
  }
  return sched && Array.isArray(sched.fixtures) ? sched.fixtures : null; // null => unknown => fail open
}

async function anyFixtureLive(env, ctx, now) {
  const fixtures = await getScheduleFixtures(env, ctx, now);
  if (!fixtures) return true; // unknown schedule: allow the call (fail open)
  const pre = num(env.LIVE_PRE_MIN, DEFAULTS.LIVE_PRE_MIN) * 60_000;
  const win = num(env.LIVE_WINDOW_MIN, DEFAULTS.LIVE_WINDOW_MIN) * 60_000;
  return fixtures.some(({ k }) => now >= k - pre && now < k + win);
}

// Should the data-refresh cron dispatch now? Only when something could have
// changed since the last sync, i.e. some fixture is:
//   * in its active window  [kickoff - pre, kickoff + post]  (kickoff status +
//     final result land here), or
//   * started but still NOT marked finished in our published data — keep
//     dispatching until the result syncs from upstream, bounded by a catch-up
//     window so a never-settling fixture can't loop forever.
// Between matches (everything synced, next kickoff still far off) this is false,
// so the Action isn't triggered at all. Fails OPEN if the schedule is unknown.
async function shouldDispatch(env, ctx, now) {
  const fixtures = await getScheduleFixtures(env, ctx, now);
  if (!fixtures) return true; // unknown schedule: dispatch (fail open)
  const pre = num(env.DISPATCH_PRE_MIN, DEFAULTS.DISPATCH_PRE_MIN) * 60_000;
  const post = num(env.DISPATCH_POST_MIN, DEFAULTS.DISPATCH_POST_MIN) * 60_000;
  const pending = num(env.DISPATCH_PENDING_MIN, DEFAULTS.DISPATCH_PENDING_MIN) * 60_000;
  return fixtures.some(({ k, finished }) => {
    if (now >= k - pre && now < k + post) return true; // active window
    return now >= k && !finished && now < k + pending; // result overdue, not yet synced
  });
}

/**
 * Generic throttled/cached/budgeted endpoint handler.
 * `fetchUpstream(env)` resolves to the upstream Response.
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
  let cacheable = true; // error responses set this false (never cached)

  // Bump fetchedAt (and persist) so a failed attempt waits a full refresh
  // interval before retrying — without disturbing the last-good matches.
  const throttle = (extra = {}) => {
    state = { ...state, fetchedAt: now, ...extra };
    if (env.LIVE_KV) ctx.waitUntil(env.LIVE_KV.put(opts.kvKey, JSON.stringify(state)));
  };

  if (ageS >= opts.refreshS) {
    if (opts.gateLive && !(await anyFixtureLive(env, ctx, now))) {
      // No WC fixture in its live window — don't spend a budget call at all.
      status = 'idle_no_fixture';
    } else if (state.count >= opts.dailyCap) {
      status = 'budget_capped';
    } else if (!env.APIFOOTBALL_KEY) {
      status = 'no_key';
    } else {
      try {
        const upstream = await opts.fetchUpstream(env);
        if (upstream.ok) {
          const data = await upstream.json();
          // API-Football returns HTTP 200 even on problems (key/param/plan/rate),
          // signalling them in `errors`. Treat those as failures: do NOT replace
          // the last-good matches, and do NOT cache the response.
          const hasErrors = Array.isArray(data.errors)
            ? data.errors.length > 0
            : data.errors && Object.keys(data.errors).length > 0;
          const results = data.results ?? (Array.isArray(data.response) ? data.response.length : 0);
          if (hasErrors) {
            throttle({ count: state.count + 1, upstream: { results, errors: data.errors } });
            status = 'upstream_errors';
            cacheable = false;
          } else {
            state = {
              matches: slimFixtures(data, opts.leagueId),
              fetchedAt: now,
              date: today,
              count: state.count + 1,
              upstream: { results, errors: null },
            };
            if (env.LIVE_KV) ctx.waitUntil(env.LIVE_KV.put(opts.kvKey, JSON.stringify(state)));
            status = 'fresh';
          }
        } else {
          // Non-200 (e.g. 429/5xx): keep last-good matches, throttle, don't cache.
          throttle({ count: state.count + 1 });
          status = `upstream_${upstream.status}`;
          cacheable = false;
        }
      } catch {
        // Network error: throttle the retry but don't spend a budget tick.
        throttle();
        status = 'upstream_error';
        cacheable = false;
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
    headers: cacheable
      ? { 'Cache-Control': `public, max-age=${opts.edgeS}`, 'x-cache': 'miss' }
      : { 'Cache-Control': 'no-store', 'x-cache': 'miss' },
  });
  if (cacheable) ctx.waitUntil(cache.put(cacheKey, resp.clone()));
  for (const [k, v] of Object.entries(cors)) resp.headers.set(k, v);
  return resp;
}

// ---------------------------------------------------------------------------
// Cron trigger: reliably drive the data-refresh GitHub Action.
//
// GitHub throttles `schedule:` crons heavily (a */10 cron really fires ~hourly),
// so we POST workflow_dispatch on Cloudflare's own cron instead — Cloudflare
// honours the interval precisely. A schedule gate (shouldDispatch) skips ticks
// when nothing could have changed — i.e. between matches, once all results are
// synced — so the Action only runs around fixtures. A low-frequency heartbeat
// (HEARTBEAT_MIN) still dispatches at least once per interval even when idle, so
// schedule-only changes outside any match window are eventually picked up.
// Requires GH_DISPATCH_TOKEN (a PAT with Actions: read+write on the repo).
// ---------------------------------------------------------------------------
async function dispatchDataRefresh(env, reason) {
  const repo = env.GH_REPO;
  const token = env.GH_DISPATCH_TOKEN;
  if (!repo || !token) {
    console.log('cron: skipped (GH_REPO or GH_DISPATCH_TOKEN not set)');
    return false;
  }
  const workflow = env.GH_WORKFLOW || 'update-data.yml';
  const ref = env.GH_REF || 'main';
  const url = `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'wc2026-live-scores-cron',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ref }),
    });
    // GitHub returns 204 No Content on success.
    if (r.status === 204) {
      console.log(`cron: dispatched ${workflow}@${ref} (${reason})`);
      return true;
    }
    console.log(`cron: dispatch failed ${r.status} ${await r.text()}`);
  } catch (err) {
    console.log(`cron: dispatch error ${err}`);
  }
  return false;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        const now = Date.now();

        // Decide whether to fire: an active fixture window, otherwise a
        // heartbeat if we haven't dispatched in HEARTBEAT_MIN.
        let reason = (await shouldDispatch(env, ctx, now)) ? 'fixture active' : null;
        if (!reason) {
          const heartbeatMs = num(env.HEARTBEAT_MIN, DEFAULTS.HEARTBEAT_MIN) * 60_000;
          let last = 0;
          if (env.LIVE_KV) {
            const raw = await env.LIVE_KV.get('cron:lastDispatch');
            const t = Number(raw);
            if (Number.isFinite(t)) last = t;
          }
          if (now - last >= heartbeatMs) reason = 'heartbeat';
        }

        if (!reason) {
          console.log('cron: skipped dispatch (no active fixture; data already synced)');
          return;
        }

        // Reset the heartbeat clock on any successful dispatch (active or
        // heartbeat) so the next heartbeat is HEARTBEAT_MIN after this one.
        if ((await dispatchDataRefresh(env, reason)) && env.LIVE_KV) {
          ctx.waitUntil(env.LIVE_KV.put('cron:lastDispatch', String(now)));
        }
      })(),
    );
  },

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
        leagueId: 1, // already filtered by the league+season query
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
      gateLive: true, // only spend budget when a WC fixture is actually live
      fetchUpstream: (e) => apiGet(e, `/fixtures?live=all`),
    });
  },
};
