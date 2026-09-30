/**
 * SOMOS Latinx in Tech · Chapter Performance Dashboard
 * Google Apps Script web app — serves the Master_Staging_Sheet as JSON.
 *
 * Code ownership: Data Analytics Team · laura.lugo@somoslatinxintech.com
 *
 * ---------------------------------------------------------------------------
 * DEPLOY
 * ---------------------------------------------------------------------------
 *  1. Open the Master_Staging_Sheet → Extensions → Apps Script.
 *  2. Paste this file over Code.gs. If the script is bound to the sheet you can
 *     leave SHEET_ID empty; otherwise set it to the spreadsheet's ID.
 *  3. Deploy → New deployment → type "Web app".
 *       Execute as:      Me
 *       Who has access:  Anyone   (required — the dashboard calls it unauthenticated)
 *  4. Copy the /exec URL into CONFIG.DATA_URL in index.html and commit.
 *
 * Re-deploy (Manage deployments → edit → Version: New version) after any edit
 * to this file. Adding a quarter tab to the sheet needs no re-deploy.
 *
 * ---------------------------------------------------------------------------
 * SHEET SHAPE
 * ---------------------------------------------------------------------------
 * One tab per quarter, named Q2_2026 / Q3_2026 (2026_Q2 also accepted).
 * Row 1 is the header row. Recognised headers (case/space/punctuation
 * insensitive — "New Members", "new_members" and "NEW MEMBERS" all work):
 *
 *   chapter | members | new_members | events | attendance |
 *   volunteers | li_followers | li_engagement | retention
 *
 * Any other column is ignored. Blank cells become null, never 0.
 *
 * li_engagement and retention are DECIMALS (0.185 = 18.5%). A cell formatted as
 * a Sheets percentage already arrives as 0.185, so leave the formatting alone.
 * Typing 18.5 into that column produces a value above 1 and raises the
 * dashboard's warning banner; the `warnings` array below flags it too.
 *
 * ---------------------------------------------------------------------------
 * ENDPOINT
 * ---------------------------------------------------------------------------
 *   GET  <exec-url>                → every quarter tab
 *   GET  <exec-url>?quarter=2026_Q3 → one quarter
 *   GET  <exec-url>?debug=1        → adds a per-tab parse report
 */

/** Spreadsheet ID. Leave "" when this script is bound to the sheet itself. */
var SHEET_ID = '';

/** Tabs whose names look like quarters are read; everything else is skipped. */
var QUARTER_TAB = /^(?:Q([1-4])[_\-\s]?(\d{4})|(\d{4})[_\-\s]?Q([1-4]))$/i;

/** Canonical numeric columns, in the order the dashboard expects them. */
var NUMERIC_FIELDS = [
  'members',
  'new_members',
  'events',
  'attendance',
  'volunteers',
  'li_followers',
  'li_engagement',
  'retention'
];

/** Header aliases → canonical key. Keys here are already normalised. */
var HEADER_ALIASES = {
  chapter: 'chapter',
  chaptername: 'chapter',
  city: 'chapter',

  members: 'members',
  totalmembers: 'members',
  membercount: 'members',

  newmembers: 'new_members',
  new: 'new_members',
  newjoins: 'new_members',

  events: 'events',
  eventsheld: 'events',
  eventcount: 'events',

  attendance: 'attendance',
  eventattendance: 'attendance',
  totalattendance: 'attendance',

  volunteers: 'volunteers',
  activevolunteers: 'volunteers',

  lifollowers: 'li_followers',
  linkedinfollowers: 'li_followers',

  liengagement: 'li_engagement',
  linkedinengagement: 'li_engagement',
  liengagementrate: 'li_engagement',

  retention: 'retention',
  memberretention: 'retention',
  retentionrate: 'retention'
};

/* ========================================================================= */

