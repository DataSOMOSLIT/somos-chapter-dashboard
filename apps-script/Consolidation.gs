/**
 * =============================================================================
 * Code Ownership Notice
 * =============================================================================
 * This script was developed and is maintained by the author listed below.
 * Please do not modify this code directly. If changes or improvements are
 * required, contact the author to discuss the requested updates and maintain
 * version integrity.
 *
 * Data Analyst Team
 * laura.lugo@somoslatinxintech.com
 * =============================================================================
 *
 * SOMOS LATINX IN TECH - KPI consolidation script for the Chapters Dashboard
 * Usage: paste this script into Extensions > Apps Script in Master_Staging_Sheet
 *
 * Flow:
 * 1. The Colab notebook cleans the LinkedIn .xls exports and saves .csv files to Drive:
 *    SOMOS_Dashboard_Chapters/01_Staging_Cleaned/LinkedIn_cleaned/[CURRENT_PERIOD_FOLDER]/
 * 2. This script reads those .csv files directly from Drive (no manual import needed)
 * 3. It reads events/attendees from the "unique_events" tab, filtered to the
 *    current reporting period (a fixed calendar quarter: Q1=Jan-Mar, Q2=Apr-Jun,
 *    Q3=Jul-Sep, Q4=Oct-Dec)
 * 4. It writes the combined result to "KPIs_Consolidado" (current period only -
 *    this tab is cleared and rewritten every run)
 * 5. It also appends the same rows to "KPIs_Historico" (created automatically
 *    the first time this runs), replacing any prior rows for the same period
 *    so re-running mid-quarter corrects instead of duplicating. This is the
 *    tab the Chapter Performance Dashboard reads from, since it's the only
 *    one that keeps more than the current quarter.
 *
 * Tabs this script expects:
 * - "unique_events" (columns: source, chapter_calendar, event_name, event_id,
 *   event_format, event_date, event_time, event_timezone, event_location,
 *   event_city, total_attendees, total_proceedings, avg_rating)
 * - "KPIs_Consolidado" (generated/overwritten automatically by this script)
 * - "KPIs_Historico" (generated/appended-to automatically by this script)
 *
 * CHANGE LOG vs previous version:
 * - Added KPIs_Historico: consolidateKPIs_ and the new appendToHistory_ now
 *   share one row-builder (buildChapterRow_) so the two tabs can never drift
 *   apart. KPIs_Consolidado's behavior (clear + rewrite current period only)
 *   is unchanged; KPIs_Historico is strictly additive.
 * - Events/attendees now come from "unique_events" (real event dates, one row
 *   per event, total_attendees already computed via formula) instead of the
 *   old "Eventbrite_raw" manual-entry tab, which is no longer used.
 * - Reporting periods are now fixed calendar quarters (Q1-Q4) instead of the
 *   earlier rolling non-calendar convention.
 */

const CHAPTERS = ["Montreal", "Toronto", "Vancouver", "Ottawa", "Calgary", "Canada"];
const NA_LABEL = "N/A";

// --- ADJUST THIS EVERY PERIOD ---
const CURRENT_PERIOD = "Q2";     // Q1, Q2, Q3, or Q4
const CURRENT_YEAR = 2026;

// Must match the folder name the Colab LinkedIn notebook writes to.
const CURRENT_PERIOD_FOLDER = CURRENT_YEAR + "_" + CURRENT_PERIOD;

const ROOT_FOLDER_NAME = "SOMOS_Dashboard_Chapters";
const LINKEDIN_CLEANED_PATH = ["01_Staging_Cleaned", "LinkedIn_cleaned", CURRENT_PERIOD_FOLDER];

const QUARTER_MONTHS = {
  "Q1": [1, 3],
  "Q2": [4, 6],
  "Q3": [7, 9],
  "Q4": [10, 12]
};

// Shared by consolidateKPIs_ and appendToHistory_ so both tabs always agree
// on column order.
const KPI_HEADERS = [
  "Chapter",
  "Period",
  "Events Held",
  "Total Attendees",
  "Average Attendees per Event",
  "Largest Event (Attendees)",
  "Largest Event Name",
  "New LinkedIn Followers",
  "Total LinkedIn Followers",
  "LinkedIn Impressions",
  "Average LinkedIn Engagement Rate",
  "LinkedIn Posts Published"
];

// ============================================================
// MAIN ENTRY POINT
// ============================================================
function runCleaningAndConsolidation() {
  const periodRange = getPeriodDateRange_(CURRENT_PERIOD, CURRENT_YEAR);
  const eventKPIs = getEventKPIsFromUniqueEvents_(periodRange);
  const linkedInKPIs = getLinkedInKPIsFromDrive_();
  consolidateKPIs_(eventKPIs, linkedInKPIs, periodRange);
  appendToHistory_(eventKPIs, linkedInKPIs, periodRange);
  SpreadsheetApp.getActiveSpreadsheet().toast(
    "KPIs consolidated for " + CURRENT_PERIOD + " " + CURRENT_YEAR +
    " (events from unique_events, LinkedIn from Drive; archived to KPIs_Historico)."
  );
}

