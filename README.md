# ToC Hub

A website for the Tournament of Champions: Week-by-week ToC survival and revival results, six sub-league tables, awards races, team lookup and the bylaws. It pulls live data from Sleeper every 15 minutes on game days (every 3 hours otherwise) and republishes itself. No server, no cost.

## One-time setup (about 10 minutes, no coding)

1. Create a free GitHub account at github.com if you don't have one.
2. Click **+ → New repository**. Name it `toc-hub`, choose **Public**, tick **Add a README**, click **Create repository**. (Public is required for free hosting. The repo contains only league data that is already visible on Sleeper. There are no passwords or keys.)
3. In the repository click **Add file → Upload files**. Drag in everything from the unzipped `toc-hub-app` folder **except the `.github` folder** (that one is next). Click **Commit changes**.
4. Add the update job: click **Add file → Create new file**. In the name box type exactly `.github/workflows/update.yml` (typing the slashes creates the folders). Open `update.yml` from this project in any text editor, copy everything, paste it into the big box, and click **Commit changes**.
5. Turn on hosting: **Settings → Pages**. Under **Build and deployment → Source** choose **GitHub Actions**.
6. Run it: **Actions** tab → **Update ToC Hub** → **Run workflow**. After about a minute the job turns green and the Pages settings show your site address (like `https://YOURNAME.github.io/toc-hub/`). Share that link with the league.

From then on it updates by itself. If the job ever shows a red X, open it from the Actions tab; the most common cause is Sleeper being briefly down, and the next run fixes it. The site keeps showing the last good data until then.

GitHub pauses scheduled jobs in a public repo after 60 days with no activity. Pressing **Run workflow** once restarts it. The season is shorter than that, but remember it next year.

## What you may need to edit

`config.json`:
- `leagues`: the six sub-league IDs.
- `toc.survival`, `toc.revival`, `toc.eliminated`, `toc.cumBefore`: the ToC field and running totals at the start of Week 5 (`toc.startWeek`). From there the site applies the rule itself every week: the lowest survival score is demoted into the revival bracket and the lowest revival score is eliminated. Next season, replace these with the new field and set `startWeek`.
- `me`: the handle highlighted in tables.

## Things to know

- ToC scores are recalculated from raw NFL stats (passing 0.04/yd, 6 per TD, -2 per INT, +2 at 300 pass yds; rushing 0.1/yd, 6 per TD, 0.25 per carry, +2 at 100 yds; receiving 0.1/yd, 6 per TD, +2 at 100 yds; 1 per catch, 2 for TEs; +2 per 2-point conversion; -2 per lost fumble). Best ball over each team's whole roster: QB, 2 RB, 2 WR, TE, 3 FLEX, SF. It matched the ToC Hub sheet to the cent for Week 4 but is not the official sheet.
- The bylaws tab is a plain-language summary written into `public/index.html` (the `BY` list). Edit it there if the bylaws change.
- Sub-league records and PF/PA come straight from Sleeper and update when Sleeper closes a week. Weekly scores update live.
- The demotion/elimination schedule is one per week from Week 5. If the bylaws change that in later weeks (for example two demotions in a week), tell Claude or change `build-data.mjs`.

## Preview on your own computer

Install Node 20, then in this folder: `node scripts/build-data.mjs` (pulls fresh data) and `node scripts/serve.mjs` (open http://localhost:8080).

## Verification
See `docs/VERIFICATION.md`: how each score is checked, what the result statuses mean, what is still open, and the questions for the commissioner. Run `npm test` to check the scorers against the hand-worked cases.
