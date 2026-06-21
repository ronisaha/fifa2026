// Derive a flag image URL from a flag emoji so we can render crisp rectangular
// flags (with the emoji kept as a fallback). Uses flagcdn.com (free, no key).

const SUBDIVISION: Record<string, string> = {
  gbeng: 'gb-eng',
  gbsct: 'gb-sct',
  gbwls: 'gb-wls',
};

export function flagImageUrl(emoji: string, width = 160): string | null {
  if (!emoji) return null;
  const cps = [...emoji].map((c) => c.codePointAt(0)!);

  // Tag-sequence flags (England / Scotland / Wales): 🏴 + tag letters.
  if (cps[0] === 0x1f3f4) {
    const letters = cps
      .slice(1)
      .filter((c) => c >= 0xe0061 && c <= 0xe007a)
      .map((c) => String.fromCharCode(c - 0xe0000))
      .join('');
    const code = SUBDIVISION[letters];
    return code ? `https://flagcdn.com/w${width}/${code}.png` : null;
  }

  // Regional-indicator pair -> ISO 3166-1 alpha-2.
  if (cps.length >= 2 && cps[0] >= 0x1f1e6 && cps[0] <= 0x1f1ff) {
    const a = String.fromCharCode(cps[0] - 0x1f1e6 + 97);
    const b = String.fromCharCode(cps[1] - 0x1f1e6 + 97);
    return `https://flagcdn.com/w${width}/${a}${b}.png`;
  }

  return null;
}
