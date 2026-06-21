import { Link } from 'react-router-dom';
import type { Match } from '../types';
import { matchStatus } from '../lib/featured';
import { useTz } from '../lib/tz-context';
import { formatDateHeading, formatKickoff } from '../lib/time';
import FlagImg from './FlagImg';

function StatusBadge({ status }: { status: ReturnType<typeof matchStatus> }) {
  if (status === 'live') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/15 px-3 py-1 text-xs font-bold uppercase tracking-wide text-red-400">
        <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
        Live
      </span>
    );
  }
  if (status === 'finished') {
    return (
      <span className="rounded-full bg-slate-700/60 px-3 py-1 text-xs font-bold uppercase tracking-wide text-slate-300">
        Full time
      </span>
    );
  }
  return (
    <span className="rounded-full bg-pitch-500/15 px-3 py-1 text-xs font-bold uppercase tracking-wide text-pitch-400">
      Up next
    </span>
  );
}

function Side({
  name,
  flag,
  slug,
  align,
}: {
  name: string;
  flag: string;
  slug: string | null;
  align: 'left' | 'right';
}) {
  const body = (
    <div className={`flex flex-col items-center gap-3 ${align === 'left' ? 'sm:items-start' : 'sm:items-end'}`}>
      <FlagImg
        emoji={flag}
        name={name}
        width={160}
        className="h-16 w-24 rounded-lg shadow-lg ring-1 ring-white/10 sm:h-20 sm:w-32"
      />
      <span className="text-lg font-bold tracking-tight sm:text-2xl">{name}</span>
    </div>
  );
  return slug ? (
    <Link to={`/team/${slug}`} className="group transition hover:opacity-90">
      {body}
    </Link>
  ) : (
    body
  );
}

export default function FeaturedMatch({ match }: { match: Match }) {
  const { tz } = useTz();
  const status = matchStatus(match);
  const ft = match.score?.ft ?? null;
  const showScore = ft != null;

  return (
    <section className="mb-8 overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 via-brand-dark/40 to-slate-900 shadow-xl">
      <div className="px-4 py-6 sm:px-10 sm:py-8">
        {/* header */}
        <div className="mb-6 flex items-center justify-center gap-3 text-sm text-slate-300">
          <span className="font-medium">{match.round}</span>
          {match.group && (
            <>
              <span className="text-slate-600">·</span>
              <span className="font-medium">{match.group}</span>
            </>
          )}
          <span className="text-slate-600">·</span>
          <StatusBadge status={status} />
        </div>

        {/* teams + center */}
        <div className="grid grid-cols-3 items-center gap-2 sm:gap-6">
          <Side name={match.team1} flag={match.team1Flag} slug={match.team1Slug} align="left" />

          <div className="flex flex-col items-center gap-1.5 text-center">
            {showScore ? (
              <div className="text-4xl font-extrabold tabular-nums tracking-tight text-white sm:text-5xl">
                {ft![0]} <span className="text-slate-500">–</span> {ft![1]}
              </div>
            ) : (
              <div className="text-3xl font-extrabold tracking-tight text-amber-400 sm:text-5xl">
                {formatKickoff(match.kickoff, tz)}
              </div>
            )}
            <div className="text-xs text-slate-400 sm:text-sm">
              {formatDateHeading(match.kickoff, tz)}
            </div>
          </div>

          <Side name={match.team2} flag={match.team2Flag} slug={match.team2Slug} align="right" />
        </div>
      </div>

      {/* footer */}
      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1 border-t border-white/5 bg-black/20 px-4 py-3 text-xs text-slate-400 sm:text-sm">
        {match.venue && <span>🏟️ {match.venue}</span>}
        <span>🗓️ {formatKickoff(match.kickoff, tz, { withDate: true })}</span>
      </div>
    </section>
  );
}
