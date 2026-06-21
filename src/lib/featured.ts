import type { Match } from '../types';

// A match is considered "live" from kickoff until this many minutes after.
const LIVE_WINDOW_MIN = 135;

export type MatchStatus = 'live' | 'upcoming' | 'finished';

function ms(iso: string | null): number | null {
  return iso ? new Date(iso).getTime() : null;
}

export function matchStatus(match: Match, now = Date.now()): MatchStatus {
  if (match.finished) return 'finished';
  const k = ms(match.kickoff);
  if (k != null && now >= k && now < k + LIVE_WINDOW_MIN * 60_000) return 'live';
  return 'upcoming';
}

/**
 * Pick the match to feature: a currently-live match, otherwise the next
 * upcoming one, otherwise the most recently finished (tournament over).
 */
export function pickFeaturedMatch(matches: Match[], now = Date.now()): Match | null {
  const dated = matches.filter((m) => m.kickoff);

  const live = dated
    .filter((m) => matchStatus(m, now) === 'live')
    .sort((a, b) => ms(a.kickoff)! - ms(b.kickoff)!);
  if (live.length) return live[0];

  const upcoming = dated
    .filter((m) => !m.finished && ms(m.kickoff)! > now)
    .sort((a, b) => ms(a.kickoff)! - ms(b.kickoff)!);
  if (upcoming.length) return upcoming[0];

  const finished = dated
    .filter((m) => m.finished)
    .sort((a, b) => ms(b.kickoff)! - ms(a.kickoff)!);
  return finished[0] ?? null;
}
