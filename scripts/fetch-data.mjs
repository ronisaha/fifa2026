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

// Keep re-checking a finished-but-unrecorded match for this long, so we catch
// scores the upstream backfills after full-time (it can lag the final whistle).
const PENDING_RESULT_WINDOW_H = 48;

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

// ---------------------------------------------------------------------------
// Authoritative score overlay (the live feed, via the Worker /fixtures endpoint).
// We keep upbound as the structural base (schedule, venues, knockout
// placeholders) and overlay only FINISHED match scores from the live feed so
// results are authoritative. In-match freshness is handled client-side by the
// Worker /live banner, so we deliberately do NOT overlay in-play scores here.
// ---------------------------------------------------------------------------
// 'finished' = normalized status from the Worker (the live feed); FT/AET/PEN kept
// for forward-compatibility with the live feed-style feeds.
const FINISHED_STATUSES = new Set(['finished', 'FT', 'AET', 'PEN']);

const NAME_ALIASES = {
  usa: 'united states',
  'united states': 'usa',
  'south korea': 'korea republic',
  'korea republic': 'south korea',
  'ivory coast': 'cote divoire',
  'cote divoire': 'ivory coast',
  'czech republic': 'czechia',
  czechia: 'czech republic',
  'dr congo': 'congo dr',
  'congo dr': 'dr congo',
};

function normName(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z ]/g, '')
    .trim();
}

function sameTeamName(a, b) {
  const na = normName(a);
  const nb = normName(b);
  return na === nb || NAME_ALIASES[na] === nb || NAME_ALIASES[nb] === na;
}

// Mutates `rawMatches`, replacing scores for matches the live feed reports as
// finished. Returns the number of matches overlaid.
function applyScoreOverlay(rawMatches, apiMatches) {
  let applied = 0;
  for (const m of rawMatches) {
    if (isPlaceholder(m.team1) || isPlaceholder(m.team2)) continue;

    const candidates = apiMatches.filter(
      (a) =>
        FINISHED_STATUSES.has(a.short) &&
        a.goalsHome != null &&
        a.goalsAway != null &&
        ((sameTeamName(a.home, m.team1) && sameTeamName(a.away, m.team2)) ||
          (sameTeamName(a.home, m.team2) && sameTeamName(a.away, m.team1))),
    );
    if (!candidates.length) continue;

    // Disambiguate rematches (rare) by choosing the fixture nearest m.date.
    const target = m.date ? Date.parse(`${m.date}T00:00:00Z`) : NaN;
    if (Number.isFinite(target) && candidates.length > 1) {
      candidates.sort(
        (x, y) =>
          Math.abs(Date.parse(x.dateUtc) - target) - Math.abs(Date.parse(y.dateUtc) - target),
      );
    }
    const a = candidates[0];
    const homeIsTeam1 = sameTeamName(a.home, m.team1);
    const g1 = homeIsTeam1 ? a.goalsHome : a.goalsAway;
    const g2 = homeIsTeam1 ? a.goalsAway : a.goalsHome;

    m.score = { ft: [g1, g2], ht: m.score?.ht };
    applied++;
  }
  return applied;
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
  resolveKnockoutSlots(matches, standings);
  const bracket = computeBracket(matches);

  return { matches, teams, groups, standings, bracket };
}

