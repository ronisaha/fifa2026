#!/usr/bin/env node
// Fetch FIFA World Cup 2026 data from openfootball (public domain, no API key),
// normalize it into the app's own schema, compute standings + bracket, and write
// static JSON into public/data — but only when something actually changed.
//
// Optimization (per requirement): runs hourly via GitHub Actions, yet skips the
// network call entirely unless a match is expected to have ended since the last
// fetch (tracked in public/data/meta.json -> lastFetchAt). Use FORCE=1 to override.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'public', 'data');

const SRC_URL =
  process.env.SRC_URL ||
  'https://raw.githubusercontent.com/upbound-web/worldcup-live.json/master/2026/worldcup.json';

// A match is treated as "finished" this long after kickoff (90' + half-time +
// stoppage + a buffer). Used both for the skip-check and result expectations.
const MATCH_DURATION_MIN = 130;

const KNOCKOUT_ROUNDS = [
  'Round of 32',
  'Round of 16',
  'Quarter-final',
  'Semi-final',
  'Match for third place',
  'Final',
];

// ---------------------------------------------------------------------------
// Country name -> ISO 3166-1 alpha-2 (for flag emoji). Covers all 48 finalists
// plus likely qualifiers; unknown names simply render without a flag.
// ---------------------------------------------------------------------------
const NAME_TO_ISO2 = {
  Algeria: 'DZ', Argentina: 'AR', Australia: 'AU', Austria: 'AT', Belgium: 'BE',
  'Bosnia & Herzegovina': 'BA', Brazil: 'BR', Canada: 'CA', 'Cape Verde': 'CV',
  Colombia: 'CO', Croatia: 'HR', 'Curaçao': 'CW', 'Czech Republic': 'CZ',
  'DR Congo': 'CD', Denmark: 'DK', Ecuador: 'EC', Egypt: 'EG', France: 'FR',
  Germany: 'DE', Ghana: 'GH', Greece: 'GR', Haiti: 'HT', Honduras: 'HN',
  Hungary: 'HU', Iran: 'IR', Iraq: 'IQ', Italy: 'IT', 'Ivory Coast': 'CI',
  Jamaica: 'JM', Japan: 'JP', Jordan: 'JO', Mexico: 'MX', Morocco: 'MA',
  Netherlands: 'NL', 'New Zealand': 'NZ', Nigeria: 'NG', Norway: 'NO',
  Panama: 'PA', Paraguay: 'PY', Peru: 'PE', Poland: 'PL', Portugal: 'PT',
  Qatar: 'QA', 'Saudi Arabia': 'SA', Senegal: 'SN', Serbia: 'RS', Slovakia: 'SK',
  Slovenia: 'SI', 'South Africa': 'ZA', 'South Korea': 'KR', Spain: 'ES',
  Sweden: 'SE', Switzerland: 'CH', Tunisia: 'TN', Turkey: 'TR', Ukraine: 'UA',
  Uruguay: 'UY', USA: 'US', Uzbekistan: 'UZ', Venezuela: 'VE',
};

// Home-nations need subdivision flag emoji (no plain ISO2).
const SPECIAL_FLAGS = {
  England: '🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}',
  Scotland: '🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}',
  Wales: '🏴\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F}',
};

