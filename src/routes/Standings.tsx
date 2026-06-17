import { getStandings, useData } from '../lib/data';
import GroupTable from '../components/GroupTable';
import { ErrorState, PageHeader, Spinner } from '../components/ui';

export default function Standings() {
  const { data: standings, loading, error } = useData(getStandings);

  if (loading) return <Spinner />;
  if (error) return <ErrorState error={error} />;
  if (!standings) return null;

  const groups = Object.keys(standings).sort();

  return (
    <div>
      <PageHeader
        title="Group Standings"
        subtitle="Top 2 of each group advance, plus the 8 best third-placed teams"
      />
      <div className="grid gap-5 md:grid-cols-2">
        {groups.map((g) => (
          <GroupTable key={g} group={g} rows={standings[g]} />
        ))}
      </div>
      <p className="mt-4 text-xs text-slate-500">
        Tiebreakers applied: points → goal difference → goals for. Head-to-head and
        fair-play criteria are applied by FIFA where teams remain level.
      </p>
    </div>
  );
}
