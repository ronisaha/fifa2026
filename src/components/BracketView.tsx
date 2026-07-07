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
  pens,
  winner,
}: {
  name: string;
  flag: string;
  slug: string | null;
  goals: number | null;
  pens: number | null;
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
        <span className="flex items-baseline gap-1 tabular-nums">
          {pens !== null && <span className="text-[10px] text-slate-500">({pens})</span>}
          <span className={winner ? 'font-bold text-white' : 'text-slate-400'}>{goals}</span>
        </span>
      )}
    </div>
  );
}

function Tie({ tie }: { tie: BracketTie }) {
  const { tz } = useTz();
  const sc = tie.score;
  // Score at the deepest stage played before any shoot-out: ET aggregate if
  // extra time was played, else 90'. (Shoot-out spot-kicks show as `pens`.)
  const main = sc?.et ?? sc?.ft ?? null;
  const g1 = main ? main[0] : null;
  const g2 = main ? main[1] : null;
  // Decide the winner on the deepest stage played: penalties, else extra time,
  // else 90'. (A knockout draw at 90' was settled by ET/pens.)
  const decided = sc ? (sc.p ?? sc.et ?? sc.ft) : null;
  const win1 = decided != null && decided[0] > decided[1];
  const win2 = decided != null && decided[1] > decided[0];
  const pens = sc?.p ?? null;
  const status = pens ? 'pens' : sc?.et ? 'AET' : 'FT';
  return (
    <div className="card w-52 overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/80 px-2 py-1 text-[10px] text-slate-500">
        <span>Match {tie.num}</span>
        <span>{tie.finished ? status : formatKickoff(tie.kickoff, tz, { withDate: true })}</span>
      </div>
      <div className="divide-y divide-slate-800/60">
        <TieTeam name={tie.team1} flag={tie.team1Flag} slug={tie.team1Slug} goals={g1} pens={pens ? pens[0] : null} winner={win1} />
        <TieTeam name={tie.team2} flag={tie.team2Flag} slug={tie.team2Slug} goals={g2} pens={pens ? pens[1] : null} winner={win2} />
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
