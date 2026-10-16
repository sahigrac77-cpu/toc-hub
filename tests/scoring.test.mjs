// Run with: node --test tests/
// Three-way check on real Week 5 stat lines: hand-worked expected value (from the bylaws text),
// the site scorer, and the independent bylaws scorer. All three must agree to the cent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scorePlayer, bestBall, SLOTS } from '../scripts/toc-scoring.mjs';
import { bylawsScore } from '../scripts/audit/bylaws-scorer.mjs';

const { cases } = JSON.parse(readFileSync(new URL('./stat-lines.json', import.meta.url), 'utf8'));
const close = (a, b) => Math.abs(a - b) < 0.005;

for (const c of cases) {
  test(`${c.name}: hand = site scorer = bylaws scorer`, () => {
    const site = scorePlayer(c.stat, c.pos);
    const indep = bylawsScore(c.stat, c.pos).pts;
    assert.ok(close(site, c.expected), `site scorer ${site} vs hand ${c.expected}`);
    assert.ok(close(indep, c.expected), `bylaws scorer ${indep} vs hand ${c.expected}`);
  });
  if (c.alt) test(`${c.name}: alternative reading (${JSON.stringify(c.alt)}) is what moves the number`, () => {
    const { expected, ...rules } = c.alt;
    assert.ok(close(scorePlayer(c.stat, c.pos, { qbReceptionPoints: 0, combined100Bonus: false, ...rules }), expected));
  });
}

test('best-ball solver matches brute force on a small roster', () => {
  const pool = [
    { id: 'a', pos: 'QB', pts: 30 }, { id: 'b', pos: 'QB', pts: 25 }, { id: 'c', pos: 'RB', pts: 20 }, { id: 'd', pos: 'RB', pts: 18 },
    { id: 'e', pos: 'RB', pts: 17 }, { id: 'f', pos: 'WR', pts: 22 }, { id: 'g', pos: 'WR', pts: 15 }, { id: 'h', pos: 'WR', pts: 14 },
    { id: 'i', pos: 'TE', pts: 12 }, { id: 'j', pos: 'TE', pts: 11 }, { id: 'k', pos: 'WR', pts: 9 }, { id: 'l', pos: 'RB', pts: 8 }
  ];
  const ok = { QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], FLEX: ['RB', 'WR', 'TE'], SF: ['QB', 'RB', 'WR', 'TE'] };
  let best = -1;
  (function go(i, used, sum) {
    if (i === SLOTS.length) { best = Math.max(best, sum); return; }
    for (let j = 0; j < pool.length; j++) if (!used.has(j) && ok[SLOTS[i]].includes(pool[j].pos)) { used.add(j); go(i + 1, used, sum + pool[j].pts); used.delete(j); }
  })(0, new Set(), 0);
  assert.equal(bestBall(pool).total, best);
});
