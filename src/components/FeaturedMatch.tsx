import { useEffect, useRef, useState } from 'react';
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

/** Live status + score for a match, oriented to team1/team2. */
function useLiveFor(match: Match) {
  const status = matchStatus(match);
  const liveResp = useLive();
  const live = status === 'live' ? findLiveFor(liveResp?.matches, match.team1, match.team2) : null;
  return { status, live, liveResp };
}

/** The hero card itself (no surrounding nav / lag note). */
function HeroCard({ match, status, live }: { match: Match; status: string; live: LiveMatch | null }) {
  const { tz } = useTz();
  const liveFt = live ? liveGoals(match.team1, live) : null;
  // Show the extra-time aggregate for a finished ET tie (else 90'); a live match
  // uses the in-play score.
  const goals = liveFt ?? match.score?.et ?? match.score?.ft ?? null;
  const showScore = goals != null;

  return (
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
            <div className="text-xs text-slate-400 sm:text-sm">{formatDateHeading(match.kickoff, tz)}</div>
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

/** Banner entry point: one hero for a single match, a slider for several. */
export default function FeaturedMatch({ matches }: { matches: Match[] }) {
  if (matches.length === 0) return null;
  if (matches.length === 1) return <Hero match={matches[0]} />;
  return <HeroCarousel matches={matches} />;
}

function Hero({ match }: { match: Match }) {
  const { status, live, liveResp } = useLiveFor(match);
  return (
    <>
      <HeroCard match={match} status={status} live={live} />
      <LagNote
        status={status}
        live={live}
        ageSeconds={liveResp?.meta.ageSeconds ?? null}
        refresh={liveResp?.meta.refreshIntervalSeconds ?? null}
      />
    </>
  );
}

const AUTO_ADVANCE_MS = 7000;

/** Slider: shows one match at a time with arrow + dot navigation. */
function HeroCarousel({ matches }: { matches: Match[] }) {
  const [index, setIndex] = useState(0);
  const [hovering, setHovering] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const idx = index % matches.length;
  const current = matches[idx];
  const { status, live, liveResp } = useLiveFor(current);

  const go = (delta: number) => setIndex((i) => (i + delta + matches.length) % matches.length);

  // Auto-advance, suspended while hovering/focused, or frozen via the toggle.
  const stoppedRef = useRef(false);
  stoppedRef.current = hovering || frozen;
  useEffect(() => {
    const id = setInterval(() => {
      if (!stoppedRef.current && (typeof document === 'undefined' || !document.hidden)) {
        setIndex((i) => (i + 1) % matches.length);
      }
    }, AUTO_ADVANCE_MS);
    return () => clearInterval(id);
  }, [matches.length]);

  return (
    <>
      <div
        className="relative"
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onFocusCapture={() => setHovering(true)}
        onBlurCapture={() => setHovering(false)}
      >
        <HeroCard match={current} status={status} live={live} />

        <button
          type="button"
          aria-label="Previous match"
          onClick={() => go(-1)}
          className="absolute left-1 top-1/2 hidden -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-slate-900/70 p-2 text-slate-200 backdrop-blur transition hover:bg-slate-800 hover:text-white sm:flex"
        >
          <ChevronLeft />
        </button>
        <button
          type="button"
          aria-label="Next match"
          onClick={() => go(1)}
          className="absolute right-1 top-1/2 hidden -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-slate-900/70 p-2 text-slate-200 backdrop-blur transition hover:bg-slate-800 hover:text-white sm:flex"
        >
          <ChevronRight />
        </button>
      </div>

      {/* indicator + mobile-friendly controls */}
      <div className="mt-3 flex items-center justify-center gap-3">
        <button
          type="button"
          aria-label="Previous match"
          onClick={() => go(-1)}
          className="flex items-center justify-center rounded-full border border-white/10 bg-slate-900/70 p-1.5 text-slate-300 transition hover:bg-slate-800 hover:text-white sm:hidden"
        >
          <ChevronLeft />
        </button>

        <div className="flex items-center gap-2">
          {matches.map((m, j) => (
            <button
              key={m.id}
              type="button"
              aria-label={`Show match ${j + 1} of ${matches.length}`}
              aria-current={j === idx}
              onClick={() => setIndex(j)}
              className={`h-2 rounded-full transition-all ${
                j === idx ? 'w-6 bg-pitch-400' : 'w-2 bg-slate-600 hover:bg-slate-500'
              }`}
            />
          ))}
        </div>

        <button
          type="button"
          aria-label="Next match"
          onClick={() => go(1)}
          className="flex items-center justify-center rounded-full border border-white/10 bg-slate-900/70 p-1.5 text-slate-300 transition hover:bg-slate-800 hover:text-white sm:hidden"
        >
          <ChevronRight />
        </button>

        <button
          type="button"
          aria-label={frozen ? 'Resume auto-advance' : 'Pause on this match'}
          aria-pressed={frozen}
          title={frozen ? 'Resume auto-advance' : 'Pause on this match'}
          onClick={() => setFrozen((f) => !f)}
          className={`flex items-center justify-center rounded-full border p-1.5 transition ${
            frozen
              ? 'border-pitch-500/40 bg-pitch-500/15 text-pitch-300 hover:bg-pitch-500/25'
              : 'border-white/10 bg-slate-900/70 text-slate-300 hover:bg-slate-800 hover:text-white'
          }`}
        >
          {frozen ? <PlayIcon /> : <PauseIcon />}
        </button>

        <span className="ml-1 text-xs font-medium tabular-nums text-slate-400">
          {idx + 1} / {matches.length}
        </span>
      </div>

      <LagNote
        status={status}
        live={live}
        ageSeconds={liveResp?.meta.ageSeconds ?? null}
        refresh={liveResp?.meta.refreshIntervalSeconds ?? null}
      />
    </>
  );
}

function ChevronLeft() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
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
      ? 'Live scores update here automatically once play kicks off.'
      : periodic;
  }
  return <p className="mb-8 mt-2 text-center text-xs text-slate-500">{text}</p>;
}
