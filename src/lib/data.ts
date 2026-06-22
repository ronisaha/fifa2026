import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Bracket, Groups, Match, Meta, Standings, Team } from '../types';

const BASE = import.meta.env.BASE_URL;

// ---------------------------------------------------------------------------
// Static data cache + auto-refresh.
//
// The JSON files are served from GitHub Pages (our own origin), NOT from
// the live API — so re-fetching them costs nothing against the API budget. We
// poll the tiny meta.json and, only when its `lastUpdated` changes, invalidate
// the cache and reload, cache-busted by the new version so the CDN/browser
// serve fresh content. This lets open tabs update without a manual reload.
// ---------------------------------------------------------------------------

const cache = new Map<string, Promise<unknown>>();

// Cache-busting token appended to data URLs; set to meta.lastUpdated so a new
// deploy yields new URLs (bypassing any stale CDN/browser cache).
let dataVersion = '';

function load<T>(file: string): Promise<T> {
  const url = `${BASE}data/${file}${dataVersion ? `?v=${encodeURIComponent(dataVersion)}` : ''}`;
  let p = cache.get(url) as Promise<T> | undefined;
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`Failed to load ${file}: ${r.status}`);
      return r.json() as Promise<T>;
    });
    cache.set(url, p);
  }
  return p;
}

export const getMatches = () => load<Match[]>('matches.json');
export const getTeams = () => load<Team[]>('teams.json');
export const getGroups = () => load<Groups>('groups.json');
export const getStandings = () => load<Standings>('standings.json');
export const getBracket = () => load<Bracket>('bracket.json');
export const getMeta = () => load<Meta>('meta.json');

// --- version store (drives useData refetch via useSyncExternalStore) ---------
let version = 0;
const listeners = new Set<() => void>();
const subscribeVersion = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
const getVersion = () => version;

/** Apply a newly-detected data version: bust the cache and notify consumers. */
function applyNewVersion(lastUpdated: string) {
  dataVersion = lastUpdated;
  cache.clear();
  version += 1;
  listeners.forEach((l) => l());
}

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

/** Loads a static JSON resource, re-fetching when the data version changes. */
export function useData<T>(loader: () => Promise<T>): AsyncState<T> {
  const v = useSyncExternalStore(subscribeVersion, getVersion, getVersion);
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let active = true;
    loader()
      .then((data) => active && setState({ data, loading: false, error: null }))
      .catch((error: Error) => active && setState({ data: null, loading: false, error }));
    return () => {
      active = false;
    };
    // loaders are stable module-level fns; re-run when the data version changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);

  return state;
}

// How often to check meta.json for a new deploy. Data changes at most every
// ~30 min (the pipeline cadence), so a few minutes is plenty. This hits our own
// static CDN only — no the live API cost.
const META_POLL_MS = 180_000;

/**
 * Mount once (in App): periodically checks meta.json and live-refreshes the data
 * when a new version is published, without a page reload. Pauses on hidden tabs
 * and re-checks immediately when the tab becomes visible again.
 */
export function useAutoRefresh(): void {
  const lastSeen = useRef<string | null>(null);

  useEffect(() => {
    let stopped = false;

    const check = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const res = await fetch(`${BASE}data/meta.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok || stopped) return;
        const meta = (await res.json()) as Meta;
        const lu = meta.lastUpdated;
        if (!lu) return;
        if (lastSeen.current === null) {
          // First sighting: align the cache-busting token, don't force a reload
          // (initial loads already fetched current data).
          lastSeen.current = lu;
          if (!dataVersion) dataVersion = lu;
          return;
        }
        if (lu !== lastSeen.current) {
          lastSeen.current = lu;
          applyNewVersion(lu); // triggers refetch of all useData consumers
        }
      } catch {
        /* ignore transient errors; try again next tick */
      }
    };

    check();
    const id = setInterval(check, META_POLL_MS);
    const onVisible = () => {
      if (!document.hidden) check();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
}
