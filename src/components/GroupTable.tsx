import { Link } from 'react-router-dom';
import type { StandingRow } from '../types';

export default function GroupTable({
  group,
  rows,
}: {
  group: string;
  rows: StandingRow[];
}) {
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-slate-800 bg-slate-900 px-4 py-2.5 text-sm font-semibold">
        {group}
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-slate-400">
            <th className="px-3 py-2 text-left font-medium">#</th>
            <th className="px-2 py-2 text-left font-medium">Team</th>
            <th className="px-2 py-2 text-center font-medium" title="Played">P</th>
            <th className="px-2 py-2 text-center font-medium" title="Won">W</th>
            <th className="px-2 py-2 text-center font-medium" title="Drawn">D</th>
            <th className="px-2 py-2 text-center font-medium" title="Lost">L</th>
            <th className="hidden px-2 py-2 text-center font-medium sm:table-cell" title="Goals for">GF</th>
            <th className="hidden px-2 py-2 text-center font-medium sm:table-cell" title="Goals against">GA</th>
            <th className="px-2 py-2 text-center font-medium" title="Goal difference">GD</th>
            <th className="px-3 py-2 text-center font-semibold" title="Points">Pts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const qualifies = r.rank <= 2;
            return (
              <tr
                key={r.team}
                className="border-t border-slate-800/60 tabular-nums hover:bg-slate-800/40"
              >
                <td className="px-3 py-2 text-slate-400">
                  <span className={qualifies ? 'font-semibold text-pitch-400' : ''}>{r.rank}</span>
                </td>
                <td className="px-2 py-2">
                  <Link to={`/team/${r.slug}`} className="flex items-center gap-2 hover:text-pitch-400">
                    <span className="text-base leading-none">{r.flag || '⚽'}</span>
                    <span className="truncate">{r.team}</span>
                  </Link>
                </td>
                <td className="px-2 py-2 text-center text-slate-400">{r.played}</td>
                <td className="px-2 py-2 text-center text-slate-400">{r.won}</td>
                <td className="px-2 py-2 text-center text-slate-400">{r.draw}</td>
                <td className="px-2 py-2 text-center text-slate-400">{r.lost}</td>
                <td className="hidden px-2 py-2 text-center text-slate-400 sm:table-cell">{r.gf}</td>
                <td className="hidden px-2 py-2 text-center text-slate-400 sm:table-cell">{r.ga}</td>
                <td className="px-2 py-2 text-center text-slate-300">
                  {r.gd > 0 ? `+${r.gd}` : r.gd}
                </td>
                <td className="px-3 py-2 text-center font-bold text-white">{r.points}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
