import { useMemo, useState } from 'react';
import { getMatches, useData } from '../lib/data';
import { useTz } from '../lib/tz-context';
import { dayKey, formatDateHeading } from '../lib/time';
import type { Match } from '../types';
import MatchCard from '../components/MatchCard';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui';

export default function Results() {
  const { data: matches, loading, error } = useData(getMatches);
  const { tz } = useTz();
  const [query, setQuery] = useState('');

  const byDay = useMemo(() => {
    if (!matches) return [];
    const q = query.trim().toLowerCase();
    const finished = matches
      .filter((m) => m.finished)
      .filter((m) =>
        q ? `${m.team1} ${m.team2} ${m.group ?? ''} ${m.round}`.toLowerCase().includes(q) : true,
      );
    const map = new Map<string, Match[]>();
    for (const m of finished) {
      const key = dayKey(m.kickoff, tz);
      (map.get(key) ?? map.set(key, []).get(key)!).push(m);
    }
    // Most recent first.
    return [...map.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [matches, query, tz]);

  if (loading) return <Spinner />;
  if (error) return <ErrorState error={error} />;

  return (
    <div>
      <PageHeader title="Results" subtitle="Completed matches, latest first">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search team, group…"
          className="w-full max-w-xs rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm focus:border-pitch-500 focus:outline-none"
        />
      </PageHeader>

      {byDay.length === 0 ? (
        <EmptyState message="No results yet. Check back once matches kick off." />
      ) : (
        <div className="space-y-8">
          {byDay.map(([key, dayMatches]) => (
            <section key={key}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
                {formatDateHeading(dayMatches[0].kickoff, tz)}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {dayMatches.map((m) => (
                  <MatchCard key={m.id} match={m} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
