# How the ToC Hub's scores are checked

## What the site shows
For every ToC team and week, the site shows the best-ball lineup and, on click, every player's Sleeper stat line, a line-by-line breakdown of how the points add up, and a link to Sleeper's raw stat line.

Each result has a status:

| Status | Meaning |
|---|---|
| **Final** | Every open rule has been answered by the commissioner, no other reading of the rules changes the result, and the margin is wider than a plausible stat correction. |
| **Stands, with assumptions** | The result is the same under every reading of the unclear rules that the site tests, but at least one rule has not been confirmed by the commissioner, or the margin is within one touchdown. |
| **Provisional** | A different reading of the rules changes the result, or the lowest team is ahead by less than one stat correction (2 points by default), or the field depends on an earlier provisional result. |
| **Live** | The NFL week is still in progress. |

Settings are in `config.json` under `rules`. A rule question only counts as answered when its `status` is changed to `"answered"` after the commissioner replies.

## The checks
1. **Two scorers.** `scripts/toc-scoring.mjs` (used by the site) and `scripts/audit/bylaws-scorer.mjs` (one rule per quoted bylaws line, integer arithmetic, no shared code). Every update run scores every player on every ToC roster with both and reports any difference on the Verification tab.
2. **Hand-worked tests.** `tests/stat-lines.json` holds real Week 5 stat lines with the expected score worked out by hand. `npm test` checks that both scorers agree with the hand answers. The update job runs these tests before publishing.
3. **Exact best lineup.** The Hungarian assignment solver is tested against brute force.
4. **Rule sensitivity.** Each week is re-scored under every other reading of the unclear rules (QB receptions, combined 100-yard bonus, roster lock at Thursday kickoff). If any reading changes who is demoted or eliminated, the result is marked provisional.
5. **Sheet reconciliation.** `tests/sheet-tab-*.csv` are copies of the commissioner's sheet tabs. The build compares every player on every team and lists each difference with the reason (`public/ledger.json`).
6. **Outside checks.** `tests/external-checks.json` records which lines were compared with box scores and news reports, and which were not.
7. **Raw data archive.** Each update run builds `raw/snapshot.json`. `scripts/archive.mjs` saves a gzipped, timestamped copy to the `raw-snapshots` branch every 6 hours if the data changed, and whenever a week becomes final. `node scripts/replay.mjs <snapshot> <week> --detail <owner>` re-derives any week's scores offline from a snapshot.

## Not done yet
- **Backtest on Weeks 1 to 4.** The build can compare any sheet tab against the pipeline (the second tab, which the sheet labels "ToC Week 3", is set up to be matched against Week 4, then Week 3). It could not be run here, because the tools used for this work cannot reach Sleeper for earlier weeks. It runs on the first update. Weeks 1 to 3 need their sheet tab ids, and the league's accepted demotions and eliminations for Weeks 1 to 4 need to be supplied; add them to `tests/expected.json`.
- **Official NFL gamebooks** for the lost fumbles and Jacoby Brissett's reception. Box scores and news reports were used instead.
- **Stat-correction history.** Once the archive has run for a few weeks, snapshots of the same week taken at different times show how often and by how much Sleeper revises stats. The 2-point and 6-point margins in `config.json` are placeholders until then.

## Questions for the commissioner
1. Does a quarterback earn points for a reception? (The sheet gave Jacoby Brissett 1 point in Week 5; the bylaws list only RB, WR and TE.)
2. Does the 100-yard bonus also apply to rushing plus receiving combined? (The "Format" list says "100+ Rushing/Receiving Yards", the scoring list has separate bonuses.)
3. Which roster counts: the one at the first Thursday kickoff, or the one Sleeper holds when the week closes?
4. Do stat corrections after a week closes change the result, and until when?
5. Do negative rushing yards subtract points?
6. Which touchdowns count as "other" touchdowns?
7. If two teams tie for the lowest weekly score, who goes?
