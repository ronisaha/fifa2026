import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { getAvatars, getMatches, useData } from '../lib/data';
import { computeScorers, eliminatedTeams, withRanks } from '../lib/scorers';
import FlagImg from '../components/FlagImg';
import PlayerAvatar from '../components/PlayerAvatar';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui';

const MEDAL = ['🥇', '🥈', '🥉'];

export default function GoldenBoot() {
  const { data: matches, loading, error } = useData(getMatches);
  // Avatars are a best-effort enrichment: if the file is missing/errors, every
  // player simply falls back to an initials monogram.
  const { data: avatars } = useData(getAvatars);

  // Trim the tail: once a team is out, only keep its scorers if they're still
  // Golden Boot contenders (>= this many goals). Alive teams' scorers all stay.
  const KEEP_MIN_GOALS = 3;

  const rows = useMemo(() => {
    if (!matches) return [];
    const out = eliminatedTeams(matches);
    const kept = computeScorers(matches).filter(
      (r) => r.goals >= KEEP_MIN_GOALS || !out.has(r.team),
    );
    return withRanks(kept);
  }, [matches]);

  if (loading) return <Spinner />;
  if (error) return <ErrorState error={error} />;

  const totalGoals = rows.reduce((n, r) => n + r.goals, 0);

  return (
    <div>
      <PageHeader
        title="Golden Boot"
        subtitle="Top scorers of the FIFA World Cup 2026"
      />

      {rows.length === 0 ? (
        <EmptyState message="No goals scored yet." />
      ) : (
        <>
          <div className="card overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-400">
                  <th className="w-12 py-3 pl-4 text-left font-medium">#</th>
                  <th className="py-3 text-left font-medium">Player</th>
                  <th className="hidden py-3 text-right font-medium sm:table-cell">Matches</th>
                  <th className="py-3 pr-4 text-right font-medium">Goals</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isTop = r.rank === 1;
                  return (
                    <tr
                      key={`${r.name}-${r.team}`}
                      className={`border-b border-slate-800/60 last:border-0 ${
                        isTop ? 'bg-amber-500/5' : ''
                      }`}
                    >
                      <td className="py-2.5 pl-4 text-left tabular-nums text-slate-400">
                        {r.rank <= 3 ? (
                          <span className="text-base">{MEDAL[r.rank - 1]}</span>
                        ) : (
                          r.rank
                        )}
                      </td>
                      <td className="py-2.5">
                        <div className="flex items-center gap-3">
                          <div className="relative shrink-0">
                            <PlayerAvatar name={r.name} photo={avatars?.[r.name]?.photo} size={40} />
                            <FlagImg
                              emoji={r.flag}
                              name={r.team}
                              width={48}
                              className="absolute -bottom-0.5 -right-1 h-3.5 w-5 rounded-sm ring-1 ring-slate-900"
                            />
                          </div>
                          <div className="min-w-0">
                            <div className={`truncate ${isTop ? 'font-semibold text-white' : ''}`}>
                              {r.name}
                            </div>
                            <div className="text-xs text-slate-500">
                              {r.teamSlug ? (
                                <Link to={`/team/${r.teamSlug}`} className="hover:text-pitch-400">
                                  {r.team}
                                </Link>
                              ) : (
                                r.team
                              )}
                              {r.penalties > 0 && (
                                <span className="ml-2 text-slate-600">
                                  · {r.penalties} pen{r.penalties > 1 ? 's' : ''}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="hidden py-2.5 text-right tabular-nums text-slate-400 sm:table-cell">
                        {r.matches}
                      </td>
                      <td className="py-2.5 pr-4 text-right">
                        <span
                          className={`text-lg font-bold tabular-nums ${
                            isTop ? 'text-amber-400' : 'text-white'
                          }`}
                        >
                          {r.goals}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-xs text-slate-500">
            {rows.length} scorers · {totalGoals} goals. Own goals are excluded and
            penalties counted, per Golden Boot rules. Where players are level on goals,
            fewer penalties then fewer matches rank higher (FIFA’s assists /
            minutes-played tiebreakers aren’t in the data feed). Once a team is
            eliminated, its scorers with fewer than {KEEP_MIN_GOALS} goals drop off
            the board. Player photos via{' '}
            <a
              href="https://commons.wikimedia.org/"
              className="underline hover:text-slate-300"
              target="_blank"
              rel="noreferrer"
            >
              Wikimedia Commons
            </a>
            ; players without a freely-licensed photo show their initials.
          </p>
        </>
      )}
    </div>
  );
}
