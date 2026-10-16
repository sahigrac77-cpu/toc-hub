# Raw Sleeper snapshots

Each file in `snapshots/` is one gzipped JSON pull taken by the update workflow: NFL state, and for all six sub-leagues the users, rosters,
league settings, every matchup record (with each team's player list for the week) and transactions, plus the stat lines and player names for
everyone on a ToC roster. `index.json` lists them with the time taken (UTC), a content hash and the reason it was kept.

Re-derive any ToC score from a snapshot, offline:

    node scripts/replay.mjs snapshots/<day>/<time>.json.gz 5

(run from the main branch of the repo).
