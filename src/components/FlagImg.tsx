import { useState } from 'react';
import { flagImageUrl } from '../lib/flags';

/** Rectangular flag image with graceful fallback to the emoji glyph. */
export default function FlagImg({
  emoji,
  name,
  className = '',
  width = 160,
}: {
  emoji: string;
  name: string;
  className?: string;
  width?: number;
}) {
  const url = flagImageUrl(emoji, width);
  const [failed, setFailed] = useState(false);

  if (!url || failed) {
    return (
      <span className={`flex items-center justify-center ${className}`} aria-label={name}>
        <span className="text-[2.5em] leading-none">{emoji || '⚽'}</span>
      </span>
    );
  }

  return (
    <img
      src={url}
      alt={`${name} flag`}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`object-cover ${className}`}
    />
  );
}
