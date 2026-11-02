// Summarises a replay of the ToC from Week 1 and checks it against the Week 5 state the commissioner supplied.
// Usage: node scripts/backfill-report.mjs public/data.json tests/week5-state.json > reports/backfill.json
import { readFile } from 'node:fs/promises';

const [dataPath, basePath] = process.argv.slice(2);
const data = JSON.parse(await readFile(dataPath, 'utf8'));
const base = JSON.parse(await readFile(basePath, 'utf8'));
const r2 = n => Math.round(n * 100) / 100;
const toc = data.toc;
const weeks = Object.keys(toc.weeks).map(Number).sort((a, b) => a - b);

// weekly[owner][week] = best-ball points, for every team that was still in the field that week
const weekly = {}, who = {};
for (const w of weeks) {
  const wk = toc.weeks[w];
  for (const row of [...wk.survival, ...wk.revival]) {
    (weekly[row.owner] = weekly[row.owner] || {})[w] = row.pts;
    who[row.owner] = { league: row.league, team: row.team };
  }
}

// what happened each week
const events = weeks.map(w => {
  const wk = toc.weeks[w];
  return {
    week: w, status: wk.verdict.state, final: wk.final, projected: !!wk.projected,
    survivalTeams: wk.survival.length, revivalTeams: wk.revival.length,
    demoted: wk.demotedAll || (wk.demoted ? [wk.demoted] : []),
    eliminated: wk.eliminatedAll || (wk.eliminated ? [wk.eliminated] : [])
  };
});

const sum = (o, from, to) => r2(Object.entries(weekly[o] || {}).filter(([w]) => +w >= from && +w <= to).reduce((s, [, p]) => s + p, 0));

// every team that has been eliminated, with the weeks it played
const elimWeekOf = {};
for (const e of events) for (const o of e.eliminated) elimWeekOf[o] = e.week;
const eliminated = Object.entries(elimWeekOf).sort((a, b) => a[1] - b[1]).map(([owner, week]) => ({
  owner, ...who[owner], eliminatedWeek: week, final: toc.weeks[week].final, status: toc.weeks[week].verdict.state,
  weekly: weekly[owner],
  totalWeeks2ToElim: sum(owner, 2, week),
  totalWeeks1ToElim: sum(owner, 1, week)
}));

// ---- validation against the state supplied for the start of Week 5 -------------------------------
const setOf = (rows) => new Set(rows.map(r => r.owner));
const w5 = toc.weeks[5];
const eq = (a, b) => a.size === b.size && [...a].every(x => b.has(x));
const survivalOk = !!w5 && eq(setOf(w5.survival), new Set(base.survival));
const revivalOk = !!w5 && eq(setOf(w5.revival), new Set(base.revival));
const elimBefore5 = eliminated.filter(e => e.eliminatedWeek < 5);
const elimOwnersOk = eq(new Set(elimBefore5.map(e => e.owner)), new Set(base.eliminated.map(e => e.owner)));

const cmp = (from) => {
  const rows = Object.entries(base.cumBefore).map(([owner, expected]) => {
    const got = sum(owner, from, 4);
    return { owner, expected, got, delta: r2(got - expected) };
  });
  const elim = base.eliminated.map(e => {
    const x = elimBefore5.find(y => y.owner === e.owner);
    const got = x ? sum(e.owner, from, x.eliminatedWeek) : null;
    return { owner: e.owner, expected: e.total, got, delta: got === null ? null : r2(got - e.total) };
  });
  const all = [...rows, ...elim].filter(r => r.delta !== null);
  return {
    fromWeek: from,
    teamsChecked: all.length,
    withinOneCent: all.filter(r => Math.abs(r.delta) <= 0.01).length,
    maxAbsDelta: r2(Math.max(...all.map(r => Math.abs(r.delta)))),
    rows: [...rows, ...elim]
  };
};
const validation = {
  weeksReplayed: weeks,
  bracketsAtStartOfWeek5: { survivalMatches: survivalOk, revivalMatches: revivalOk, eliminatedBefore5Match: elimOwnersOk },
  totalsIfToCCountsWeeks2to4: cmp(2),
  totalsIfWeek1Counts: cmp(1)
};

// ---- table of every team's weekly points -----------------------------------------------------------
const table = Object.keys(weekly).map(owner => ({
  owner, ...who[owner], weekly: weekly[owner],
  eliminatedWeek: elimWeekOf[owner] || null,
  totalWeeks2On: sum(owner, 2, 99)
})).sort((a, b) => b.totalWeeks2On - a.totalWeeks2On);

const out = { generatedAt: data.meta.generatedAt, nflWeek: data.meta.nflWeek, latestToCWeek: toc.latestWeek, validation, events, eliminated, table };
console.log(JSON.stringify(out, null, 1));

// short human summary on stderr (shows in the job log)
const v = validation;
console.error(`Replayed weeks ${weeks.join(', ')}.`);
console.error(`Week 5 brackets: survival ${survivalOk ? 'match' : 'DIFFER'}, revival ${revivalOk ? 'match' : 'DIFFER'}, eliminated-before-5 ${elimOwnersOk ? 'match' : 'DIFFER'}.`);
for (const k of ['totalsIfToCCountsWeeks2to4', 'totalsIfWeek1Counts']) {
  console.error(`${k}: ${v[k].withinOneCent}/${v[k].teamsChecked} within 1 cent, max difference ${v[k].maxAbsDelta}`);
}
