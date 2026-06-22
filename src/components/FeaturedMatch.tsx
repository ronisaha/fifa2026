import { Link } from 'react-router-dom';
import type { Match } from '../types';
import { matchStatus } from '../lib/featured';
import { findLiveFor, liveGoals, liveScoresEnabled, type LiveMatch } from '../lib/live';
import { useLive } from '../lib/live-context';
import { useTz } from '../lib/tz-context';
import { formatDateHeading, formatKickoff } from '../lib/time';
import FlagImg from './FlagImg';

function StatusBadge({ status, elapsed }: { status: string; elapsed?: number | null }) {
  if (status === 'live') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/15 px-3 py-1 text-xs font-bold uppercase tracking-wide text-red-400">
        <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
        {elapsed != null ? `Live ${elapsed}'` : 'Live'}
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

  const liveResp = useLive();
  const live = status === 'live' ? findLiveFor(liveResp?.matches, match.team1, match.team2) : null;
  const liveFt = live ? liveGoals(match.team1, live) : null;

  const staticFt = match.score?.ft ?? null;
  const goals = liveFt ?? staticFt;
  const showScore = goals != null;

  return (
    <>
      <section className="overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 via-brand-dark/40 to-slate-900 shadow-xl">
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
            <StatusBadge status={status} elapsed={live?.elapsed} />
          </div>

          {/* teams + center */}
          <div className="grid grid-cols-3 items-center gap-2 sm:gap-6">
            <Side name={match.team1} flag={match.team1Flag} slug={match.team1Slug} align="left" />

            <div className="flex flex-col items-center gap-1.5 text-center">
              {showScore ? (
                <div
                  className={`text-4xl font-extrabold tabular-nums tracking-tight sm:text-5xl ${
                    liveFt ? 'text-red-400' : 'text-white'
                  }`}
                >
                  {goals[0]} <span className="text-slate-500">–</span> {goals[1]}
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

      {/* lag note (under the banner) */}
      <LagNote status={status} live={live} ageSeconds={liveResp?.meta.ageSeconds ?? null} refresh={liveResp?.meta.refreshIntervalSeconds ?? null} />
    </>
  );
}

function LagNote({
  status,
  live,
  ageSeconds,
  refresh,
}: {
  status: string;
  live: LiveMatch | null;
  ageSeconds: number | null;
  refresh: number | null;
}) {
  // ~30 min reflects the data pipeline cadence (see update-data.yml).
  const periodic = '⏱️ Scores update with the periodic refresh (about every 30 minutes).';

  let text: string;
  if (status === 'live' && live) {
    const age = ageSeconds != null ? `${ageSeconds}s ago` : 'moments ago';
    const cadence = refresh ? ` · refreshes ~every ${refresh}s` : '';
    text = `🔴 Live score — updated ${age}${cadence}.`;
  } else if (status === 'live') {
    text = liveScoresEnabled
      ? '⏱️ Waiting for the live feed for this match — the score updates automatically during play.'
      : periodic;
  } else if (status === 'finished') {
    text = 'Final score from the data feed.';
  } else {
    text = liveScoresEnabled
      ? 'Live scores update here automatically once this match kicks off.'
      : periodic;
  }
  return <p className="mb-8 mt-2 text-center text-xs text-slate-500">{text}</p>;
}