// ============================================================
// PERIOD HELPERS (fixed calendar quarters)
// ============================================================
function getPeriodDateRange_(period, year) {
  const months = QUARTER_MONTHS[period];
  if (!months) {
    throw new Error("Unknown period '" + period + "'. Use one of Q1, Q2, Q3, Q4.");
  }
  const start = new Date(year, months[0] - 1, 1);
  const end = new Date(year, months[1], 0); // last day of end month
  return { start: start, end: end, label: period + "_" + year };
}

// ============================================================
// EVENTS / ATTENDEES FROM "unique_events"
// ============================================================
function getEventKPIsFromUniqueEvents_(periodRange) {
  const rows = readTabAsObjects_("unique_events");

  const result = {};
  CHAPTERS.forEach(ch => { result[ch] = { eventsHeld: 0, totalAttendees: 0, maxSingleEvent: 0, maxEventName: "" }; });

  rows.forEach(row => {
    const chapter = row["chapter_calendar"];
    const eventDate = row["event_date"] instanceof Date
      ? row["event_date"]
      : new Date(row["event_date"]);

    if (!chapter || !result[chapter]) return;
    if (isNaN(eventDate.getTime())) return;
    if (eventDate < periodRange.start || eventDate > periodRange.end) return;

    const attendees = parseFloat(row["total_attendees"]);
    const attendeeCount = isNaN(attendees) ? 0 : attendees;
    result[chapter].eventsHeld += 1;
    result[chapter].totalAttendees += attendeeCount;

    if (attendeeCount > result[chapter].maxSingleEvent) {
      result[chapter].maxSingleEvent = attendeeCount;
      result[chapter].maxEventName = row["event_name"] || "";
    }
  });

  return result;
}

// ============================================================
// LINKEDIN KPIs FROM DRIVE (unchanged from previous version)
// ============================================================
function getLinkedInKPIsFromDrive_() {
  const result = {};
  CHAPTERS.forEach(ch => { result[ch] = { newFollowers: 0, impressions: 0, engagementRates: [], postsCount: 0, totalFollowers: 0 }; });

  const folder = navigateToFolder_(DriveApp.getRootFolder(), [ROOT_FOLDER_NAME].concat(LINKEDIN_CLEANED_PATH));
  if (!folder) {
    Logger.log("LinkedIn cleaned folder not found for period " + CURRENT_PERIOD_FOLDER + " - LinkedIn KPIs will be N/A.");
    return result;
  }

  const files = folder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    const name = file.getName();

    // LinkedIn national-level files are named "LinkedIn_National_..." in Drive,
    // but the chapter row in KPIs_Consolidado is labeled "Canada" - map between them.
    const chapter = CHAPTERS.find(ch => {
      const filePrefix = ch === "Canada" ? "National" : ch;
      return name.indexOf("LinkedIn_" + filePrefix + "_") === 0;
    });
    if (!chapter) continue; // unrecognized file, skip

    const filePrefix = chapter === "Canada" ? "National" : chapter;

    const rows = csvRowsAsObjects_(readCsvAsRows_(file));
    if (rows.length === 0) continue;

    if (name.indexOf("_New_followers_cleaned.csv") > -1) {
      result[chapter].newFollowers += sumNumericColumn_(rows, "Total followers");
    }

    if (name.indexOf("_Metrics_cleaned.csv") > -1 && name.indexOf("LinkedIn_" + filePrefix + "_content_") === 0) {
      result[chapter].impressions += sumNumericColumn_(rows, "Impressions (total)");
      const rates = rows
        .map(r => parseFloat(r["Engagement rate (total)"]))
        .filter(v => !isNaN(v));
      result[chapter].engagementRates = result[chapter].engagementRates.concat(rates);
    }

    // Posts count: one row per published post in the "All_posts" export.
    if (name.indexOf("_All_posts_cleaned.csv") > -1 && name.indexOf("LinkedIn_" + filePrefix + "_content_") === 0) {
      result[chapter].postsCount += rows.length;
    }

    // Total (cumulative) followers: not tracked anywhere directly, but the
    // "Company size" breakdown is a snapshot of ALL current followers split
    // by category - summing it gives the true cumulative total, unlike
    // "New_followers" which is only followers gained during the period.
    if (name.indexOf("_Company_size_cleaned.csv") > -1 && name.indexOf("LinkedIn_" + filePrefix + "_followers_") === 0) {
      result[chapter].totalFollowers += sumNumericColumn_(rows, "Total followers");
    }
  }

  return result;
}

