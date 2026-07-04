import type { Match } from '../types';

export interface ScorerRow {
  name: string;
  team: string;
  teamSlug: string | null;
  flag: string;
  goals: number; // Golden Boot tally (own goals excluded)
  penalties: number; // of which scored from the spot, in open play
  matches: number; // distinct matches the player scored in
}

/**
 * Fold finished matches into a ranked Golden Boot table.
 *
 * Own goals are excluded (they don't count for the scorer), and in-play
 * penalties are counted but tracked separately. Shoot-out penalties live in
 * `score.p`, never in `goals1/goals2`, so they're correctly ignored.
 *
 * Ranking: goals ↓, then fewer penalties (more open-play goals ranks higher),
 * then fewer matches (efficiency), then name. FIFA's official assists /
 * minutes-played tiebreakers aren't in the feed, so these are our best proxies.
 */
export function computeScorers(matches: Match[]): ScorerRow[] {
  const map = new Map<string, ScorerRow & { seen: Set<number> }>();

  for (const m of matches) {
    if (!m.finished) continue;
    const sides = [
      { goals: m.goals1, team: m.team1, slug: m.team1Slug, flag: m.team1Flag },
      { goals: m.goals2, team: m.team2, slug: m.team2Slug, flag: m.team2Flag },
    ];
    for (const side of sides) {
      for (const g of side.goals ?? []) {
        if (g.owngoal) continue; // Golden Boot excludes own goals
        const name = g.name?.trim();
        if (!name) continue;
        const key = `${name}::${side.team}`;
        let row = map.get(key);
        if (!row) {
          row = {
            name,
            team: side.team,
            teamSlug: side.slug,
            flag: side.flag,
            goals: 0,
            penalties: 0,
            matches: 0,
            seen: new Set<number>(),
          };
          map.set(key, row);
        }
        row.goals += 1;
        if (g.penalty) row.penalties += 1;
        row.seen.add(m.num);
      }
    }
  }

  return [...map.values()]
    .map(({ seen, ...r }) => ({ ...r, matches: seen.size }))
    .sort(
      (a, b) =>
        b.goals - a.goals ||
        a.penalties - b.penalties ||
        a.matches - b.matches ||
        a.name.localeCompare(b.name),
    );
}

// Knockout placeholder codes ("W89", "L74", "1A", "3A/B/C/D/F") — not real teams.
const PLACEHOLDER = /^[WL]\d+$|^[1-3][A-L]?(\/[A-L])*$/;

/**
 * Teams knocked out of the tournament: a real team with no remaining
 * (unfinished) fixture. The champion — winner of a finished Final — is guarded
 * out, since they have no future match yet aren't eliminated.
 */
export function eliminatedTeams(matches: Match[]): Set<string> {
  const real = new Set<string>();
  const alive = new Set<string>();
  for (const m of matches) {
    if (!PLACEHOLDER.test(m.team1)) real.add(m.team1);
    if (!PLACEHOLDER.test(m.team2)) real.add(m.team2);
    if (!m.finished) {
      alive.add(m.team1);
      alive.add(m.team2);
    }
  }

  let champion: string | null = null;
  const final = matches.find((m) => m.round === 'Final' && m.finished && m.score);
  if (final?.score) {
    const d = final.score.p ?? final.score.et ?? final.score.ft;
    champion = d[0] > d[1] ? final.team1 : final.team2;
  }

  const out = new Set<string>();
  for (const t of real) if (!alive.has(t) && t !== champion) out.add(t);
  return out;
}

/** Dense rank by goals: players level on goals share a rank (1, 1, 3, …). */
export function withRanks(rows: ScorerRow[]): (ScorerRow & { rank: number })[] {
  let rank = 0;
  let prevGoals = -1;
  return rows.map((r, i) => {
    if (r.goals !== prevGoals) {
      rank = i + 1;
      prevGoals = r.goals;
    }
    return { ...r, rank };
  });
}
