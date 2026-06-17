import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getMatches, getStandings, getTeams, useData } from '../lib/data';
import MatchCard from '../components/MatchCard';
import { ErrorState, PageHeader, Spinner } from '../components/ui';

export default function Team() {
  const { slug } = useParams<{ slug: string }>();
  const { data: teams, loading: lt, error: et } = useData(getTeams);
  const { data: matches, loading: lm, error: em } = useData(getMatches);
  const { data: standings, loading: ls } = useData(getStandings);

  const team = useMemo(
    () => teams?.find((t) => t.slug === slug) ?? null,
    [teams, slug],
  );

  const teamMatches = useMemo(
    () =>
      (matches ?? [])
        .filter((m) => m.team1Slug === slug || m.team2Slug === slug)
        .sort((a, b) => (a.kickoff ?? '').localeCompare(b.kickoff ?? '')),
    [matches, slug],
  );

  const standingRow = useMemo(() => {
    if (!team?.group || !standings) return null;
    return standings[team.group]?.find((r) => r.slug === slug) ?? null;
  }, [team, standings, slug]);

  if (lt || lm || ls) return <Spinner />;
  if (et) return <ErrorState error={et} />;
  if (em) return <ErrorState error={em} />;

  if (!team) {
    return (
      <div>
        <PageHeader title="Team not found" />
        <Link to="/" className="text-pitch-400 hover:underline">
          ← Back to schedule
        </Link>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={`${team.flag} ${team.name}`}
        subtitle={team.group ? `${team.group}` : 'Knockout stage'}
      />

      {standingRow && (
        <div className="card mb-6 flex flex-wrap gap-x-6 gap-y-2 p-4 text-sm">
          <span>
            <span className="text-slate-400">Position: </span>
            <span className="font-semibold">
              {standingRow.rank} in {team.group}
            </span>
          </span>
          <span>
            <span className="text-slate-400">Points: </span>
            <span className="font-semibold">{standingRow.points}</span>
          </span>
          <span className="text-slate-400">
            {standingRow.won}W · {standingRow.draw}D · {standingRow.lost}L
          </span>
          <span className="text-slate-400">
            GF {standingRow.gf} · GA {standingRow.ga} · GD{' '}
            {standingRow.gd > 0 ? `+${standingRow.gd}` : standingRow.gd}
          </span>
        </div>
      )}

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
        Matches
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {teamMatches.map((m) => (
          <MatchCard key={m.id} match={m} />
        ))}
      </div>

      <div className="mt-8">
        <Link to="/" className="text-sm text-pitch-400 hover:underline">
          ← Back to schedule
        </Link>
      </div>
    </div>
  );
}
