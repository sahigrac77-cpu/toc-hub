// Pulls the six sub-leagues from Sleeper and writes public/data.json for the site.
// Run with: node scripts/build-data.mjs     (Node 20+, no dependencies)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scorePlayer, bestBall } from './toc-scoring.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(await readFile(join(ROOT, 'config.json'), 'utf8'));
const API = process.env.SLEEPER_API || 'https://api.sleeper.app/v1';
const OUT = process.env.OUT_FILE || join(ROOT, 'public', 'data.json');
const POS_OK = new Set(['QB', 'RB', 'WR', 'TE']);

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
const r2 = n => Math.round(n * 100) / 100;

// ---- NFL state -------------------------------------------------------------
const state = await get(`${API}/state/nfl`);
const regular = state.season_type === 'regular';
const maxWeek = regular ? Math.min(Number(state.week) || 1, 18) : 18;
const isFinal = w => !regular || w < Number(state.week);

// ---- sub-leagues -----------------------------------------------------------
const leagues = [];
for (const L of cfg.leagues) {
  const [users, rosters] = await Promise.all([get(`${API}/league/${L.id}/users`), get(`${API}/league/${L.id}/rosters`)]);
  const byUser = Object.fromEntries(users.map(u => [u.user_id, u]));
  const weeks = {};
  for (let w = 1; w <= maxWeek; w++) {
    const m = await get(`${API}/league/${L.id}/matchups/${w}`);
    if (Array.isArray(m) && m.length) weeks[w] = m;
  }
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
  leagues.push({ ...L, teams, weeks });
}
const owners = leagues.flatMap(l => l.teams.map(t => t.owner));
if (new Set(owners).size !== owners.length) console.warn('Warning: duplicate display names across sub-leagues');

// weeks that have any scoring so far
let latest = 0;
for (const L of leagues) for (const [w, m] of Object.entries(L.weeks)) if (m.some(x => (x.points || 0) > 0)) latest = Math.max(latest, Number(w));
const liveWeek = regular && latest >= Number(state.week);

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
const toc = { startWeek: cfg.toc.startWeek, weeks: {}, latestWeek: null, eliminated: [...cfg.toc.eliminated], survival: [], revival: [] };
const where = {};
for (const L of leagues) for (const t of L.teams) where[t.owner] = { L, t };
let surv = new Set(cfg.toc.survival), rev = new Set(cfg.toc.revival);
const cum = { ...cfg.toc.cumBefore };

if (latest >= cfg.toc.startWeek) {
  const players = await get(`${API}/players/nfl`);
  const info = id => {
    const p = players[id]; if (!p) return null;
    let pos = p.position === 'FB' ? 'RB' : p.position;
    if (!POS_OK.has(pos)) return null;
    return { pos, name: `${p.first_name || ''} ${p.last_name || ''}`.trim() || id };
  };
  for (let w = cfg.toc.startWeek; w <= latest; w++) {
    const stats = await get(`${API}/stats/nfl/regular/${cfg.season}/${w}`);
    const rows = [];
    for (const owner of [...surv, ...rev]) {
      const at = where[owner];
      if (!at) { console.warn('ToC team not found in Sleeper:', owner); continue; }
      const m = (at.L.weeks[w] || []).find(x => x.roster_id === at.t.rosterId);
      const ids = (m && m.players) || [];
      const list = [];
      for (const id of ids) { const i = info(id); if (i) list.push({ id, name: i.name, pos: i.pos, pts: scorePlayer(stats[id], i.pos) }); }
      const { total, lineup } = bestBall(list);
      cum[owner] = r2((cum[owner] || 0) + total);
      rows.push({ owner, league: at.L.name, team: at.t.team, bracket: surv.has(owner) ? 'survival' : 'revival', pts: total, total: cum[owner], lineup });
    }
    rows.sort((a, b) => b.pts - a.pts);
    const s = rows.filter(r => r.bracket === 'survival'), v = rows.filter(r => r.bracket === 'revival');
    const demoted = s.length > 1 ? s[s.length - 1].owner : null;
    const eliminated = v.length ? v[v.length - 1].owner : null;
    const final = isFinal(w);
    toc.weeks[w] = { final, survival: s, revival: v, demoted, eliminated };
    if (final) {
      if (eliminated) { rev.delete(eliminated); toc.eliminated.push({ owner: eliminated, total: cum[eliminated], week: w }); }
      if (demoted) { surv.delete(demoted); rev.add(demoted); }
    }
    toc.latestWeek = w;
  }
}
toc.survival = [...surv]; toc.revival = [...rev];

const data = {
  meta: { generatedAt: new Date().toISOString(), season: cfg.season, nflWeek: Number(state.week) || null, seasonType: state.season_type, latestWeek: latest, liveWeek, me: cfg.me },
  toc, standings, team_of_week, league_flags, top_scores
};
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(data));
console.log(`Wrote ${OUT}: week ${latest}${liveWeek ? ' (live)' : ''}, ${standings.length} teams, ToC weeks ${Object.keys(toc.weeks).join(',') || 'none'}`);
