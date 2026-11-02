// Summarises the live site's own ToC state (built from the league's accepted Week 5 start) for the backfill report.
// Usage: node scripts/prod-report.mjs /tmp/prod/data.json > reports/production.json
import { readFile } from 'node:fs/promises';

const data = JSON.parse(await readFile(process.argv[2], 'utf8'));
const toc = data.toc;
const weeks = Object.keys(toc.weeks).map(Number).sort((a, b) => a - b);
const weekly = {}, who = {}, totalNow = {};
for (const w of weeks) {
  const wk = toc.weeks[w];
  for (const r of [...wk.survival, ...wk.revival]) {
    (weekly[r.owner] = weekly[r.owner] || {})[w] = r.pts;
    who[r.owner] = { league: r.league, team: r.team };
    totalNow[r.owner] = r.total;
  }
}
const events = weeks.map(w => {
  const wk = toc.weeks[w];
  return {
    week: w, status: wk.verdict.state, final: wk.final,
    demoted: wk.demotedAll || (wk.demoted ? [wk.demoted] : []),
    eliminated: wk.eliminatedAll || (wk.eliminated ? [wk.eliminated] : [])
  };
});
console.log(JSON.stringify({
  generatedAt: data.meta.generatedAt, nflWeek: data.meta.nflWeek, startWeek: toc.startWeek, latestToCWeek: toc.latestWeek,
  eliminated: toc.eliminated.map(e => ({ ...e, ...who[e.owner] })),
  survivalNow: toc.survival, revivalNow: toc.revival, totalNow, weekly, events
}, null, 1));