function doGet(e) {
  var params = (e && e.parameter) || {};
  var payload;
  try {
    payload = buildPayload(params);
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

function buildPayload(params) {
  var ss = SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('No spreadsheet: set SHEET_ID, or bind this script to the Master_Staging_Sheet.');
  }

  var wanted = params.quarter ? normaliseQuarter(params.quarter) : null;
  var rows = [];
  var quarters = [];
  var warnings = [];
  var report = [];

  ss.getSheets().forEach(function (sheet) {
    var quarter = normaliseQuarter(sheet.getName());
    if (!quarter) return;                          // not a quarter tab
    if (wanted && quarter !== wanted) return;

    var parsed = readQuarterSheet(sheet, quarter);
    report.push({
      tab: sheet.getName(),
      quarter: quarter,
      rows: parsed.rows.length,
      skipped_rows: parsed.skipped,
      unmapped_headers: parsed.unmapped
    });

    if (!parsed.rows.length) return;
    quarters.push(quarter);
    rows = rows.concat(parsed.rows);
    warnings = warnings.concat(parsed.warnings);
  });

  quarters.sort(function (a, b) { return quarterRank(a) - quarterRank(b); });

  var payload = {
    generated_at: new Date().toISOString(),
    source: 'Master_Staging_Sheet · ' + ss.getName(),
    spreadsheet_id: ss.getId(),
    quarters: quarters,
    row_count: rows.length,
    warnings: warnings,
    rows: rows
  };
  if (params.debug) payload.debug = report;
  return payload;
}

function readQuarterSheet(sheet, quarter) {
  var values = sheet.getDataRange().getValues();
  var out = { rows: [], warnings: [], unmapped: [], skipped: 0 };
  if (values.length < 2) return out;

  var header = values[0];
  var colOf = {};                                  // canonical key → column index
  for (var c = 0; c < header.length; c++) {
    var key = canonicalHeader(header[c]);
    if (key) {
      if (colOf[key] === undefined) colOf[key] = c;
    } else if (String(header[c]).trim() !== '') {
      out.unmapped.push(String(header[c]).trim());
    }
  }

  if (colOf.chapter === undefined) {
    out.warnings.push(quarter + ': tab "' + sheet.getName() + '" has no chapter column — skipped.');
    return out;
  }

  for (var r = 1; r < values.length; r++) {
    var chapter = String(values[r][colOf.chapter] === undefined ? '' : values[r][colOf.chapter]).trim();
    if (!chapter) { out.skipped++; continue; }      // blank spacer row
    if (/^(total|totals|all chapters|grand total)$/i.test(chapter)) { out.skipped++; continue; }

    var row = { quarter: quarter, chapter: chapter };
    for (var i = 0; i < NUMERIC_FIELDS.length; i++) {
      var f = NUMERIC_FIELDS[i];
      row[f] = colOf[f] === undefined ? null : toNumberOrNull(values[r][colOf[f]]);
    }

    // Data rule: li_engagement and retention are decimals. Report, never silently fix.
    if (row.li_engagement !== null && row.li_engagement > 1) {
      out.warnings.push(
        'li_engagement above 1 (' + row.li_engagement + ') for ' + chapter + ' · ' + quarter +
        ' — enter 0.185 for 18.5%, not 18.5.'
      );
    }
    if (row.retention !== null && row.retention > 1) {
      out.warnings.push(
        'retention above 1 (' + row.retention + ') for ' + chapter + ' · ' + quarter +
        ' — enter 0.84 for 84%, not 84.'
      );
    }

    out.rows.push(row);
  }
  return out;
}

/* ---------------------------- small helpers ---------------------------- */

/** "New Members" / "new_members" / "NEW-MEMBERS " → "new_members" (or null). */
function canonicalHeader(raw) {
  var k = String(raw === undefined || raw === null ? '' : raw)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  if (!k) return null;
  if (HEADER_ALIASES[k]) return HEADER_ALIASES[k];
  // Tolerate a trailing unit suffix: "members2026", "attendancetotal".
  for (var alias in HEADER_ALIASES) {
    if (k.indexOf(alias) === 0) return HEADER_ALIASES[alias];
  }
  return null;
}

/** Blank, "-", "N/A" and anything non-numeric → null. Never 0. */
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

/** "Q2_2026" / "2026_Q2" / "Q2 2026" → "2026_Q2"; anything else → null. */
function normaliseQuarter(name) {
  var m = String(name === undefined || name === null ? '' : name).trim().match(QUARTER_TAB);
  if (!m) return null;
  return m[1] ? (m[2] + '_Q' + m[1]) : (m[3] + '_Q' + m[4]);
}

function quarterRank(q) {
  var m = String(q).match(/^(\d{4})_Q([1-4])$/);
  return m ? Number(m[1]) * 4 + Number(m[2]) : -1;
}

/* ------------------------------------------------------------------------
   Run from the Apps Script editor to sanity-check the sheet without
   deploying: View → Logs shows the row count and any data-rule warnings.
   ------------------------------------------------------------------------ */
function testPayload() {
  var p = buildPayload({ debug: '1' });
  Logger.log('quarters: %s', JSON.stringify(p.quarters));
  Logger.log('rows: %s', p.row_count);
  Logger.log('warnings: %s', JSON.stringify(p.warnings, null, 2));
  Logger.log('per-tab: %s', JSON.stringify(p.debug, null, 2));
  Logger.log('first row: %s', JSON.stringify(p.rows[0], null, 2));
}
