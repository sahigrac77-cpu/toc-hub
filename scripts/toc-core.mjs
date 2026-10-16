// Shared ToC logic used by the site build, the backtest and the tests.
import { scoreDetail, bestBall, DEFAULT_RULES } from './toc-scoring.mjs';
import { bylawsScore, coverage } from './audit/bylaws-scorer.mjs';

export const POS_OK = new Set(['QB', 'RB', 'WR', 'TE']);
export const r2 = n => Math.round(n * 100) / 100;

// The stat keys worth showing next to a score (everything the scoring uses).
const SHOW = ['pass_yd', 'pass_td', 'pass_int', 'pass_2pt', 'rush_att', 'rush_yd', 'rush_td', 'rush_2pt', 'rec', 'rec_yd', 'rec_td', 'rec_2pt',
  'fum_lost', 'fum_rec_td', 'kr_td', 'pr_td', 'st_td', 'blk_kick_ret_td'];
export function compactStat(stat) { const o = {}; for (const k of SHOW) if (stat && Number(stat[k])) o[k] = Number(stat[k]); return o; }

export function makeInfo(players) {
  return id => {
    const p = players[id]; if (!p) return null;
    const pos = p.position === 'FB' ? 'RB' : p.position;
    if (!POS_OK.has(pos)) return null;
    return { pos, name: `${p.first_name || ''} ${p.last_name || ''}`.trim() || String(id), team: p.team || '' };
  };
}

// Score one roster (list of player ids) with the given rules. Returns the best-ball lineup with the working for every player.
export function scoreRoster(ids, stats, info, rules = DEFAULT_RULES, ctx = {}) {
  const pool = [];
  for (const id of ids) {
    const i = info(id); if (!i) continue;
    const stat = stats[id], d = scoreDetail(stat, i.pos, rules);
    pool.push({
      id, name: i.name, pos: i.pos, team: i.team, pts: d.pts, parts: d.parts, stat: compactStat(stat),
      src: ctx.season ? `https://api.sleeper.com/stats/nfl/player/${id}?season_type=regular&season=${ctx.season}&grouping=week&week=${ctx.week}` : undefined
    });
  }
  const { total, lineup } = bestBall(pool);
  return { total, lineup, pool: pool.length, players: pool };
}

// Reverse the transactions that happened after `lockMs` so we can see the roster as it stood at lock.
// Only reverses changes that are really visible in the final roster, so it is safe to run on any snapshot.
export function rosterAtLock(finalIds, rosterId, txs, lockMs) {
  const set = new Set(finalIds), changes = [];
  const late = (txs || []).filter(t => t.status === 'complete' && (t.roster_ids || []).includes(rosterId) && t.created >= lockMs)
    .sort((a, b) => b.created - a.created);
  for (const t of late) {
    for (const [pid, rid] of Object.entries(t.adds || {})) if (rid === rosterId && set.has(pid)) { set.delete(pid); changes.push({ type: t.type, at: new Date(t.created).toISOString(), add: pid }); }
    for (const [pid, rid] of Object.entries(t.drops || {})) if (rid === rosterId && !set.has(pid)) { set.add(pid); changes.push({ type: t.type, at: new Date(t.created).toISOString(), drop: pid }); }
  }
  return { ids: [...set], changes };
}

// Run both scorers over every distinct player and report any disagreement + stat keys nobody scores.
export function differential(ids, stats, info) {
  const diffs = [], unhandled = {}; let compared = 0;
  for (const id of new Set(ids)) {
    const i = info(id), st = stats[id]; if (!i || !st) continue;
    compared++;
    const a = scoreDetail(st, i.pos).pts, b = bylawsScore(st, i.pos).pts;
    if (Math.abs(a - b) > 0.005) diffs.push({ id, name: i.name, pos: i.pos, site: a, bylaws: b });
    for (const k of coverage(st)) unhandled[k] = (unhandled[k] || 0) + 1;
  }
  return { compared, diffs, unhandled };
}

// How decisive is the lowest score? margin = gap to the next-lowest team.
export function marginInfo(rows, cfg) {
  if (rows.length < 2) return null;
  const s = [...rows].sort((a, b) => a.pts - b.pts), margin = r2(s[1].pts - s[0].pts);
  const level = margin < cfg.oneEvent ? 'inside' : margin < cfg.oneTouchdown ? 'watch' : 'clear';
  return { lowest: s[0].owner, next: s[1].owner, margin, level };
}
