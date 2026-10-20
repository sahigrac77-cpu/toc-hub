// ToC best-ball scoring: player points from raw NFL stats, then the best lineup for a roster.
// Every rule here is tied to a quoted bylaws line in scripts/audit/bylaws-scorer.mjs (the independent copy).
export const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'FLEX', 'SF'];
const ELIGIBLE = { QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], FLEX: ['RB', 'WR', 'TE'], SF: ['QB', 'RB', 'WR', 'TE'] };

// Interpretations the bylaws leave open. Defaults are the literal reading of the bylaws text.
//  qbReceptionPoints : points per reception for a QB. Bylaws list RB/WR = 1 and TE = 2 and do not name QBs; the commissioner ruled (2026-10-20) that a QB earns 1.
//  combined100Bonus  : also give +2 when rushing+receiving yards together reach 100 (Format list says "100+ Rushing/Receiving Yards")
export const DEFAULT_RULES = { qbReceptionPoints: 1, combined100Bonus: false };

const r2 = n => Math.round(n * 100) / 100;
const OTHER_TD_KEYS = ['fum_rec_td', 'kr_td', 'pr_td', 'st_td', 'blk_kick_ret_td'];

// Returns { pts, parts:[{label, qty, pts}] } so every number can be shown with its working.
export function scoreDetail(stat, pos, rules = DEFAULT_RULES) {
  const g = k => Number((stat && stat[k]) || 0);
  const parts = [];
  const add = (label, qty, pts) => { if (qty) parts.push({ label, qty, pts: r2(pts) }); };
  add('Passing yards', g('pass_yd'), 0.04 * g('pass_yd'));
  add('Passing TD', g('pass_td'), 6 * g('pass_td'));
  add('Interceptions', g('pass_int'), -2 * g('pass_int'));
  if (g('pass_yd') >= 300) add('300+ passing yards bonus', 1, 2);
  add('Rushing yards', g('rush_yd'), 0.1 * g('rush_yd'));
  add('Carries', g('rush_att'), 0.25 * g('rush_att'));
  add('Rushing TD', g('rush_td'), 6 * g('rush_td'));
  if (g('rush_yd') >= 100) add('100+ rushing yards bonus', 1, 2);
  add('Receiving yards', g('rec_yd'), 0.1 * g('rec_yd'));
  add('Receiving TD', g('rec_td'), 6 * g('rec_td'));
  if (g('rec_yd') >= 100) add('100+ receiving yards bonus', 1, 2);
  if (rules.combined100Bonus && g('rush_yd') < 100 && g('rec_yd') < 100 && g('rush_yd') + g('rec_yd') >= 100) add('100+ rushing/receiving combined bonus', 1, 2);
  const perRec = pos === 'TE' ? 2 : (pos === 'RB' || pos === 'WR') ? 1 : (rules.qbReceptionPoints || 0);
  add(`Receptions (${perRec} each)`, g('rec'), perRec * g('rec'));
  const twoPt = g('pass_2pt') + g('rush_2pt') + g('rec_2pt');
  add('2-point conversions', twoPt, 2 * twoPt);
  add('Fumbles lost', g('fum_lost'), -2 * g('fum_lost'));
  const otherTd = OTHER_TD_KEYS.reduce((s, k) => s + g(k), 0);
  add('Fumble-recovery / other TD', otherTd, 6 * otherTd);
  return { pts: r2(parts.reduce((s, x) => s + x.pts, 0)), parts };
}
export const scorePlayer = (stat, pos, rules = DEFAULT_RULES) => scoreDetail(stat, pos, rules).pts;

// Hungarian algorithm (minimum cost), 1-indexed square matrix.
function hungarian(a, n) {
  const INF = 1e18, u = Array(n + 1).fill(0), v = Array(n + 1).fill(0), p = Array(n + 1).fill(0), way = Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i; let j0 = 0;
    const minv = Array(n + 1).fill(INF), used = Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0]; let delta = INF, j1 = 0;
      for (let j = 1; j <= n; j++) if (!used[j]) {
        const cur = a[i0][j] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= n; j++) if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const rowToCol = Array(n + 1).fill(0);
  for (let j = 1; j <= n; j++) rowToCol[p[j]] = j;
  return rowToCol;
}

// players: [{id, name, pos, pts, ...extra}] -> {total, lineup: [{slot, id, name, pos, pts, ...extra}]}
export function bestBall(players) {
  const rows = SLOTS.length, size = Math.max(rows, players.length), BIG = 1000, BAD = 1e6;
  const a = Array.from({ length: size + 1 }, () => Array(size + 1).fill(0));
  for (let i = 0; i < rows; i++) for (let j = 0; j < size; j++) {
    if (j >= players.length) a[i + 1][j + 1] = BIG;                         // empty slot, worth 0
    else a[i + 1][j + 1] = ELIGIBLE[SLOTS[i]].includes(players[j].pos) ? BIG - players[j].pts : BAD;
  }
  const r2c = hungarian(a, size);
  const lineup = []; let total = 0;
  for (let i = 0; i < rows; i++) {
    const j = r2c[i + 1] - 1, pl = players[j];
    if (pl && ELIGIBLE[SLOTS[i]].includes(pl.pos)) { lineup.push({ ...pl, slot: SLOTS[i] }); total += pl.pts; }
    else lineup.push({ slot: SLOTS[i], id: null, name: 'Empty', pos: '', pts: 0 });
  }
  return { total: Math.round(total * 100) / 100, lineup };
}