// Resolve knockout placeholder codes into real teams as results come in:
//   - "1A"/"2B"/"3C": group position, only once that group has finished all
//     its games (standings are final);
//   - "W73"/"L73": winner/loser of a knockout tie, only when that tie has a
//     decisive result (a draw means it went to penalties, which we can't read
//     from the score alone — left as a placeholder).
// Third-place combo codes like "3A/B/C/D/F" need FIFA's third-place ranking
// table across ALL groups, so they're intentionally left unresolved here.
function resolveKnockoutSlots(matches, standings) {
  // Final group positions, keyed "1A".."4L", for completed groups only.
  const posTeam = {};
  for (const [gname, rows] of Object.entries(standings)) {
    const letter = gname.replace(/^Group\s+/i, '');
    if (!rows.length || !rows.every((r) => r.played === 3)) continue; // not final yet
    for (const r of rows) posTeam[`${r.rank}${letter}`] = r.team;
  }

  const byNum = new Map(matches.map((m) => [m.num, m]));
  const resolveSlot = (slot) => {
    if (!slot) return null;
    if (/^[1-3][A-L]$/.test(slot)) return posTeam[slot] ?? null;
    const wl = /^([WL])(\d+)$/.exec(slot);
    if (wl) {
      const src = byNum.get(Number(wl[2]));
      if (!src?.finished || !src.score?.ft) return null;
      const [g1, g2] = src.score.ft;
      if (g1 === g2) return null; // penalty shoot-out — winner unknown from score
      const winner = g1 > g2 ? src.team1 : src.team2;
      const loser = g1 > g2 ? src.team2 : src.team1;
      const pick = wl[1] === 'W' ? winner : loser;
      return isPlaceholder(pick) ? null : pick; // don't chain through placeholders
    }
    return null;
  };

  // A few passes so later-round W/L codes fill in once their source resolves.
  for (let pass = 0; pass < KNOCKOUT_ROUNDS.length; pass++) {
    let changed = false;
    for (const m of matches) {
      if (m.stage !== 'knockout') continue;
      for (const side of ['team1', 'team2']) {
        if (!isPlaceholder(m[side])) continue;
        const name = resolveSlot(m[side]);
        if (!name) continue;
        m[side] = name;
        m[`${side}Slug`] = slugify(name);
        m[`${side}Flag`] = flagFor(name);
        changed = true;
      }
    }
    if (!changed) break;
  }
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
// fetch, or a match has kicked off OR is expected to have ended since the last
// sync (so a 30-min cadence only does work when the schedule has progressed).
function shouldFetch(prevMatches, lastFetchAt) {
  if (process.env.FORCE === '1') return { run: true, reason: 'FORCE=1' };
  if (!prevMatches || !prevMatches.length) return { run: true, reason: 'no existing data' };
  if (!lastFetchAt) return { run: true, reason: 'no lastFetchAt recorded' };

  const now = Date.now();
  const last = new Date(lastFetchAt).getTime();
  const pendingWindow = PENDING_RESULT_WINDOW_H * 3600_000;
  for (const m of prevMatches) {
    if (!m.kickoff) continue;
    const kickoff = new Date(m.kickoff).getTime();
    const ended = kickoff + MATCH_DURATION_MIN * 60_000;
    if (kickoff <= now && kickoff > last) {
      return { run: true, reason: `match ${m.num} (${m.team1} v ${m.team2}) kicked off since last sync` };
    }
    if (ended <= now && ended > last) {
      return { run: true, reason: `match ${m.num} (${m.team1} v ${m.team2}) finished since last sync` };
    }
    // Backfill catch-up: a match that should be over but whose result we haven't
    // recorded yet. Upstream can publish the score after full-time, so keep
    // re-checking (each run re-fetches all matches) until it lands.
    if (ended <= now && now - ended < pendingWindow && !m.finished) {
      return { run: true, reason: `match ${m.num} (${m.team1} v ${m.team2}) ended; result not yet recorded` };
    }
  }
  return { run: false, reason: 'no match started/ended and no results pending' };
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

  // Overlay authoritative finished-match scores from the live feed (via Worker).
  // Best-effort: any failure leaves the resilient upbound base untouched.
  const fixturesUrl = process.env.LIVE_FIXTURES_URL;
  let overlaid = 0;
  if (fixturesUrl) {
    try {
      const fr = await fetch(fixturesUrl, { headers: { accept: 'application/json' } });
      if (fr.ok) {
        const fj = await fr.json();
        const apiMatches = Array.isArray(fj.matches) ? fj.matches : [];
        overlaid = applyScoreOverlay(raw.matches, apiMatches);
        console.log(
          `• Live-feed overlay: ${overlaid} finished score(s) from ${apiMatches.length} fixtures (status: ${fj.meta?.status ?? 'n/a'}).`,
        );
      } else {
        console.warn(`• Overlay skipped: fixtures endpoint HTTP ${fr.status}.`);
      }
    } catch (e) {
      console.warn(`• Overlay skipped: ${e.message}.`);
    }
  }

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
    sourceName: fixturesUrl
      ? 'upbound-web (base) + worldcup26.ir (results)'
      : 'upbound-web/worldcup-live.json',
    counts: {
      matches: matches.length,
      teams: teams.length,
      groups: Object.keys(groups).length,
      finished: finishedCount,
      overlaid,
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
