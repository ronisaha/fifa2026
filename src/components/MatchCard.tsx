import { Link } from 'react-router-dom';
import type { Match } from '../types';
import { useTz } from '../lib/tz-context';
import { useLive } from '../lib/live-context';
import { findLiveFor, liveGoals } from '../lib/live';
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
  const live = useLive();

  const liveMatch = findLiveFor(live?.matches, match.team1, match.team2);
  const liveFt = liveMatch ? liveGoals(match.team1, liveMatch) : null;
  const isLive = liveFt != null;

  // Prefer the live score for an in-play match; otherwise the static result.
  const score = liveFt ?? match.score?.ft ?? null;
  const g1 = score ? score[0] : null;
  const g2 = score ? score[1] : null;
  // Only highlight a leader for a decided/final result, not mid-match.
  const decided = match.finished && !isLive;

  return (
    <div className={`card p-4 ${isLive ? 'ring-1 ring-red-500/40' : ''}`}>
      <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
        <span className="chip">{match.group ?? match.round}</span>
        <span className="flex items-center gap-2">
          {isLive ? (
            <span className="inline-flex items-center gap-1 rounded bg-red-500/15 px-1.5 py-0.5 font-bold text-red-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
              {liveMatch!.elapsed != null ? `${liveMatch!.elapsed}'` : 'LIVE'}
            </span>
          ) : match.finished ? (
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
          winner={decided && g1! > g2!}
        />
        <TeamRow
          name={match.team2}
          flag={match.team2Flag}
          slug={match.team2Slug}
          goals={g2}
          winner={decided && g2! > g1!}
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
