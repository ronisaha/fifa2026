import { useEffect, useRef, useState } from 'react';

// Optional live-score feed served by the Cloudflare Worker (see /worker).
// When VITE_LIVE_API_URL is unset, live polling is disabled and the UI falls
// back to the periodic data — the feature is fully optional.
const LIVE_API_URL = import.meta.env.VITE_LIVE_API_URL as string | undefined;

// How often the browser polls the Worker. The Worker itself throttles upstream
// API-Football calls (default ~90s) and edge-caches (~30s), so a snappy browser
// interval does NOT increase API-Football usage.
const POLL_MS = 60_000;

export interface LiveMatch {
  id: number;
  short: string | null; // 1H, HT, 2H, ET, P, FT...
  elapsed: number | null;
  home: string;
  away: string;
  goalsHome: number | null;
  goalsAway: number | null;
}

export interface LiveMeta {
  fetchedAt: string | null;
  ageSeconds: number | null;
  refreshIntervalSeconds: number;
  budgetRemaining: number;
  status: string;
}

export interface LiveResponse {
  matches: LiveMatch[];
  meta: LiveMeta;
}

export const liveScoresEnabled = Boolean(LIVE_API_URL);

// Team-name aliases between our data source and API-Football.
const ALIASES: Record<string, string> = {
  usa: 'united states',
  'united states': 'usa',
  'south korea': 'korea republic',
  'korea republic': 'south korea',
  'ivory coast': "cote d'ivoire",
  "cote d'ivoire": 'ivory coast',
  'czech republic': 'czechia',
  czechia: 'czech republic',
  'dr congo': 'congo dr',
  'congo dr': 'dr congo',
};

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z ]/g, '')
    .trim();
}

export function sameTeam(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  return na === nb || ALIASES[na] === nb || ALIASES[nb] === na;
}

/** Find the live fixture (if any) for a given pair of team names, either order. */
export function findLiveFor(
  matches: LiveMatch[] | undefined,
  team1: string,
  team2: string,
): LiveMatch | null {
  if (!matches) return null;
  return (
    matches.find(
      (m) =>
        (sameTeam(m.home, team1) && sameTeam(m.away, team2)) ||
        (sameTeam(m.home, team2) && sameTeam(m.away, team1)),
    ) ?? null
  );
}

/**
 * Poll the live-score Worker while `active` (i.e. a match is in progress).
 * Pauses polling when the tab is hidden to conserve the request budget.
 */
export function useLiveScores(active: boolean): LiveResponse | null {
  const [data, setData] = useState<LiveResponse | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!active || !LIVE_API_URL) {
      setData(null);
      return;
    }

    let stopped = false;
    const poll = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const res = await fetch(LIVE_API_URL, { headers: { accept: 'application/json' } });
        if (res.ok && !stopped) setData((await res.json()) as LiveResponse);
      } catch {
        /* keep last value on transient errors */
      }
    };

    poll();
    timer.current = setInterval(poll, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) poll();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      stopped = true;
      if (timer.current) clearInterval(timer.current);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [active]);

  return data;
}
