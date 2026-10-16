// INDEPENDENT second scorer. Written from the "Scoring For ToC" section of the ToC Bylaws,
// one rule per quoted line, and deliberately sharing no code with scripts/toc-scoring.mjs.
// Arithmetic is done in integer hundredths of a point to avoid float drift.
//
// Quotes are verbatim from the bylaws (https://docs.google.com/document/d/1a_eOQ7wT_1IMsVrigHLh833tsq2xNrPV7e1vt7F1U94),
// "Scoring For ToC" heading, as read on 2026-10-16. Sleeper stat key names are the only translation layer.
export const BYLAWS_RULES = [
  { q: '1 point per 25 passing yards (.04 per yard)',        h: (s) => 4 * s.pass_yd },
  { q: '1 point per 10 rushing yards (.1 per yard)',         h: (s) => 10 * s.rush_yd },
  { q: '1 point per 10 receiving yards (.1 per yard)',       h: (s) => 10 * s.rec_yd },
  { q: '1 point per reception for Running Backs and Wide Receivers', h: (s, pos) => (pos === 'RB' || pos === 'WR') ? 100 * s.rec : 0 },
  { q: '0.25 points per carry',                              h: (s) => 25 * s.rush_att },
  { q: '2 points per reception for Tight Ends',              h: (s, pos) => pos === 'TE' ? 200 * s.rec : 0 },
  { q: '6 points per passing touchdown',                     h: (s) => 600 * s.pass_td },
  { q: '6 points per rushing touchdown',                     h: (s) => 600 * s.rush_td },
  { q: '6 points per receiving touchdown',                   h: (s) => 600 * s.rec_td },
  { q: '6 points per Fumble recovery touchdown or "other" touchdown', h: (s) => 600 * (s.fum_rec_td + s.kr_td + s.pr_td + s.st_td + s.blk_kick_ret_td) },
  { q: '300+ passing yard bonus= 2 points',                  h: (s) => s.pass_yd >= 300 ? 200 : 0 },
  { q: '100+ rushing yards bonus= 2 points',                 h: (s) => s.rush_yd >= 100 ? 200 : 0 },
  { q: '100+ yard receiving bonus= 2 points',                h: (s) => s.rec_yd >= 100 ? 200 : 0 },
  { q: '-2 points per interception thrown',                  h: (s) => -200 * s.pass_int },
  { q: '-2 points per fumble lost',                          h: (s) => -200 * s.fum_lost },
  { q: '2 points per passing 2 point conversion',            h: (s) => 200 * s.pass_2pt },
  { q: '2 points per rushing 2 point conversion',            h: (s) => 200 * s.rush_2pt },
  { q: '2 points per receiving 2 point conversion',          h: (s) => 200 * s.rec_2pt },
];

const KEYS = ['pass_yd', 'rush_yd', 'rec_yd', 'rec', 'rush_att', 'pass_td', 'rush_td', 'rec_td', 'fum_rec_td', 'kr_td', 'pr_td', 'st_td',
  'blk_kick_ret_td', 'pass_int', 'fum_lost', 'pass_2pt', 'rush_2pt', 'rec_2pt'];

export function bylawsScore(rawStat, pos) {
  const s = {}; for (const k of KEYS) s[k] = Number((rawStat && rawStat[k]) || 0);
  let hundredths = 0; const byRule = [];
  for (const r of BYLAWS_RULES) { const v = r.h(s, pos); hundredths += v; if (v) byRule.push({ quote: r.q, pts: v / 100 }); }
  return { pts: hundredths / 100, byRule };
}

// Stat keys that are informational (not scored by the bylaws). Anything else that looks scoring-related
// and is NOT in this list or in KEYS is reported by the coverage check so a hidden rule can't slip past.
export const INFO_KEY = /(_lng$|_40p$|_50p$|^anytime_tds$|^bonus_|^pos_rank_|^pts_|_snp$|^gp$|^gs$|^gms_active$|^h1_|^q1_|_yac$|_yar$|_air_yd$|_ypc$|_ypa$|_ypr$|_ypt$|_rz_|_fd$|_btkl$|_tkl_loss|_rtg$|^cmp_pct$|^rec_(0_4|5_9|10_19|20_29|30_39|40p)$|_sack|^pass_(att|cmp|inc|cmp_40p)$|^rec_(tgt|drop)$|^penalty|^rush_rec_yd$|^pass_rush_yd$|^pass_int_td$|^fum$)/;
export const WATCH_KEY = /(td|2pt|fum|safe|int|ret|bonus)/;
export function coverage(rawStat) {
  const unhandled = [];
  for (const k of Object.keys(rawStat || {})) {
    if (KEYS.includes(k) || INFO_KEY.test(k)) continue;
    if (WATCH_KEY.test(k)) unhandled.push(k);
  }
  return unhandled;
}
