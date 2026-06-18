// Timezone localization helpers. Kickoff times are stored as ISO UTC; we render
// them in the visitor's chosen timezone (default: their browser timezone).

const STORAGE_KEY = 'wc2026.tz';

export const LOCAL_TZ =
  Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export interface TzOption {
  value: string; // IANA zone, or "local"
  label: string;
}

// Curated list: visitor local, UTC, and the World Cup 2026 host-country zones.
export const TZ_OPTIONS: TzOption[] = [
  { value: 'local', label: `My timezone (${LOCAL_TZ})` },
  { value: 'UTC', label: 'UTC' },
  { value: 'America/New_York', label: 'US Eastern (New York)' },
  { value: 'America/Chicago', label: 'US Central (Dallas/KC)' },
  { value: 'America/Denver', label: 'US Mountain (Denver)' },
  { value: 'America/Los_Angeles', label: 'US Pacific (LA/SF/Seattle)' },
  { value: 'America/Mexico_City', label: 'Mexico (Mexico City)' },
  { value: 'America/Toronto', label: 'Canada Eastern (Toronto)' },
  { value: 'America/Vancouver', label: 'Canada Pacific (Vancouver)' },
];

export function resolveZone(tz: string): string {
  return tz === 'local' ? LOCAL_TZ : tz;
}

export function loadTz(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || 'local';
  } catch {
    return 'local';
  }
}

export function saveTz(tz: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, tz);
  } catch {
    /* ignore */
  }
}

export function formatKickoff(
  iso: string | null,
  tz: string,
  opts: { withDate?: boolean } = {},
): string {
  if (!iso) return 'TBD';
  const zone = resolveZone(tz);
  const date = new Date(iso);
  const time = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: zone,
  }).format(date);
  if (!opts.withDate) return time;
  const day = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: zone,
  }).format(date);
  return `${day}, ${time}`;
}

export function formatDateHeading(iso: string | null, tz: string): string {
  if (!iso) return 'Date TBD';
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: resolveZone(tz),
  }).format(new Date(iso));
}

/** Group a date key (YYYY-MM-DD) from an ISO kickoff in the chosen zone. */
export function dayKey(iso: string | null, tz: string): string {
  if (!iso) return 'tbd';
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: resolveZone(tz),
  }).format(new Date(iso));
}
