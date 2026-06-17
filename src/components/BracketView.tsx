import { Link } from 'react-router-dom';
import type { Bracket, BracketTie } from '../types';
import { useTz } from '../lib/tz-context';
import { formatKickoff } from '../lib/time';

const ROUND_ORDER = [
  'Round of 32',
  'Round of 16',
  'Quarter-final',
  'Semi-final',
  'Final',
];

function TieTeam({
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
  const inner = (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="text-sm leading-none">{flag || '·'}</span>
      <span className={`truncate ${winner ? 'font-semibold text-white' : 'text-slate-300'}`}>
        {name}
      </span>
    </span>
  );
  return (
    <div className="flex items-center justify-between gap-2 px-2 py-1 text-xs">
      {slug ? (
        <Link to={`/team/${slug}`} className="min-w-0 hover:text-pitch-400">
          {inner}
        </Link>
      ) : (
        inner
      )}
      {goals !== null && (
        <span className={`tabular-nums ${winner ? 'font-bold text-white' : 'text-slate-400'}`}>
          {goals}
        </span>
      )}
    </div>
  );
}

function Tie({ tie }: { tie: BracketTie }) {
  const { tz } = useTz();
  const ft = tie.score?.ft ?? null;
  const g1 = ft ? ft[0] : null;
  const g2 = ft ? ft[1] : null;
  return (
    <div className="card w-52 overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/80 px-2 py-1 text-[10px] text-slate-500">
        <span>Match {tie.num}</span>
        <span>{tie.finished ? 'FT' : formatKickoff(tie.kickoff, tz, { withDate: true })}</span>
      </div>
      <div className="divide-y divide-slate-800/60">
        <TieTeam name={tie.team1} flag={tie.team1Flag} slug={tie.team1Slug} goals={g1} winner={ft != null && g1! > g2!} />
        <TieTeam name={tie.team2} flag={tie.team2Flag} slug={tie.team2Slug} goals={g2} winner={ft != null && g2! > g1!} />
      </div>
    </div>
  );
}

export default function BracketView({ bracket }: { bracket: Bracket }) {
  const rounds = ROUND_ORDER.filter((r) => bracket[r]?.length);
  const third = bracket['Match for third place'];

  return (
    <div className="space-y-8">
      <div className="overflow-x-auto pb-4">
        <div className="flex gap-6">
          {rounds.map((round) => (
            <div key={round} className="flex min-w-[13rem] flex-col">
              <h3 className="mb-3 text-sm font-semibold text-slate-300">{round}</h3>
              <div className="flex flex-1 flex-col justify-around gap-3">
                {bracket[round].map((tie) => (
                  <Tie key={tie.num} tie={tie} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {third && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-slate-300">Match for third place</h3>
          <div className="flex gap-3">
            {third.map((tie) => (
              <Tie key={tie.num} tie={tie} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
