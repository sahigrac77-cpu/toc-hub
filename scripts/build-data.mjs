// Pulls the six sub-leagues from Sleeper and writes public/data.json for the site,
// plus raw/snapshot.json (every raw response used, for the timestamped archive).
// Run with: node scripts/build-data.mjs     (Node 20+, no dependencies)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_RULES } from './toc-scoring.mjs';
import { makeInfo, scoreRoster, scoreRosterLive, rosterAtLock, differential, marginInfo, r2 } from './toc-core.mjs';
import { parseSheetCsv, reconcileTeam } from './ledger.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(await readFile(join(ROOT, 'config.json'), 'utf8'));
const API = process.env.SLEEPER_API || 'https://api.sleeper.app/v1';
const API2 = process.env.SLEEPER_API2 || 'https://api.sleeper.com';
const OUT = process.env.OUT_FILE || join(ROOT, 'public', 'data.json');
const RAW_OUT = process.env.RAW_OUT || join(ROOT, 'raw', 'snapshot.json');
const RULES = cfg.rules;

async function get(url, tries = 4) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { accept: 'application/json' } });
      if (r.ok) return await r.json();
      err = new Error(`${r.status} ${url}`);
    } catch (e) { err = e; }
    await new Promise(res => setTimeout(res, 1000 * (i + 1)));
  }
  throw err;
}
// Optional endpoints: never let them break the build, but remember that they failed.
const missing = [];
async function getOpt(url) { try { return await get(url, 2); } catch (e) { missing.push(url.replace(API2, '').replace(API, '')); return null; } }

// Schedule status and projections for a week that is still being played.
let scheduleAll;
async function liveContext(w) {
  scheduleAll = scheduleAll === undefined ? await getOpt(`${API2}/schedule/nfl/regular/${cfg.season}`) : scheduleAll;
  const games = (Array.isArray(scheduleAll) ? scheduleAll : []).filter(g => Number(g.week) === w);
  const pos = ['QB', 'RB', 'WR', 'TE'].map(p => 'position%5B%5D=' + p).join('&');
  const pj = await getOpt(`${API2}/projections/nfl/${cfg.season}/${w}?season_type=regular&${pos}`);
  if (!games.length || !Array.isArray(pj) || !pj.length) return null;
  const gameOfTeam = {};
  for (const g of games) { gameOfTeam[g.home] = g; gameOfTeam[g.away] = g; }
  const proj = {};
  for (const x of pj) if (x.player_id && x.stats) proj[x.player_id] = { stats: x.stats };
  raw.live = { week: w, schedule: games, projectionCount: pj.length };
  return { gameOfTeam, proj };
}

const fetchedAt = new Date().toISOString();
const raw = { fetchedAt, api: API, season: cfg.season, leagues: {}, stats: {}, players: {} };

// ---- NFL state -------------------------------------------------------------
const state = await get(`${API}/state/nfl`);
raw.state = state;
const regular = state.season_type === 'regular';
const maxWeek = regular ? Math.min(Number(state.week) || 1, 18) : 18;
const isFinal = w => !regular || w < Number(state.week);

// ---- sub-leagues -----------------------------------------------------------
const leagues = [];
for (const L of cfg.leagues) {
  const [users, rosters] = await Promise.all([get(`${API}/league/${L.id}/users`), get(`${API}/league/${L.id}/rosters`)]);
  const settings = await getOpt(`${API}/league/${L.id}`);
  const byUser = Object.fromEntries(users.map(u => [u.user_id, u]));
  const weeks = {};
  for (let w = 1; w <= maxWeek; w++) {
    const m = await get(`${API}/league/${L.id}/matchups/${w}`);
    if (Array.isArray(m) && m.length) weeks[w] = m;
  }
  raw.leagues[L.id] = { name: L.name, settings, users, rosters, matchups: weeks, transactions: {} };
  const teams = rosters.map(r => {
    const u = byUser[r.owner_id] || {};
    const s = r.settings || {};
    return {
      rosterId: r.roster_id, owner: u.display_name || `Roster ${r.roster_id}`,
      team: (u.metadata && u.metadata.team_name) || '',
      w: s.wins || 0, l: s.losses || 0, t: s.ties || 0,
      pf: r2((s.fpts || 0) + (s.fpts_decimal || 0) / 100), pa: r2((s.fpts_against || 0) + (s.fpts_against_decimal || 0) / 100),
      league: L.name
    };
  });
  leagues.push({ ...L, teams, weeks, tx: {} });
}
const owners = leagues.flatMap(l => l.teams.map(t => t.owner));
if (new Set(owners).size !== owners.length) console.warn('Warning: duplicate display names across sub-leagues');

