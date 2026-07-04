#!/usr/bin/env node
// Resolve World Cup 2026 goal-scorers to freely-licensed head-shots and cache
// them into public/data/avatars.json (keyed by player name).
//
// Source: the Wikipedia REST summary endpoint, whose `thumbnail` is served from
// Wikimedia Commons (CC / public-domain — safe to hotlink with attribution).
// Only players who actually SCORED are looked up (a bounded ~150-name set), so
// name-disambiguation risk stays small and reviewable. Anything without a
// confident match is simply omitted — the client renders an initials monogram.
//
// Safeguards against wrong-person matches:
//   - only accept summaries whose description looks like a footballer;
//   - a manual OVERRIDES map to force a specific title, a direct URL, or to
//     blocklist a bad match (set to null).
// Re-run after a data refresh; it merges over any existing avatars.json so a
// transient Wikipedia hiccup never drops photos we already had.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'public', 'data');
const OUT = join(DATA_DIR, 'avatars.json');

const UA = 'fifa2026-worldcup-app/1.0 (https://fifa2026.xiidea.net; unofficial fan site)';
const REST = 'https://en.wikipedia.org/api/rest_v1/page/summary/';

// name (exactly as it appears in matches.json) -> override.
//   { title: 'WP Article Title' }  force a specific page
//   { photo: 'https://…' }         hardcode an image URL
//   null                           blocklist (always fall back to initials)
const OVERRIDES = {
  // Disambiguation pages / non-obvious titles the auto-match can't resolve.
  'Luis Díaz': { title: 'Luis Díaz (footballer, born 1997)' },
  'Nuno Mendes': { title: 'Nuno Mendes (footballer, born 2002)' },
  'Daniel Muñoz': { title: 'Daniel Muñoz (footballer)' },
  'Jhon Arias': { title: 'Jhon Arias (footballer)' },
  Trézéguet: { title: 'Trézéguet (Egyptian footballer)' },
  'Ramin Rezaeian': { title: 'Ramin Rezaeian' },
  // e.g. 'Wrong Match': null,   // blocklist a bad auto-match
};

const FOOTBALLER = /footballer|football player|soccer/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function titleCandidates(name) {
  const stripped = name.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const cands = [name];
  if (stripped !== name) cands.push(stripped);
  return cands.map((c) => c.replace(/ /g, '_'));
}

async function wikiSummary(title) {
  const res = await fetch(REST + encodeURIComponent(title), {
    headers: { 'User-Agent': UA, accept: 'application/json' },
  });
  if (!res.ok) return null;
  return res.json();
}

async function resolvePhoto(name) {
  const ov = OVERRIDES[name];
  if (ov === null) return null;
  if (ov?.photo) return { photo: ov.photo, title: name, via: 'override' };

  const titles = ov?.title ? [ov.title.replace(/ /g, '_')] : titleCandidates(name);
  for (const t of titles) {
    let j;
    try {
      j = await wikiSummary(t);
    } catch {
      continue;
    }
    if (!j || j.type === 'disambiguation') continue;
    const desc = `${j.description ?? ''} ${j.extract ?? ''}`;
    // Overrides are trusted; auto-matches must look like a footballer.
    if (!ov && !FOOTBALLER.test(desc)) continue;
    const src = j.thumbnail?.source ?? j.originalimage?.source;
    if (!src) continue;
    return { photo: src, title: j.title, via: 'wikipedia' };
  }
  return null;
}

function scorerNames(matches) {
  const set = new Set();
  for (const m of matches) {
    if (!m.finished) continue;
    for (const side of ['goals1', 'goals2']) {
      for (const g of m[side] ?? []) {
        if (g.owngoal) continue;
        const n = g.name?.trim();
        if (n) set.add(n);
      }
    }
  }
  return [...set].sort();
}

async function main() {
  const matches = JSON.parse(await readFile(join(DATA_DIR, 'matches.json'), 'utf8'));
  let existing = {};
  try {
    existing = JSON.parse(await readFile(OUT, 'utf8'));
  } catch {
    /* first run */
  }

  const names = scorerNames(matches);
  const out = { ...existing };
  let matched = 0;
  let fresh = 0;
  const misses = [];

  for (const name of names) {
    // Keep a previously-resolved photo unless an override now changes it.
    if (out[name]?.photo && !(name in OVERRIDES)) {
      matched++;
      continue;
    }
    const r = await resolvePhoto(name);
    if (r) {
      out[name] = { photo: r.photo };
      matched++;
      fresh++;
    } else {
      delete out[name];
      misses.push(name);
    }
    await sleep(150); // be polite to Wikipedia
  }

  // Drop cached entries for players who are no longer scorers.
  for (const key of Object.keys(out)) {
    if (!names.includes(key)) delete out[key];
  }

  await writeFile(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(
    `✓ avatars.json: ${matched}/${names.length} scorers have a photo ` +
      `(${fresh} newly fetched). ${misses.length} fall back to initials.`,
  );
  if (misses.length) console.log('   no photo:', misses.join(', '));
}

main().catch((err) => {
  console.error('✗ fetch-avatars failed:', err.message);
  process.exit(1);
});
