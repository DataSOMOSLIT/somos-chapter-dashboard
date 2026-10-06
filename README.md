# SOMOS Latinx in Tech · Chapter Performance Dashboard

Interactive dashboard for chapter KPIs, served as a **Google Apps Script web
app** inside the `somoslatinxintech.com` Workspace.

**Code ownership:** Data Analytics Team · laura.lugo@somoslatinxintech.com

**Dashboard (SOMOS accounts only):**
https://script.google.com/a/macros/somoslatinxintech.com/s/AKfycbyM-6P1Htf_qiKV9yLvYqvanVYRdrcHZVPCHhAceucptuyJOvmk-YLpC1N3N2AN__It/exec

> **Privacy.** The KPI data never leaves Google. The page is served from
> `script.google.com` to signed-in `@somoslatinxintech.com` accounts only and
> reads `KPIs_Historico` live from the sheet. **No data is stored in this
> repo** — the GitHub Pages site
> (https://datasomoslit.github.io/somos-chapter-dashboard/) is just a
> shortcut to the web app, and the tests use invented numbers.

---

## Layout

Same look as the Data Analytics Team's `SOMOS_Dashboard_Generator.html`
(Power BI style, dark): a period selector and a **"Compare with"** selector
in the top bar, one page per chapter (Montréal, Toronto, Vancouver, Ottawa,
Calgary, Canada (National) = `Canada`), and a **Comparison** page.

A quarter is shown **on its own** by default — no deltas, no comparison. Pick
a quarter in "Compare with" to add the change on every KPI card, the
quarter-comparison panel and the quarter-over-quarter insights.

- **Chapter page:** five KPI cards, ① events this period (largest event + the
  rest combined), ② share of network (single quarter) or quarter comparison
  (when comparing), ③ LinkedIn period metrics, ④ engagement-rate gauge, and
  rule-based insights.
- **Comparison page:** network totals, one mini card per chapter, attendees vs
  new LinkedIn followers, engagement rate by chapter, and network insights.

The generator's event timeline and in-person/online donut need `unique_events`
(attendee-level data), so this page shows the largest-event highlight and the
share-of-network / quarter-comparison panel in their place.

Every view has its own URL, so **"Copy link"** can be shared in Slack:

| Parameter | Meaning | Example |
|---|---|---|
| `q` | Quarter (defaults to the latest) | `?q=2026_Q2` |
| `vs` | Quarter to compare against (omit for no comparison) | `?vs=2026_Q2` |
| `view` | Chapter slug or `cmp` (defaults to the first chapter) | `?view=toronto` |

## How it works

```
Master_Staging_Sheet
 ├─ Consolidation.gs   runCleaningAndConsolidation() → KPIs_Consolidado + KPIs_Historico
 ├─ DashboardFeed.gs   doGet() serves Dashboard.html · getDashboardData() reads KPIs_Historico
 └─ Dashboard.html     the page; asks for data with google.script.run
```

1. A Colab notebook cleans LinkedIn exports into `.csv` files in Drive.
2. **`apps-script/Consolidation.gs`** (the team's KPI pipeline) combines them
   with the `unique_events` tab for the quarter in `CURRENT_PERIOD` /
   `CURRENT_YEAR`, rewrites `KPIs_Consolidado`, and replaces that quarter's
   rows in **`KPIs_Historico`** (re-runs correct instead of duplicating).
3. **`apps-script/DashboardFeed.gs`** reads `KPIs_Historico` and serves
   **`apps-script/Dashboard.html`** through HtmlService. The page holds no
   data; it calls `getDashboardData()` on every load.

**A new quarter:** update `CURRENT_PERIOD` / `CURRENT_YEAR` in
`Consolidation.gs` and run `runCleaningAndConsolidation()`. The dashboard
shows it on the next page load — no export, no commit, no redeploy.

## Deploying changes

All three files live in Master_Staging_Sheet's Apps Script project
(**Extensions → Apps Script**). The repo copies are the reviewed source;
paste them into the editor after changing them here.

- `DashboardFeed.gs` — a Script file named `DashboardFeed`.
- `Dashboard.html` — an **HTML** file named `Dashboard` (created with
  **+ → HTML**, not + → Script).
- `Consolidation.gs` — team-owned; **don't replace it wholesale**.

Deployment settings (Deploy → Manage deployments):
*Execute as:* **Me** · *Who has access:* **Anyone within somoslatinxintech.com**.

After editing `DashboardFeed.gs` or `Dashboard.html`, use
**Manage deployments → ✏️ → Version: New version → Deploy** on the existing
deployment so the `/exec` URL stays the same (a *New deployment* creates a new
URL). **Deploy → Test deployments** gives a `/dev` URL that always runs the
latest saved code — use it to check a change before deploying.

Troubleshooting from the editor (function dropdown → ▶ Run):

- `testFeed` — logs the quarters and rows found in `KPIs_Historico` and any
  data-rule warnings.
- `testPage` — checks the `Dashboard` HTML file exists and isn't empty, and
  that `getDashboardData()` works.

A blank page when signed in with several Google accounts at once is a known
Apps Script quirk; use a browser profile (or incognito) with only the SOMOS
account.

## Data rules

- `li_engagement_rate` is a **decimal** (`0.0185` = 1.85%). LinkedIn sometimes
  exports a whole-number percentage instead — a value above 1 raises a warning
  banner naming the chapters rather than being silently reinterpreted.
- Missing values are `null` and show as **N/A**, never zero (`"N/A"` cells in
  the sheet become `null`).
- **`Canada` is a real chapter**, hosting its own events as well as carrying
  the national LinkedIn numbers.
- `li_engagement_rate` aggregates as a mean **weighted by total LinkedIn
  followers**; `largest_event` aggregates as a **max**; the network
  attendance-per-event is one ratio (Σattendance ÷ Σevents), not an average of
  per-chapter ratios.

### Columns

| Key | Column in `KPIs_Historico` | Type |
|---|---|---|
| `chapter` | Chapter | text (required) |
| `quarter` | Period | `Q2_2026` etc. (required) |
| `events` | Events Held | integer |
| `attendance` | Total Attendees | integer |
| `avg_attendance` | *(derived: Total Attendees ÷ Events Held)* | decimal, 1dp |
| `largest_event` | Largest Event (Attendees) | integer |
| `largest_event_name` | Largest Event Name | text |
| `new_li_followers` | New LinkedIn Followers | integer |
| `total_li_followers` | Total LinkedIn Followers | integer |
| `li_impressions` | LinkedIn Impressions | integer |
| `li_engagement_rate` | Average LinkedIn Engagement Rate | decimal 0–1 |
| `li_posts` | LinkedIn Posts Published | integer |

Headers are matched case- and punctuation-insensitively, so small rewording
in the sheet doesn't break the dashboard.

## Tests

```bash
node test/verify.mjs
```

No dependencies and no browser. The suite runs `Dashboard.html`'s script
against a small DOM stub and a fake `google.script` (run / url / history), and
runs `DashboardFeed.gs` against stubbed `SpreadsheetApp` / `HtmlService` /
`ScriptApp`. It covers null handling, the engagement-rate banner, weighted and
max aggregations, single-quarter vs compare mode, chapter order and names,
HTML escaping, URL round-tripping and "Copy link", server errors, and that no
KPI data is embedded in the page or in `index.html`.

`test/fixtures/sample-kpis.json` is **synthetic** — invented numbers and event
names. Never put real KPI exports in this repo.

## Accessibility & design notes

- Dark only, matching the generator's palette and per-chapter colours.
- Every chart value is also printed as text, so nothing depends on colour or
  hovering alone.
- Text from the data (chapter and event names) is HTML-escaped before rendering.
- Page tabs, selectors and "Copy link" are native buttons/selects and work
  from the keyboard; the tab strip scrolls sideways on phones.