// weeks that have any scoring so far
let latest = 0;
for (const L of leagues) for (const [w, m] of Object.entries(L.weeks)) if (m.some(x => (x.points || 0) > 0)) latest = Math.max(latest, Number(w));
const liveWeek = regular && latest >= Number(state.week);
// When the NFL week has turned over but no game has been scored yet, still show that ToC week (projections only).
const nflW = Number(state.week) || 0;
const preview = regular && nflW > latest && nflW <= 18 && latest >= cfg.toc.startWeek && leagues.every(L => (L.weeks[nflW] || []).length > 0);
const tocLatest = preview ? nflW : latest;

// Who carries each team: season points by starter (Sleeper's own league scoring), plus where the points come from.
const allPlayers = await getOpt(`${API}/players/nfl`) || {};
const FLEXPOS = new Set(['QB', 'RB', 'WR', 'TE']);
function coreOf(L, rosterId) {
  const by = {}, share = { QB: 0, RB: 0, WR: 0, TE: 0 };
  for (const [w, m] of Object.entries(L.weeks)) {
    const x = m.find(q => q.roster_id === rosterId); if (!x || !Array.isArray(x.starters)) continue;
    x.starters.forEach((id, i) => {
      const pts = (x.starters_points || [])[i]; if (!id || id === '0' || typeof pts !== 'number') return;
      const pl = allPlayers[id] || {}, pos = pl.position === 'FB' ? 'RB' : pl.position;
      const rec = by[id] = by[id] || { id, name: `${pl.first_name || ''} ${pl.last_name || ''}`.trim() || String(id), pos: pos || '', team: pl.team || '', pts: 0, weeks: 0, best: 0 };
      rec.pts += pts; rec.weeks++; rec.best = Math.max(rec.best, pts);
      if (FLEXPOS.has(pos)) share[pos] += pts;
    });
  }
  const list = Object.values(by).sort((a, b) => b.pts - a.pts);
  const tot = Object.values(share).reduce((a, b) => a + b, 0) || 1;
  return { core: list.slice(0, 5).map(p => ({ name: p.name, pos: p.pos, team: p.team, pts: r2(p.pts), weeks: p.weeks, best: r2(p.best) })), mix: Object.fromEntries(Object.entries(share).map(([k, v]) => [k, Math.round(100 * v / tot)])) };
}

const standings = [], team_of_week = [], league_flags = [], allScores = [];
for (const L of leagues) {
  const pts = (w, rid) => { const x = (L.weeks[w] || []).find(m => m.roster_id === rid); return x ? r2(x.points || 0) : 0; };
  const order = [...L.teams].sort((a, b) => (b.w + b.t / 2) - (a.w + a.t / 2) || b.pf - a.pf);
  order.forEach((t, i) => {
    const rank = i + 1;
    const scores = []; for (let w = 1; w <= latest; w++) scores.push(pts(w, t.rosterId));
    standings.push({
      league: L.name, rank, owner: t.owner, team: t.team, w: t.w, l: t.l, t: t.t,
      record: `${t.w}-${t.l}${t.t ? '-' + t.t : ''}`, pf: t.pf, pa: t.pa, scores,
      ...coreOf(L, t.rosterId),
      zone: rank <= 3 ? 'ToC qualifier' : rank === 4 ? 'ToC play-in' : rank <= 6 ? 'Playoffs' : ''
    });
    t.scores = scores;
  });
  for (let w = 1; w <= latest; w++) {
    const best = [...L.teams].sort((a, b) => b.scores[w - 1] - a.scores[w - 1])[0];
    if (best) team_of_week.push({ league: L.name, week: w, owner: best.owner, pts: best.scores[w - 1] });
    for (const t of L.teams) allScores.push({ week: w, owner: t.owner, league: L.name, pts: t.scores[w - 1] });
  }
  const low = [...L.teams].sort((a, b) => a.pf - b.pf)[0], pa = [...L.teams].sort((a, b) => b.pa - a.pa)[0];
  league_flags.push({ league: L.name, lowest_pf_owner: low.owner, lowest_pf: low.pf, most_pa_owner: pa.owner, most_pa: pa.pa });
}
const top_scores = [];
for (let w = 1; w <= latest; w++) {
  allScores.filter(x => x.week === w).sort((a, b) => b.pts - a.pts).slice(0, 3)
    .forEach((x, i) => top_scores.push({ week: w, place: i + 1, owner: x.owner, league: x.league, pts: x.pts }));
}