function flagFor(name) {
  if (!name) return '';
  if (SPECIAL_FLAGS[name]) return SPECIAL_FLAGS[name];
  const iso = NAME_TO_ISO2[name];
  if (!iso) return '';
  return String.fromCodePoint(...[...iso].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

// A team slot is a real country if we can flag it / it's not a placeholder code
// like "W73", "1A", "3A/B/C/D/F".
function isPlaceholder(name) {
  if (!name) return true;
  return /^[WL]\d+$/.test(name) || /^[1-3][A-L]?(\/[A-L])*$/.test(name);
}

function slugify(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// "13:00 UTC-6" + "2026-06-11" -> ISO UTC instant, plus the raw offset label.
function toUtcIso(date, time) {
  if (!date || !time) return { kickoff: null, offsetLabel: null };
  const m = time.match(/^(\d{1,2}):(\d{2})\s*UTC([+-]\d{1,2})?/i);
  if (!m) return { kickoff: null, offsetLabel: time };
  const [, hh, mm, off] = m;
  const [y, mo, d] = date.split('-').map(Number);
  const offsetHours = off ? Number(off) : 0;
  const wallAsUtc = Date.UTC(y, mo - 1, d, Number(hh), Number(mm));
  const trueUtc = wallAsUtc - offsetHours * 3600_000;
  return { kickoff: new Date(trueUtc).toISOString(), offsetLabel: `UTC${off ?? '+0'}` };
}

// Goal minute may arrive as a number (upbound-web) or string (openfootball);
// store it consistently as a string.
function normalizeGoals(goals) {
  if (!Array.isArray(goals)) return [];
  return goals.map((g) => ({ name: g.name, minute: String(g.minute ?? '') }));
}

function normalize(raw) {
  const matches = raw.matches.map((m, i) => {
    const { kickoff, offsetLabel } = toUtcIso(m.date, m.time);
    const ft = m.score?.ft ?? null;
    const ht = m.score?.ht ?? null;
    const finished = Array.isArray(ft) && ft.length === 2;
    return {
      id: m.num ?? i + 1,
      num: m.num ?? i + 1,
      round: m.round,
      stage: m.group ? 'group' : 'knockout',
      group: m.group ?? null,
      date: m.date,
      kickoff, // ISO UTC, or null
      localTime: m.time, // e.g. "13:00 UTC-6"
      offsetLabel,
      venue: m.ground ?? null,
      team1: m.team1,
      team2: m.team2,
      team1Slug: isPlaceholder(m.team1) ? null : slugify(m.team1),
      team2Slug: isPlaceholder(m.team2) ? null : slugify(m.team2),
      team1Flag: flagFor(m.team1),
      team2Flag: flagFor(m.team2),
      finished,
      score: finished ? { ft, ht } : null,
      goals1: normalizeGoals(m.goals1),
      goals2: normalizeGoals(m.goals2),
    };
  });

  // Teams (real countries only), with their group.
  const teamMap = new Map();
  for (const m of matches) {
    for (const side of ['team1', 'team2']) {
      const name = m[side];
      if (isPlaceholder(name)) continue;
      if (!teamMap.has(name)) {
        teamMap.set(name, {
          name,
          slug: slugify(name),
          flag: flagFor(name),
          group: m.group ?? null,
        });
      } else if (m.group && !teamMap.get(name).group) {
        teamMap.get(name).group = m.group;
      }
    }
  }
  const teams = [...teamMap.values()].sort((a, b) => a.name.localeCompare(b.name));

  // Groups -> members.
  const groups = {};
  for (const t of teams) {
    if (!t.group) continue;
    (groups[t.group] ??= []).push(t.name);
  }
  for (const g of Object.keys(groups)) groups[g].sort();

  const standings = computeStandings(matches, groups);
  const bracket = computeBracket(matches);

  return { matches, teams, groups, standings, bracket };
}

function computeStandings(matches, groups) {
  const result = {};
  for (const [group, members] of Object.entries(groups)) {
    const rows = new Map(
      members.map((name) => [
        name,
        { team: name, slug: slugify(name), flag: flagFor(name),
          played: 0, won: 0, draw: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0 },
      ]),
    );
    for (const m of matches) {
      if (m.group !== group || !m.finished) continue;
      const a = rows.get(m.team1);
      const b = rows.get(m.team2);
      if (!a || !b) continue;
      const [g1, g2] = m.score.ft;
      a.played++; b.played++;
      a.gf += g1; a.ga += g2;
      b.gf += g2; b.ga += g1;
      if (g1 > g2) { a.won++; a.points += 3; b.lost++; }
      else if (g1 < g2) { b.won++; b.points += 3; a.lost++; }
      else { a.draw++; b.draw++; a.points++; b.points++; }
    }
    const table = [...rows.values()];
    for (const r of table) r.gd = r.gf - r.ga;
    table.sort(
      (x, y) =>
        y.points - x.points ||
        y.gd - x.gd ||
        y.gf - x.gf ||
        x.team.localeCompare(y.team),
    );
    table.forEach((r, i) => (r.rank = i + 1));
    result[group] = table;
  }
  return result;
}

function computeBracket(matches) {
  const bracket = {};
  for (const round of KNOCKOUT_ROUNDS) {
    const ties = matches
      .filter((m) => m.round === round)
      .sort((a, b) => a.num - b.num)
      .map((m) => ({
        num: m.num,
        date: m.date,
        kickoff: m.kickoff,
        localTime: m.localTime,
        venue: m.venue,
        team1: m.team1, team2: m.team2,
        team1Flag: m.team1Flag, team2Flag: m.team2Flag,
        team1Slug: m.team1Slug, team2Slug: m.team2Slug,
        finished: m.finished,
        score: m.score,
      }));
    if (ties.length) bracket[round] = ties;
  }
  return bracket;
}

// Should we bother hitting the network? Yes if forced, data missing, no prior
// fetch, or a match is expected to have ended since lastFetchAt.
function shouldFetch(prevMatches, lastFetchAt) {
  if (process.env.FORCE === '1') return { run: true, reason: 'FORCE=1' };
  if (!prevMatches || !prevMatches.length) return { run: true, reason: 'no existing data' };
  if (!lastFetchAt) return { run: true, reason: 'no lastFetchAt recorded' };

  const now = Date.now();
  const last = new Date(lastFetchAt).getTime();
  for (const m of prevMatches) {
    if (!m.kickoff) continue;
    const ended = new Date(m.kickoff).getTime() + MATCH_DURATION_MIN * 60_000;
    if (ended <= now && ended > last) {
      return { run: true, reason: `match ${m.num} (${m.team1} v ${m.team2}) finished since last fetch` };
    }
  }
  return { run: false, reason: 'no match has ended since last fetch' };
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

async function writeIfChanged(name, value) {
  const path = join(DATA_DIR, name);
  const next = JSON.stringify(value, null, 2) + '\n';
  let prev = null;
  try { prev = await readFile(path, 'utf8'); } catch { /* new file */ }
  if (prev === next) return false;
  await writeFile(path, next, 'utf8');
  return true;
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });

  const prevMeta = await readJson(join(DATA_DIR, 'meta.json'));
  const prevMatches = await readJson(join(DATA_DIR, 'matches.json'));
  const { run, reason } = shouldFetch(prevMatches, prevMeta?.lastFetchAt);

  if (!run) {
    console.log(`⏭  Skipping fetch: ${reason}.`);
    return;
  }
  console.log(`⤓  Fetching: ${reason}.`);

  const res = await fetch(SRC_URL);
  if (!res.ok) throw new Error(`Upstream fetch failed: ${res.status} ${res.statusText}`);
  const raw = await res.json();

  // Validation — fail rather than commit corrupt data.
  if (!raw || !Array.isArray(raw.matches)) throw new Error('Invalid upstream: missing matches[]');
  if (raw.matches.length < 64) throw new Error(`Suspicious match count: ${raw.matches.length}`);

  const { matches, teams, groups, standings, bracket } = normalize(raw);
  if (Object.keys(groups).length < 8) throw new Error(`Suspicious group count: ${Object.keys(groups).length}`);

  const nowIso = new Date().toISOString();
  let changed = false;
  changed = (await writeIfChanged('matches.json', matches)) || changed;
  changed = (await writeIfChanged('teams.json', teams)) || changed;
  changed = (await writeIfChanged('groups.json', groups)) || changed;
  changed = (await writeIfChanged('standings.json', standings)) || changed;
  changed = (await writeIfChanged('bracket.json', bracket)) || changed;

  const finishedCount = matches.filter((m) => m.finished).length;
  const meta = {
    lastFetchAt: nowIso,
    lastUpdated: changed ? nowIso : prevMeta?.lastUpdated ?? nowIso,
    source: SRC_URL,
    sourceName: 'upbound-web/worldcup-live.json',
    counts: {
      matches: matches.length,
      teams: teams.length,
      groups: Object.keys(groups).length,
      finished: finishedCount,
    },
  };
  // meta always reflects lastFetchAt, so write it directly.
  await writeFile(join(DATA_DIR, 'meta.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8');

  console.log(
    `✓ Done. ${matches.length} matches, ${teams.length} teams, ${finishedCount} finished. ` +
      `Content ${changed ? 'changed' : 'unchanged'}.`,
  );
}

main().catch((err) => {
  console.error('✗ fetch-data failed:', err.message);
  process.exit(1);
});
