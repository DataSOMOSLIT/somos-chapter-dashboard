/**
 * SOMOS Latinx in Tech · Chapter Performance Dashboard — web app.
 *
 * Code ownership: Data Analytics Team · laura.lugo@somoslatinxintech.com
 *
 * This is a SEPARATE file inside the same Apps Script project as
 * Consolidation.gs (the KPI pipeline that owns "unique_events",
 * "KPIs_Consolidado" and "KPIs_Historico"). It does not touch that pipeline's
 * logic or data — it only reads "KPIs_Historico" and serves the dashboard
 * (Dashboard.html, an HTML file in the same project) through HtmlService.
 *
 * The KPI numbers never leave Google: the page is served from script.google.com
 * to signed-in somoslatinxintech.com accounts only, and fetches its data with
 * google.script.run → getDashboardData() below. Nothing is published to the
 * web and no copy of the data lives on GitHub.
 *
 * A project can only have one doGet(), so this is the only file allowed to
 * define one — Consolidation.gs has none, so there's no conflict.
 *
 * ---------------------------------------------------------------------------
 * DEPLOY
 * ---------------------------------------------------------------------------
 *  1. Master_Staging_Sheet → Extensions → Apps Script.
 *  2. Files → "+" → Script → name it DashboardFeed → paste this file's content
 *     (or replace the old DashboardFeed's content if it is already there).
 *  3. Files → "+" → HTML → name it Dashboard (the editor adds ".html") →
 *     paste apps-script/Dashboard.html's content.
 *     (Leave Consolidation.gs exactly as it is — nothing here reads or writes
 *     it.)
 *  4. Run ▶ testFeed once (function dropdown → testFeed) to authorize the
 *     script and sanity-check KPIs_Historico. View → Logs shows the periods
 *     found, a row count, and any data-rule warnings.
 *  5. Deploy → New deployment → type "Web app".
 *       Execute as:      Me   (the page reads KPIs_Historico with the
 *                              deployer's access, so viewers don't need
 *                              access to Master_Staging_Sheet itself)
 *       Who has access:  Anyone within somoslatinxintech.com
 *  6. Open the /exec URL. That URL is the dashboard; share it inside SOMOS.
 *
 * Re-deploy (Manage deployments → edit → Version: New version) after any edit
 * to this file or Dashboard.html — the /exec URL stays the same. A new quarter
 * needs no re-deploy: run runCleaningAndConsolidation() in Consolidation.gs
 * after updating its CURRENT_PERIOD / CURRENT_YEAR, and the next page load
 * picks it up. (The "Test deployments" /dev URL always runs the latest saved
 * code, handy for checking changes before re-deploying.)
 *
 * ---------------------------------------------------------------------------
 * EXPECTED SHAPE OF "KPIs_Historico"
 * ---------------------------------------------------------------------------
 * One row per chapter per period, header row first. Columns (see
 * Consolidation.gs's KPI_HEADERS — this file mirrors that order but doesn't
 * depend on it, since it matches by header name):
 *
 *   Chapter | Period | Events Held | Total Attendees |
 *   Average Attendees per Event | Largest Event (Attendees) |
 *   Largest Event Name | New LinkedIn Followers | Total LinkedIn Followers |
 *   LinkedIn Impressions | Average LinkedIn Engagement Rate |
 *   LinkedIn Posts Published
 *
 * "Period" is Consolidation.gs's periodRange.label, e.g. "Q2_2026". Cells
 * holding the literal string "N/A" (Consolidation.gs's NA_LABEL) become
 * null, never 0.
 *
 * "Average LinkedIn Engagement Rate" is a decimal (0.0185 = 1.85%). LinkedIn
 * occasionally exports this as a percentage instead — a value above 1 is
 * flagged in `warnings` below rather than silently reinterpreted, and the
 * dashboard shows the same warning as a banner.
 *
 * ---------------------------------------------------------------------------
 * URL PARAMETERS (read by Dashboard.html, kept in the /exec URL for sharing)
 * ---------------------------------------------------------------------------
 *   <exec-url>?q=2026_Q3                     → that quarter
 *   <exec-url>?q=2026_Q3&vs=2026_Q2          → compared with Q2
 *   <exec-url>?q=2026_Q3&view=toronto        → straight to a chapter page
 *   <exec-url>?view=cmp                      → the Comparison page
 */

var HISTORY_SHEET_NAME = 'KPIs_Historico';

/** Canonical field → header text in KPIs_Historico. Matched by exact header
 *  name (case-insensitive, punctuation-insensitive) so re-wording the sheet
 *  header slightly ("Events held" vs "Events Held") doesn't break the feed. */
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

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Dashboard')
    .setTitle('SOMOS Latinx in Tech · Chapter Performance Dashboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Called from Dashboard.html via google.script.run. Errors come back as
 *  { error } rather than a thrown exception so the page can show the message
 *  (a thrown one reaches the page too, but with Google's wording around it). */
function getDashboardData() {
  var payload;
  try {
    payload = buildFeedPayload({});
  } catch (err) {
    payload = {
      error: String((err && err.message) || err),
      generated_at: new Date().toISOString(),
      rows: []
    };
  }
  payload.app_url = ScriptApp.getService().getUrl();
  return payload;
}

function buildFeedPayload(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(HISTORY_SHEET_NAME);
  if (!sheet) {
    throw new Error(
      '"' + HISTORY_SHEET_NAME + '" not found. Run runCleaningAndConsolidation() ' +
      'in Consolidation.gs at least once — it creates this tab automatically.'
    );
  }

  var parsed = readHistorySheet(sheet);
  var rows = parsed.rows;
  var wantedPeriod = params.period ? normalisePeriod(params.period) : null;
  if (wantedPeriod) rows = rows.filter(function (r) { return r.quarter === wantedPeriod; });

  var quarters = uniqueSorted(rows.map(function (r) { return r.quarter; }));

  var payload = {
    generated_at: new Date().toISOString(),
    source: 'KPIs_Historico · ' + ss.getName(),
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
    out.warnings.push('KPIs_Historico is missing a Chapter or Period column — check the header row.');
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

/* ------------------------------------------------------------------------
   Run from the editor when the /exec page comes up blank: checks that the
   Dashboard HTML file exists and isn't empty, that getDashboardData() works,
   and which /exec URL the latest saved code belongs to.
   ------------------------------------------------------------------------ */
function testPage() {
  var html = HtmlService.createHtmlOutputFromFile('Dashboard').getContent();
  Logger.log('Dashboard.html: %s characters', html.length);
  Logger.log('has server bridge: %s', html.indexOf('getDashboardData') !== -1);
  Logger.log('starts with: %s', html.slice(0, 60));
  Logger.log('ends with: %s', html.slice(-40));
  var d = getDashboardData();
  Logger.log('getDashboardData: %s rows, quarters %s, error %s', d.rows.length, JSON.stringify(d.quarters), d.error || 'none');
  Logger.log('app_url: %s', d.app_url);
}