// ---- Tournament of Champions ----------------------------------------------
const toc = { startWeek: cfg.toc.startWeek, weeks: {}, latestWeek: null, eliminated: cfg.toc.eliminated.map(e => ({ ...e })), survival: [], revival: [] };
const where = {};
for (const L of leagues) for (const t of L.teams) where[t.owner] = { L, t };
let surv = new Set(cfg.toc.survival), rev = new Set(cfg.toc.revival);
const cum = { ...cfg.toc.cumBefore };
let audit = null, priorProvisional = false, ledgerOut = null;
const statsCache = {};

const VARIANTS = [
  { id: 'qb-reception', label: 'a quarterback earns no points for a reception', rules: { ...DEFAULT_RULES, qbReceptionPoints: 0 } },
  { id: 'combined-100', label: 'the 100-yard bonus also counts rushing + receiving combined', rules: { ...DEFAULT_RULES, combined100Bonus: true } },
  { id: 'roster-lock', label: 'rosters lock at the first Thursday kickoff', rules: DEFAULT_RULES, lock: true }
];

if (tocLatest >= cfg.toc.startWeek) {
  const players = Object.keys(allPlayers).length ? allPlayers : await get(`${API}/players/nfl`);
  const info = makeInfo(players);
  for (let w = cfg.toc.startWeek; w <= tocLatest; w++) {
    const stats = statsCache[w] = w > latest ? ((await getOpt(`${API}/stats/nfl/regular/${cfg.season}/${w}`)) || {}) : await get(`${API}/stats/nfl/regular/${cfg.season}/${w}`);
    for (const L of leagues) { L.tx[w] = await getOpt(`${API}/league/${L.id}/transactions/${w}`); raw.leagues[L.id].transactions[w] = L.tx[w]; }
    const lockMs = Date.parse(RULES.week1KickoffUtc) + (w - 1) * 7 * 864e5;
    const txOk = leagues.every(L => Array.isArray(L.tx[w]));

    const idsFor = (owner, lock) => {
      const at = where[owner];
      const m = (at.L.weeks[w] || []).find(x => x.roster_id === at.t.rosterId);
      const ids = (m && m.players) || [];
      return lock ? rosterAtLock(ids, at.t.rosterId, at.L.tx[w], lockMs) : { ids, changes: [] };
    };
    const field = [...surv, ...rev].filter(o => { if (!where[o]) { console.warn('ToC team not found in Sleeper:', o); return false; } return true; });
    const nameOf = id => { const i = info(id); return i ? i.name : String(id); };

    // baseline (bylaws read literally) with full working for every player
    const liveCtx = isFinal(w) ? null : await liveContext(w);
    const rows = field.map(owner => {
      const at = where[owner], { ids } = idsFor(owner, false), after = idsFor(owner, true).changes;
      const sc = liveCtx ? scoreRosterLive(ids, stats, info, DEFAULT_RULES, { season: cfg.season, week: w, ...liveCtx }) : scoreRoster(ids, stats, info, DEFAULT_RULES, { season: cfg.season, week: w });
      cum[owner] = r2((cum[owner] || 0) + (liveCtx ? sc.actual : sc.total));
      return {
        owner, league: at.L.name, team: at.t.team, bracket: surv.has(owner) ? 'survival' : 'revival', pts: sc.total, total: cum[owner], lineup: sc.lineup,
        ...(liveCtx ? { actual: sc.actual, remaining: sc.remaining } : {}),
        afterLock: after.map(c => ({ type: c.type, at: c.at, ...(c.add ? { add: nameOf(c.add) } : { drop: nameOf(c.drop) }) }))
      };
    });
    rows.sort((a, b) => b.pts - a.pts);
    const s = rows.filter(r => r.bracket === 'survival'), v = rows.filter(r => r.bracket === 'revival');
    const nDem = Math.min(Number((cfg.toc.demotions || {})[w]) || 1, Math.max(s.length - 1, 0));
    const demotedAll = s.slice(s.length - nDem).reverse().map(r => r.owner);   // lowest first
    const demoted = demotedAll[0] || null;
    const eliminated = v.length ? v[v.length - 1].owner : null;
    const final = isFinal(w);

    // same week, other readings of the rules the bylaws leave open
    const answeredIds = new Set(RULES.questions.filter(q => q.status === 'answered').map(q => q.id));
    const variants = VARIANTS.filter(V => !answeredIds.has(V.id)).map(V => {
      if (V.lock && !txOk) return { id: V.id, label: V.label, unavailable: true };
      const tot = field.map(owner => {
        const { ids } = idsFor(owner, !!V.lock);
        return { owner, bracket: surv.has(owner) ? 'survival' : 'revival', pts: scoreRoster(ids, stats, info, V.rules).total };
      });
      const lo = (br, n) => tot.filter(x => x.bracket === br).sort((a, b) => a.pts - b.pts).slice(0, n).map(x => x.owner);
      const d = nDem ? lo('survival', nDem).join('+') : null, e = v.length ? lo('revival', 1)[0] : null;
      const moved = tot.map(x => ({ owner: x.owner, delta: r2(x.pts - rows.find(r => r.owner === x.owner).pts) })).filter(x => Math.abs(x.delta) > 0.004);
      return { id: V.id, label: V.label, demoted: d, eliminated: e, flips: d !== (demotedAll.length ? [...demotedAll].join('+') : null) || e !== eliminated, moved };
    });

    const margins = { survival: marginInfo(s, RULES.margins, nDem || 1), revival: marginInfo(v, RULES.margins) };
    const reasons = []; let st = 'final';
    if (!final) { st = 'live'; reasons.push(w > latest ? 'This week has not started yet: every lineup is projections only.' : 'The NFL week is still in progress.'); }
    else {
      for (const x of variants) {
        if (x.unavailable) { st = 'provisional'; reasons.push('Transaction history could not be loaded, so the roster-lock reading was not tested.'); }
        else if (x.flips) { st = 'provisional'; reasons.push(`The result changes if ${x.label}.`); }
      }
      for (const [b, m] of Object.entries(margins)) if (m && m.level === 'inside') { st = 'provisional'; reasons.push(`${m.lowest} is lowest by only ${m.margin} points over ${m.next}, less than one stat correction (${RULES.margins.oneEvent} points).`); }
      if (priorProvisional) { st = 'provisional'; reasons.push('This week’s field depends on an earlier result that is still provisional.'); }
      if (st === 'final') {
        for (const [b, m] of Object.entries(margins)) if (m && m.level === 'watch') { st = 'stands'; reasons.push(`${m.lowest} is lowest by ${m.margin} points over ${m.next}: a single touchdown change could flip it.`); }
        const open = RULES.questions.filter(q => q.status !== 'answered');
        if (open.length) { st = 'stands'; reasons.push(`Rules still unconfirmed by the commissioner: ${open.map(q => q.id).join(', ')}. The result is the same under every reading tested.`); }
      }
    }
    toc.weeks[w] = { final, projected: !!liveCtx, preview: w > latest, lockedAt: new Date(lockMs).toISOString(), correctionsCloseAt: new Date(lockMs + 7 * 864e5).toISOString(), survival: s, revival: v, demoted, demotedAll, eliminated, margins, variants, verdict: { state: st, reasons } };
    if (final) {
      if (eliminated) { rev.delete(eliminated); toc.eliminated.push({ owner: eliminated, total: cum[eliminated], week: w, provisional: st !== 'final' }); }
      for (const o of demotedAll) { surv.delete(o); rev.add(o); }
      if (st === 'provisional') priorProvisional = true;
    }
    toc.latestWeek = w;

    // differential check of the two scorers on every player on every ToC roster this week
    const allIds = field.flatMap(o => idsFor(o, false).ids);
    const d = differential(allIds, stats, info);
    audit = { week: w, compared: d.compared, diffs: d.diffs, unhandledStatKeys: d.unhandled };
    raw.stats[w] = Object.fromEntries([...new Set(allIds)].filter(id => stats[id]).map(id => [id, stats[id]]));
    for (const id of allIds) if (players[id]) raw.players[id] = { first_name: players[id].first_name, last_name: players[id].last_name, position: players[id].position, team: players[id].team };
  }

  // ---- reconcile the commissioner's sheet against the site, player by player ----
  let expected = null;
  try { expected = JSON.parse(await readFile(join(ROOT, 'tests', 'expected.json'), 'utf8')); } catch { /* optional */ }
  if (expected) try {
    const tol = expected.tolerance || 0.01, tabs = [];
    for (const tab of expected.tabs) {
      const sheet = parseSheetCsv(await readFile(join(ROOT, 'tests', tab.file), 'utf8'));
      const tried = [], skipped = [];
      for (const w of tab.weekCandidates) {
        if (!leagues.every(L => L.weeks[w])) continue;
        let stats;
        try { stats = statsCache[w] || (statsCache[w] = await get(`${API}/stats/nfl/regular/${cfg.season}/${w}`, 2)); }
        catch (e) { skipped.push({ week: w, reason: e.message }); continue; }
        const teams = sheet.filter(sr => where[sr.owner]).map(sr => {
          const at = where[sr.owner], m = (at.L.weeks[w] || []).find(x => x.roster_id === at.t.rosterId);
          const sc = scoreRoster((m && m.players) || [], stats, info, DEFAULT_RULES, { season: cfg.season, week: w });
          return { ...reconcileTeam(sr, sc.players, sc.total, sc.lineup), league: at.L.name };
        });
        tried.push({ week: w, sumAbsDelta: r2(teams.reduce((a, t) => a + Math.abs(t.delta), 0)), teams });
      }
      if (!tried.length) { tabs.push({ file: tab.file, gid: tab.gid, error: 'No candidate week could be scored', skipped }); continue; }
      const best = tried.reduce((a, b) => (b.sumAbsDelta < a.sumAbsDelta ? b : a));
      tabs.push({
        file: tab.file, gid: tab.gid, weekMatched: best.week, weeksTried: tried.map(t => ({ week: t.week, sumAbsDelta: t.sumAbsDelta })), skipped,
        teams: best.teams.length, exact: best.teams.filter(t => Math.abs(t.delta) <= tol).length,
        maxAbsDelta: r2(Math.max(...best.teams.map(t => Math.abs(t.delta)))), detail: best.teams
      });
    }
    ledgerOut = { generatedAt: fetchedAt, tolerance: tol, tabs };
  } catch (e) { console.warn('Sheet reconciliation skipped:', e.message); ledgerOut = { generatedAt: fetchedAt, error: String(e.message), tabs: [] }; }
}
toc.survival = [...surv]; toc.revival = [...rev];

