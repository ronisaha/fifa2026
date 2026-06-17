import { useMemo, useState } from 'react';
import { getMatches, useData } from '../lib/data';
import { useTz } from '../lib/tz-context';
import { dayKey, formatDateHeading } from '../lib/time';
import type { Match } from '../types';
import MatchCard from '../components/MatchCard';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui';

const STAGE_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'group', label: 'Group stage' },
  { value: 'knockout', label: 'Knockout' },
  { value: 'upcoming', label: 'Upcoming' },
];

export default function Schedule() {
  const { data: matches, loading, error } = useData(getMatches);
  const { tz } = useTz();
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('all');
  const [stage, setStage] = useState('all');

  const groups = useMemo(() => {
    if (!matches) return [];
    return [...new Set(matches.map((m) => m.group).filter(Boolean))].sort() as string[];
  }, [matches]);

  const filtered = useMemo(() => {
    if (!matches) return [];
    const q = query.trim().toLowerCase();
    const now = Date.now();
    return matches.filter((m) => {
      if (group !== 'all' && m.group !== group) return false;
      if (stage === 'group' && m.stage !== 'group') return false;
      if (stage === 'knockout' && m.stage !== 'knockout') return false;
      if (stage === 'upcoming' && (m.finished || (m.kickoff && new Date(m.kickoff).getTime() < now)))
        return false;
      if (q) {
        const hay = `${m.team1} ${m.team2} ${m.venue ?? ''} ${m.round} ${m.group ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [matches, query, group, stage]);

  const byDay = useMemo(() => {
    const map = new Map<string, Match[]>();
    for (const m of filtered) {
      const key = dayKey(m.kickoff, tz);
      (map.get(key) ?? map.set(key, []).get(key)!).push(m);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtered, tz]);

  if (loading) return <Spinner />;
  if (error) return <ErrorState error={error} />;

  return (
    <div>
      <PageHeader
        title="Match Schedule"
        subtitle="FIFA World Cup 2026 · Canada · Mexico · USA"
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search team, venue…"
          className="w-full max-w-xs rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm focus:border-pitch-500 focus:outline-none"
        />
        <select
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm focus:border-pitch-500 focus:outline-none"
        >
          <option value="all">All groups</option>
          {groups.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <div className="flex gap-1">
          {STAGE_FILTERS.map((s) => (
            <button
              key={s.value}
              onClick={() => setStage(s.value)}
              className={`rounded-lg px-3 py-2 text-sm transition ${
                stage === s.value
                  ? 'bg-pitch-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {byDay.length === 0 ? (
        <EmptyState message="No matches match your filters." />
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
