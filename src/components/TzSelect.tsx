import { useTz } from '../lib/tz-context';
import { TZ_OPTIONS } from '../lib/time';

export default function TzSelect() {
  const { tz, setTz } = useTz();
  return (
    <label className="flex items-center gap-2 text-xs text-slate-400">
      <span className="hidden sm:inline">Times in</span>
      <select
        value={tz}
        onChange={(e) => setTz(e.target.value)}
        className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-200 focus:border-pitch-500 focus:outline-none"
        aria-label="Select timezone"
      >
        {TZ_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
