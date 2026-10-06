/**
 * SOMOS Latinx in Tech · Chapter Performance Dashboard — public mirror feed.
 *
 * This is the SAME logic as apps-script/DashboardFeed.gs, adapted to run from
 * a DIFFERENT Google account than the one that owns Master_Staging_Sheet.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * somoslatinxintech.com's Google Workspace forces sign-in on both Apps Script
 * "Anyone" web apps and "Publish to web" links, regardless of the access
 * setting chosen at deploy time — a domain-wide policy, not something fixable
 * from the deploy dialog. Neither mechanism can serve this org's own files to
 * an unauthenticated static page.
 *
 * The workaround: a separate, minimal Google Sheet — the "mirror" — owned by
 * anyone, containing ONLY a copy of KPIs_Historico (never unique_events or
 * all_events, which carry attendee PII: names, emails). Consolidation.gs's
 * syncPublicFeed_() copies KPIs_Historico into that mirror's own
 * "KPIs_Historico" tab on every run, once its PUBLIC_FEED_SHEET_ID constant
 * is filled in. The mirror is shared as Viewer with an external, non-Workspace
 * Google account — this script is deployed FROM that external account,
 * against the mirror. Not being subject to somoslatinxintech.com's policy, a
 * deployment from that account can actually be made public.
 *
 * ---------------------------------------------------------------------------
 * SET UP (one time)
 * ---------------------------------------------------------------------------
 *  1. From ANY Google account, create a new blank Google Sheet. Name it
 *     something like "SOMOS Dashboard - Public Feed". Copy its ID out of the
 *     URL (…/spreadsheets/d/<THIS PART>/edit).
 *  2. In Master_Staging_Sheet's Apps Script project (Consolidation.gs), set
 *     PUBLIC_FEED_SHEET_ID to that ID, save, then run ▶ syncPublicFeedNow
 *     once to populate the mirror immediately (Consolidation.gs's owning
 *     account needs Editor access on the mirror to write to it — share it
 *     with that account as Editor, or just create the mirror FROM that
 *     account in the first place).
 *  3. Share the mirror sheet as **Viewer** with the external account that
 *     will run this script (e.g. a personal Gmail address) — File → Share.
 *  4. From THAT external account: open the mirror sheet → Extensions →
 *     Apps Script. (If Viewer access hides that menu, use script.google.com
 *     → New project instead — a standalone project not opened via the sheet
 *     works fine, since MIRROR_SHEET_ID below opens it by ID.)
 *  5. Paste this file's content in as Code.gs (or any name) in that project.
 *  6. Set MIRROR_SHEET_ID below to the same ID from step 1.
 *  7. Run ▶ testFeed once to authorize (this account only needs read access
 *     to the mirror) and sanity-check. View → Logs shows the row count.
 *  8. Deploy → New deployment → Web app. Execute as: Me. Who has access:
 *     **Anyone**. Deploy, copy the /exec URL.
 *  9. Paste that URL into CONFIG.DATA_URL in index.html, commit, push.
 *
 * Re-run step 2's syncPublicFeedNow (or the normal
 * runCleaningAndConsolidation) after every quarter's consolidation to refresh
 * the mirror — this script only reads, it never triggers a sync itself.
 *
 * ---------------------------------------------------------------------------
 * ENDPOINT
 * ---------------------------------------------------------------------------
 *   GET  <exec-url>                  → every period in the mirror
 *   GET  <exec-url>?period=2026_Q2   → one period only
 *   GET  <exec-url>?debug=1          → adds unmapped_headers / skipped_rows
 */

/** Fill in with the mirror spreadsheet's ID (see step 6 above). */
var MIRROR_SHEET_ID = '';

var HISTORY_SHEET_NAME = 'KPIs_Historico';

/** Canonical field → header text. Matched case/punctuation-insensitively, same
 *  as Consolidation.gs's KPI_HEADERS and DashboardFeed.gs's FIELD_HEADERS. */
var FIELD_HEADERS = {
  chapter: 'chapter',
  period: 'period',
  events: 'eventsheld',
  attendance: 'totalattendees',
  avg_attendance: 'averageattendeesperevent',
  largest_event: 'largesteventattendees',
  largest_event_name: 'largesteventname',
  new_li_followers: 'newlinkedinfollowers',
  total_li_followers: 'totallinkedinfollowers',
  li_impressions: 'linkedinimpressions',
  li_engagement_rate: 'averagelinkedinengagementrate',
  li_posts: 'linkedinpostspublished'
};

/** Fields that are numbers (everything except chapter/period/largest_event_name). */
var NUMERIC_FIELDS = [
  'events', 'attendance', 'avg_attendance', 'largest_event',
  'new_li_followers', 'total_li_followers', 'li_impressions',
  'li_engagement_rate', 'li_posts'
];

