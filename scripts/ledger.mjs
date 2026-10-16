// Player-by-player reconciliation of the commissioner's sheet against the site's scoring.
// Used for the Week 5 ledger and for the backtest on earlier weeks.
import { r2 } from './toc-core.mjs';

const ALIAS = { zswalker: 'zswalker5' };           // the sheet drops the trailing 5

// "Name: 12.3" cells; the sheet is hand-typed so spacing varies ("Judkins:11.50").
export function parseSheetCsv(text) {
  const out = [];
  for (const line of text.trim().split(/\r?\n/).slice(1)) {
    const cells = line.split(',');
    const owner = ALIAS[cells[0].trim()] || cells[0].trim();
    if (!owner) continue;
    const slots = cells.slice(1, 11).map(c => {
      const m = c.match(/^\s*(.*?)\s*:\s*(-?[\d.]+)\s*$/);
      return m ? { name: m[1], pts: Number(m[2]) } : null;
    }).filter(Boolean);
    const total = Number(cells[11]);
    out.push({ owner, slots, total, listedSum: r2(slots.reduce((s, x) => s + x.pts, 0)) });
  }
  return out;
}

const norm = s => s.toLowerCase().replace(/[^a-z .]/g, '').trim();
function nameMatches(sheetName, fullName) {
  const sn = norm(sheetName), fn = norm(fullName), ft = fn.split(/\s+/), st = sn.split(/\s+/);
  const last = st[st.length - 1].replace('.', ''), fl = ft[ft.length - 1];
  if (!fl.startsWith(last) && !fn.includes(sn)) return false;
  if (st.length > 1) { const first = st[0].replace('.', ''); if (!ft[0].startsWith(first)) return false; }
  return true;
}

// sheet: parseSheetCsv() row for one team; pool: scoreRoster().players for the same team and week
export function reconcileTeam(sheet, pool, siteTotal, siteLineup) {
  const used = new Set(), rows = [];
  for (const sp of sheet.slots) {
    const cands = pool.filter(p => !used.has(p.id) && nameMatches(sp.name, p.name));
    cands.sort((a, b) => Math.abs(a.pts - sp.pts) - Math.abs(b.pts - sp.pts));
    const hit = cands[0];
    if (!hit) { rows.push({ status: 'sheet-only', sheetName: sp.name, sheetPts: sp.pts, note: 'Sheet lists a player who is not on this team’s Sleeper roster for that week.' }); continue; }
    used.add(hit.id);
    const delta = r2(sp.pts - hit.pts);
    rows.push({
      status: Math.abs(delta) < 0.005 ? 'match' : 'value', sheetName: sp.name, sheetPts: sp.pts, siteName: hit.name, id: hit.id, sitePts: hit.pts, delta,
      note: Math.abs(delta) < 0.005 ? '' : `Same player, different points. Site working: ${hit.parts.map(x => `${x.label} ${x.pts}`).join(', ')}.`,
      src: hit.src
    });
  }
  for (const l of siteLineup) if (l.id && !used.has(l.id)) rows.push({
    status: 'site-only', siteName: l.name, id: l.id, sitePts: l.pts, note: 'In the site’s best lineup but not in the sheet’s lineup. The sheet may be missing this player from the roster.', src: l.src
  });
  const delta = r2(sheet.total - siteTotal);
  return { owner: sheet.owner, sheetTotal: sheet.total, sheetListedSum: sheet.listedSum, siteTotal, delta, sheetArithmeticOk: Math.abs(sheet.total - sheet.listedSum) < 0.015, rows };
}
