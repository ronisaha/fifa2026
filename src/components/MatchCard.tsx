import { Link } from 'react-router-dom';
import type { Match } from '../types';
import { useTz } from '../lib/tz-context';
import { formatKickoff } from '../lib/time';

function TeamRow({
  name,
  flag,
  slug,
  goals,
  winner,
}: {
  name: string;
  flag: string;
  slug: string | null;
  goals: number | null;
  winner: boolean;
}) {
  const label = (
    <span className="flex items-center gap-2 truncate">
      <span className="text-lg leading-none">{flag || '⚽'}</span>
      <span className={`truncate ${winner ? 'font-semibold text-white' : ''}`}>{name}</span>
    </span>
  );
  return (
    <div className="flex items-center justify-between gap-2">
      {slug ? (
        <Link to={`/team/${slug}`} className="truncate hover:text-pitch-400">
          {label}
        </Link>
      ) : (
        <span className="truncate text-slate-400">{label}</span>
      )}
      {goals !== null && (
        <span className={`tabular-nums ${winner ? 'font-bold text-white' : 'text-slate-300'}`}>
          {goals}
        </span>
      )}
    </div>
  );
}

export default function MatchCard({ match }: { match: Match }) {
  const { tz } = useTz();
  const ft = match.score?.ft ?? null;
  const g1 = ft ? ft[0] : null;
  const g2 = ft ? ft[1] : null;

  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
        <span className="chip">{match.group ?? match.round}</span>
        <span className="flex items-center gap-2">
          {match.finished ? (
            <span className="rounded bg-slate-800 px-1.5 py-0.5 font-medium text-pitch-400">FT</span>
          ) : (
            <span>{formatKickoff(match.kickoff, tz, { withDate: true })}</span>
          )}
        </span>
      </div>

      <div className="space-y-1.5 text-sm">
        <TeamRow
          name={match.team1}
          flag={match.team1Flag}
          slug={match.team1Slug}
          goals={g1}
          winner={ft != null && g1! > g2!}
        />
        <TeamRow
          name={match.team2}
          flag={match.team2Flag}
          slug={match.team2Slug}
          goals={g2}
          winner={ft != null && g2! > g1!}
        />
      </div>

      {match.venue && (
        <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
          <span>📍 {match.venue}</span>
          <span>{match.round}</span>
        </div>
      )}
    </div>
  );
}