function navigateToFolder_(startFolder, pathParts) {
  let current = startFolder;
  for (const part of pathParts) {
    const it = current.getFoldersByName(part);
    if (!it.hasNext()) return null;
    current = it.next();
  }
  return current;
}

function readCsvAsRows_(file) {
  const content = file.getBlob().getDataAsString();
  return Utilities.parseCsv(content);
}

function csvRowsAsObjects_(rows) {
  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });
}

function sumNumericColumn_(rows, columnName) {
  return rows.reduce((sum, row) => {
    const val = parseFloat(row[columnName]);
    return isNaN(val) ? sum : sum + val;
  }, 0);
}

// ============================================================
// READ A SHEET TAB AS AN ARRAY OF OBJECTS (header row -> keys)
// ============================================================
function readTabAsObjects_(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error("Tab '" + sheetName + "' not found.");
  }
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1)
    .filter(row => row.some(cell => cell !== "" && cell !== null))
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i]; });
      return obj;
    });
}

// ============================================================
// BUILD ONE CHAPTER'S ROW (shared by KPIs_Consolidado and KPIs_Historico,
// so the two tabs can never disagree about how a value was derived)
// ============================================================
function buildChapterRow_(chapter, eventKPIs, linkedInKPIs, periodRange) {
  const ev = eventKPIs[chapter] || { eventsHeld: 0, totalAttendees: 0, maxSingleEvent: 0, maxEventName: "" };
  const avgAttendees = ev.eventsHeld > 0
    ? (ev.totalAttendees / ev.eventsHeld).toFixed(1)
    : NA_LABEL;

  const li = linkedInKPIs[chapter] || { newFollowers: 0, impressions: 0, engagementRates: [], postsCount: 0, totalFollowers: 0 };
  const newFollowers = li.newFollowers > 0 ? li.newFollowers : NA_LABEL;
  const totalFollowers = li.totalFollowers > 0 ? li.totalFollowers : NA_LABEL;
  const impressions = li.impressions > 0 ? li.impressions : NA_LABEL;
  const engagementRate = li.engagementRates.length > 0
    ? Number((li.engagementRates.reduce((a, b) => a + b, 0) / li.engagementRates.length).toFixed(4))
    : NA_LABEL;
  const postsCount = li.postsCount > 0 ? li.postsCount : NA_LABEL;

  return [
    chapter,
    periodRange.label,
    ev.eventsHeld > 0 ? ev.eventsHeld : NA_LABEL,
    ev.totalAttendees > 0 ? ev.totalAttendees : NA_LABEL,
    avgAttendees,
    ev.maxSingleEvent > 0 ? ev.maxSingleEvent : NA_LABEL,
    ev.maxEventName || NA_LABEL,
    newFollowers,
    totalFollowers,
    impressions,
    engagementRate,
    postsCount
  ];
}

// ============================================================
// CONSOLIDATE THE KPIs BY CHAPTER - CURRENT PERIOD ONLY
// (this tab is cleared and rewritten every run - it always shows just the
// quarter named in CURRENT_PERIOD/CURRENT_YEAR above)
// ============================================================
function consolidateKPIs_(eventKPIs, linkedInKPIs, periodRange) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let kpiSheet = ss.getSheetByName("KPIs_Consolidado");
  if (!kpiSheet) {
    kpiSheet = ss.insertSheet("KPIs_Consolidado");
  } else {
    kpiSheet.clear();
  }
  kpiSheet.appendRow(KPI_HEADERS);
  CHAPTERS.forEach(chapter => {
    kpiSheet.appendRow(buildChapterRow_(chapter, eventKPIs, linkedInKPIs, periodRange));
  });
}

// ============================================================
// ARCHIVE THE SAME ROWS TO KPIs_Historico - EVERY PERIOD EVER RUN
// (created automatically on first run; existing rows for this exact period
// are replaced first, so re-running mid-quarter corrects instead of
// duplicating. This is the tab the Chapter Performance Dashboard reads.)
// ============================================================
function appendToHistory_(eventKPIs, linkedInKPIs, periodRange) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let historySheet = ss.getSheetByName("KPIs_Historico");
  if (!historySheet) {
    historySheet = ss.insertSheet("KPIs_Historico");
    historySheet.appendRow(KPI_HEADERS);
  }

  const data = historySheet.getDataRange().getValues();
  const periodCol = KPI_HEADERS.indexOf("Period");
  for (let r = data.length - 1; r >= 1; r--) {
    if (data[r][periodCol] === periodRange.label) historySheet.deleteRow(r + 1);
  }

  CHAPTERS.forEach(chapter => {
    historySheet.appendRow(buildChapterRow_(chapter, eventKPIs, linkedInKPIs, periodRange));
  });
}

// ============================================================
// CUSTOM MENU
// ============================================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Dashboard Chapters")
    .addItem("Clean and Consolidate Data", "runCleaningAndConsolidation")
    .addToUi();
}
