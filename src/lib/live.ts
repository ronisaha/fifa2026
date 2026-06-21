// Optional live-score feed served by the Cloudflare Worker (see /worker).
// When VITE_LIVE_API_URL is unset, live polling is disabled and the UI falls
// back to the periodic data — the feature is fully optional.
const LIVE_API_URL = import.meta.env.VITE_LIVE_API_URL as string | undefined;

export const liveScoresEnabled = Boolean(LIVE_API_URL);

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
  upstream?: { results: number; errors: unknown } | null;
}

export interface LiveResponse {
  matches: LiveMatch[];
  meta: LiveMeta;
}

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

/** Live goals oriented to `team1`/team2 order (the feed may be home/away swapped). */
export function liveGoals(team1: string, live: LiveMatch): [number, number] | null {
  if (live.goalsHome == null || live.goalsAway == null) return null;
  return sameTeam(live.home, team1)
    ? [live.goalsHome, live.goalsAway]
    : [live.goalsAway, live.goalsHome];
}

/** One-shot fetch of the live feed. Returns null when disabled or on error. */
export async function fetchLive(): Promise<LiveResponse | null> {
  if (!LIVE_API_URL) return null;
  try {
    const res = await fetch(LIVE_API_URL, { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    return (await res.json()) as LiveResponse;
  } catch {
    return null;
  }
}
