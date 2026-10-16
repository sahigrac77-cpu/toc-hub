// ToC best-ball scoring: player points from raw NFL stats, then the best lineup for a roster.
export const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'FLEX', 'SF'];
const ELIGIBLE = { QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], FLEX: ['RB', 'WR', 'TE'], SF: ['QB', 'RB', 'WR', 'TE'] };

export function scorePlayer(stat, pos) {
  const g = k => Number((stat && stat[k]) || 0);
  let p = 0.04 * g('pass_yd') + 6 * g('pass_td') - 2 * g('pass_int') + (g('pass_yd') >= 300 ? 2 : 0);
  p += 0.1 * g('rush_yd') + 6 * g('rush_td') + 0.25 * g('rush_att') + (g('rush_yd') >= 100 ? 2 : 0);
  p += 0.1 * g('rec_yd') + 6 * g('rec_td') + (g('rec_yd') >= 100 ? 2 : 0);
  if (pos === 'RB' || pos === 'WR' || pos === 'TE') p += g('rec') * (pos === 'TE' ? 2 : 1);
  p += 2 * (g('pass_2pt') + g('rush_2pt') + g('rec_2pt')) - 2 * g('fum_lost') + 6 * g('fum_rec_td');
  return Math.round(p * 100) / 100;
}

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

// players: [{id, name, pos, pts}] -> {total, lineup: [{slot, id, name, pos, pts}]}
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
    if (pl && ELIGIBLE[SLOTS[i]].includes(pl.pos)) { lineup.push({ slot: SLOTS[i], id: pl.id, name: pl.name, pos: pl.pos, pts: pl.pts }); total += pl.pts; }
    else lineup.push({ slot: SLOTS[i], id: null, name: 'Empty', pos: '', pts: 0 });
  }
  return { total: Math.round(total * 100) / 100, lineup };
}
