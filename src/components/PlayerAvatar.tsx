import { useState } from 'react';

/** First+last initials, e.g. "Lionel Messi" -> "LM", "Neymar" -> "N". */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

/** Deterministic, legible-on-dark hue from the name. */
function hue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

/**
 * Round player avatar: a real (Wikimedia Commons) photo when we have one,
 * otherwise a deterministic initials monogram. Mirrors FlagImg's fallback
 * pattern so a broken/absent image never leaves an empty slot.
 */
export default function PlayerAvatar({
  name,
  photo,
  size = 36,
}: {
  name: string;
  photo?: string | null;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const dim = { width: size, height: size };

  if (photo && !failed) {
    return (
      <img
        src={photo}
        alt={name}
        loading="lazy"
        onError={() => setFailed(true)}
        style={dim}
        className="shrink-0 rounded-full object-cover ring-1 ring-white/10"
      />
    );
  }

  const h = hue(name);
  return (
    <span
      aria-label={name}
      style={{
        ...dim,
        background: `linear-gradient(135deg, hsl(${h} 45% 32%), hsl(${(h + 40) % 360} 45% 22%))`,
        fontSize: size * 0.4,
      }}
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-1 ring-white/10"
    >
      {initials(name)}
    </span>
  );
}
