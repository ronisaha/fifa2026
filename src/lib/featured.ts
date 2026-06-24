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
 * Pick the group of matches to feature, handling overlapping kickoffs:
 *   - every match currently live (they all overlap "now"), else
 *   - every upcoming match sharing the next kickoff slot, else
 *   - every match sharing the most-recent kickoff slot (tournament over).
 * Returns [] when there are no dated matches. Sorted by kickoff.
 */
export function pickFeaturedMatches(matches: Match[], now = Date.now()): Match[] {
  const dated = matches.filter((m) => m.kickoff);

  const live = dated
    .filter((m) => matchStatus(m, now) === 'live')
    .sort((a, b) => ms(a.kickoff)! - ms(b.kickoff)!);
  if (live.length) return live;

  const upcoming = dated
    .filter((m) => !m.finished && ms(m.kickoff)! > now)
    .sort((a, b) => ms(a.kickoff)! - ms(b.kickoff)!);
  if (upcoming.length) {
    const first = ms(upcoming[0].kickoff)!;
    return upcoming.filter((m) => ms(m.kickoff)! === first);
  }

  const finished = dated
    .filter((m) => m.finished)
    .sort((a, b) => ms(b.kickoff)! - ms(a.kickoff)!);
  if (finished.length) {
    const last = ms(finished[0].kickoff)!;
    return finished.filter((m) => ms(m.kickoff)! === last);
  }
  return [];
}

/** Single-match convenience wrapper around {@link pickFeaturedMatches}. */
export function pickFeaturedMatch(matches: Match[], now = Date.now()): Match | null {
  return pickFeaturedMatches(matches, now)[0] ?? null;
}