function doGet(e) {
  var params = (e && e.parameter) || {};
  var payload;
  try {
    payload = buildFeedPayload(params);
  } catch (err) {
    payload = {
      error: String((err && err.message) || err),
      generated_at: new Date().toISOString(),
      rows: []
    };
  }
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function buildFeedPayload(params) {
  if (!MIRROR_SHEET_ID) {
    throw new Error('MIRROR_SHEET_ID is empty - set it to the mirror spreadsheet\'s ID first.');
  }
  var ss = SpreadsheetApp.openById(MIRROR_SHEET_ID);
  var sheet = ss.getSheetByName(HISTORY_SHEET_NAME);
  if (!sheet) {
    throw new Error(
      '"' + HISTORY_SHEET_NAME + '" not found in the mirror. Run syncPublicFeedNow() (or ' +
      'runCleaningAndConsolidation()) in Consolidation.gs at least once to populate it.'
    );
  }

  var parsed = readHistorySheet(sheet);
  var rows = parsed.rows;
  var wantedPeriod = params.period ? normalisePeriod(params.period) : null;
  if (wantedPeriod) rows = rows.filter(function (r) { return r.quarter === wantedPeriod; });

  var quarters = uniqueSorted(rows.map(function (r) { return r.quarter; }));

  var payload = {
    generated_at: new Date().toISOString(),
    source: 'KPIs_Historico · public mirror',
    quarters: quarters,
    row_count: rows.length,
    warnings: parsed.warnings,
    rows: rows
  };
  if (params.debug) {
    payload.debug = {
      unmapped_headers: parsed.unmapped,
      skipped_rows: parsed.skipped,
      total_rows_in_sheet: parsed.totalInSheet
    };
  }
  return payload;
}

function readHistorySheet(sheet) {
  var values = sheet.getDataRange().getValues();
  var out = { rows: [], warnings: [], unmapped: [], skipped: 0, totalInSheet: Math.max(0, values.length - 1) };
  if (values.length < 2) return out;

  var header = values[0];
  var colOf = {};                                  // canonical field → column index
  for (var c = 0; c < header.length; c++) {
    var norm = normaliseHeader(header[c]);
    var field = null;
    for (var key in FIELD_HEADERS) {
      if (FIELD_HEADERS[key] === norm) { field = key; break; }
    }
    if (field) {
      if (colOf[field] === undefined) colOf[field] = c;
    } else if (String(header[c]).trim() !== '') {
      out.unmapped.push(String(header[c]).trim());
    }
  }

  if (colOf.chapter === undefined || colOf.period === undefined) {
    out.warnings.push('Mirror sheet is missing a Chapter or Period column — check the header row.');
    return out;
  }

  for (var r = 1; r < values.length; r++) {
    var chapter = String(values[r][colOf.chapter] === undefined ? '' : values[r][colOf.chapter]).trim();
    var quarter = normalisePeriod(values[r][colOf.period]);
    if (!chapter || !quarter) { out.skipped++; continue; }

    var row = { chapter: chapter, quarter: quarter };
    for (var i = 0; i < NUMERIC_FIELDS.length; i++) {
      var f = NUMERIC_FIELDS[i];
      row[f] = colOf[f] === undefined ? null : toNumberOrNull(values[r][colOf[f]]);
    }
    row.largest_event_name = colOf.largest_event_name === undefined
      ? null
      : toTextOrNull(values[r][colOf.largest_event_name]);

    if (row.li_engagement_rate !== null && row.li_engagement_rate > 1) {
      out.warnings.push(
        'Average LinkedIn Engagement Rate above 1 (' + row.li_engagement_rate + ') for ' +
        chapter + ' · ' + quarter + ' — LinkedIn likely exported a percentage; expected a decimal (0.0185 = 1.85%).'
      );
    }

    out.rows.push(row);
  }
  return out;
}

/* ---------------------------- small helpers ---------------------------- */

function normaliseHeader(raw) {
  return String(raw === undefined || raw === null ? '' : raw).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Blank, "N/A" (Consolidation.gs's NA_LABEL) and non-numeric text → null. Never 0. */
function toNumberOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (v instanceof Date) return null;
  var s = String(v).trim();
  if (s === '' || s === '-' || s === '—') return null;
  if (/^(n\/?a|null|none|tbd|pending)$/i.test(s)) return null;
  var pct = /%$/.test(s);
  var n = Number(s.replace(/[,\s]/g, '').replace(/%$/, ''));
  if (!isFinite(n)) return null;
  return pct ? n / 100 : n;
}

function toTextOrNull(v) {
  var s = String(v === undefined || v === null ? '' : v).trim();
  if (!s || /^(n\/?a|null|none|tbd|pending)$/i.test(s)) return null;
  return s;
}

/** "Q2_2026" / "2026_Q2" / "Q2 2026" → "2026_Q2"; anything else → null. */
function normalisePeriod(v) {
  var s = String(v === undefined || v === null ? '' : v).trim();
  var m = s.match(/^Q([1-4])[_\-\s]?(\d{4})$/i);
  if (m) return m[2] + '_Q' + m[1];
  m = s.match(/^(\d{4})[_\-\s]?Q([1-4])$/i);
  if (m) return m[1] + '_Q' + m[2];
  return null;
}

function quarterRank(q) {
  var m = String(q).match(/^(\d{4})_Q([1-4])$/);
  return m ? Number(m[1]) * 4 + Number(m[2]) : -1;
}

function uniqueSorted(arr) {
  var seen = {};
  var out = [];
  for (var i = 0; i < arr.length; i++) {
    if (!seen[arr[i]]) { seen[arr[i]] = true; out.push(arr[i]); }
  }
  out.sort(function (a, b) { return quarterRank(a) - quarterRank(b); });
  return out;
}

/* ------------------------------------------------------------------------
   Run from the Apps Script editor to sanity-check the feed without
   deploying: View → Logs shows the row count and any data-rule warnings.
   ------------------------------------------------------------------------ */
function testFeed() {
  var p = buildFeedPayload({ debug: '1' });
  Logger.log('quarters: %s', JSON.stringify(p.quarters));
  Logger.log('rows: %s', p.row_count);
  Logger.log('warnings: %s', JSON.stringify(p.warnings, null, 2));
  Logger.log('debug: %s', JSON.stringify(p.debug, null, 2));
  Logger.log('first row: %s', JSON.stringify(p.rows[0], null, 2));
}
