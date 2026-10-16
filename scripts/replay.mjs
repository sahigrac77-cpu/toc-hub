// Re-derive ToC scores for one week from a saved raw snapshot, with no network.
// usage: node scripts/replay.mjs <snapshot.json|.json.gz> <week> [--detail owner]
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { DEFAULT_RULES } from './toc-scoring.mjs';
import { makeInfo, scoreRoster } from './toc-core.mjs';

const [, , file, weekArg, flag, who] = process.argv;
if (!file || !weekArg) { console.error('usage: node scripts/replay.mjs <snapshot> <week> [--detail owner]'); process.exit(1); }
const buf = await readFile(file), raw = JSON.parse((file.endsWith('.gz') ? gunzipSync(buf) : buf).toString());
const cfg = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf8'));
const w = Number(weekArg), info = makeInfo(raw.players), stats = raw.stats[w];
if (!stats) { console.error(`Snapshot has no stats for week ${w}. Weeks present: ${Object.keys(raw.stats).join(', ')}`); process.exit(1); }
console.log(`Snapshot taken ${raw.fetchedAt} (NFL week ${raw.state.week}). Scores for ToC week ${w} under the literal bylaws reading:\n`);

const field = new Set([...cfg.toc.survival, ...cfg.toc.revival]);
const out = [];
for (const [id, L] of Object.entries(raw.leagues)) {
  const byUser = Object.fromEntries(L.users.map(u => [u.user_id, u.display_name]));
  for (const r of L.rosters) {
    const owner = byUser[r.owner_id]; if (!field.has(owner)) continue;
    const m = (L.matchups[w] || []).find(x => x.roster_id === r.roster_id);
    const sc = scoreRoster((m && m.players) || [], stats, info, DEFAULT_RULES, { season: raw.season, week: w });
    out.push({ owner, total: sc.total, lineup: sc.lineup });
  }
}
out.sort((a, b) => b.total - a.total);
out.forEach((o, i) => console.log(String(i + 1).padStart(2), o.owner.padEnd(16), o.total.toFixed(2)));
if (flag === '--detail') {
  const o = out.find(x => x.owner === who); if (!o) { console.error('No such team in the field'); process.exit(1); }
  console.log(`\n${who}`);
  for (const l of o.lineup) console.log(`  ${l.slot.padEnd(5)}${(l.name || '').padEnd(24)}${String(l.pts).padStart(7)}   ${(l.parts || []).map(p => `${p.label} ${p.pts}`).join('; ')}`);
}
