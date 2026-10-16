// Saves the raw Sleeper pull from this run into a git checkout of the `raw-snapshots` branch.
// usage: node scripts/archive.mjs raw/snapshot.json snapshots-branch
// A snapshot is kept when (a) the data changed AND (b) it has been at least MIN_HOURS since the last one,
// or a week has just become final. This keeps the branch small while still capturing every closed week.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const [, , rawPath = 'raw/snapshot.json', dir = 'snapshots-branch'] = process.argv;
const MIN_HOURS = Number(process.env.MIN_HOURS || 6);
const raw = JSON.parse(await readFile(rawPath, 'utf8'));
const { fetchedAt, ...stable } = raw;
const sha = createHash('sha256').update(JSON.stringify(stable)).digest('hex');
const finalWeeks = Object.keys(raw.stats || {}).map(Number).filter(w => raw.state.season_type !== 'regular' || w < Number(raw.state.week)).sort((a, b) => a - b);

await mkdir(dir, { recursive: true });
let index = [];
try { index = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8')); } catch { /* first run */ }
const last = index[index.length - 1];

let why = null;
if (!last) why = 'first snapshot';
else if (last.sha === sha) why = null;
else if (finalWeeks.some(w => !(last.finalWeeks || []).includes(w))) why = 'a week became final';
else if ((Date.parse(fetchedAt) - Date.parse(last.at)) / 36e5 >= MIN_HOURS) why = `data changed and >= ${MIN_HOURS}h since last`;

if (!why) { console.log('Archive: nothing new to keep.'); process.exit(0); }

const d = new Date(fetchedAt), day = d.toISOString().slice(0, 10), t = d.toISOString().slice(11, 19).replace(/:/g, '') + 'Z';
const rel = `snapshots/${day}/${t}.json.gz`;
await mkdir(join(dir, 'snapshots', day), { recursive: true });
await writeFile(join(dir, rel), gzipSync(JSON.stringify(raw)));
index.push({ file: rel, at: fetchedAt, sha, nflWeek: raw.state.week, finalWeeks, why });
await writeFile(join(dir, 'index.json'), JSON.stringify(index, null, 1));
await writeFile(join(dir, 'README.md'), `# Raw Sleeper snapshots

Each file in \`snapshots/\` is one gzipped JSON pull taken by the update workflow: NFL state, and for all six sub-leagues the users, rosters,
league settings, every matchup record (with each team's player list for the week) and transactions, plus the stat lines and player names for
everyone on a ToC roster. \`index.json\` lists them with the time taken (UTC), a content hash and the reason it was kept.

Re-derive any ToC score from a snapshot, offline:

    node scripts/replay.mjs snapshots/<day>/<time>.json.gz 5

(run from the main branch of the repo).
`);
console.log(`Archive: kept ${rel} (${why}).`);