let external = null;
try { external = JSON.parse(await readFile(join(ROOT, 'tests', 'external-checks.json'), 'utf8')); } catch { /* optional */ }
const data = {
  meta: { generatedAt: fetchedAt, season: cfg.season, nflWeek: Number(state.week) || null, seasonType: state.season_type, latestWeek: latest, liveWeek, me: cfg.me, missingEndpoints: missing },
  toc, rules: RULES.questions, audit, external, ledger: ledgerOut && { generatedAt: ledgerOut.generatedAt, tolerance: ledgerOut.tolerance, tabs: ledgerOut.tabs.map(({ detail, ...t }) => t) }, standings, team_of_week, league_flags, top_scores
};
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(data));
if (ledgerOut) await writeFile(join(dirname(OUT), 'ledger.json'), JSON.stringify(ledgerOut));
await mkdir(dirname(RAW_OUT), { recursive: true });
await writeFile(RAW_OUT, JSON.stringify(raw));
console.log(`Wrote ${OUT}: week ${latest}${liveWeek ? ' (live)' : ''}, ${standings.length} teams, ToC weeks ${Object.keys(toc.weeks).join(',') || 'none'}; raw snapshot ${RAW_OUT}`);
if (audit && audit.diffs.length) console.warn(`AUDIT: ${audit.diffs.length} player score difference(s) between the two scorers`);
if (missing.length) console.warn('Optional endpoints unavailable:', missing.join(', '));
