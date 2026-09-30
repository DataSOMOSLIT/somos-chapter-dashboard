# SOMOS Latinx in Tech · Chapter Performance Dashboard

Interactive dashboard for chapter KPIs, hosted on GitHub Pages.

**Code ownership:** Data Analytics Team · laura.lugo@somoslatinxintech.com

**Live site:** https://Lauralug0.github.io/somos-chapter-dashboard/

---

## Filters

Quarter, chapters (any combination), and the metric used to rank chapters. The
table sorts by any column. Every filtered view has its own URL, so
**"Copy link to this view"** can be shared in Slack.

| Parameter | Meaning | Example |
|---|---|---|
| `q` | Quarter | `?q=2026_Q2` |
| `ch` | Chapter slugs, comma-separated. Omitted when all are selected. | `?ch=montreal,toronto,ottawa` |
| `rank` | Metric the chart ranks by | `?rank=li_engagement_rate` |
| `sort` | Table sort column (`chapter` or any metric key) | `?sort=attendance` |
| `dir` | `asc` or `desc` | `?dir=asc` |

Example shareable view — Q2 2026, three chapters, ranked by LinkedIn engagement rate:

```
https://Lauralug0.github.io/somos-chapter-dashboard/?q=2026_Q2&ch=montreal,toronto,ottawa&rank=li_engagement_rate
```

Unknown or stale parameters are ignored rather than breaking the view: a chapter
slug that no longer exists is dropped, and an unrecognised quarter falls back to
the most recent one in the data.

## Data sources (in this order)

1. **`CONFIG.DATA_URL` in `index.html`** — the `DashboardFeed.gs` web app,
   live from the `KPIs_Historico` tab in `Master_Staging_Sheet`.
2. **`data/kpis.json`** — static file in this repo.
3. **Embedded Q2 2026 copy inside `index.html`** — last resort.

The dashboard walks the list top to bottom and uses the first source that
returns usable rows. The chip under the header always says which one won, and
names what it fell back from, so a silently stale dashboard is not possible.

`CONFIG.DATA_URL` ships empty, so a fresh clone serves `data/kpis.json`. To go
live, paste the `DashboardFeed.gs` `/exec` URL into `CONFIG.DATA_URL` and commit
— see **Apps Script setup** below.

## How the data actually gets here

This dashboard sits downstream of an existing pipeline the Data Analytics Team
already runs in `Master_Staging_Sheet`, maintained in
**`apps-script/Consolidation.gs`**:

1. A Colab notebook cleans LinkedIn `.xls` exports into `.csv` files in Drive
   (`SOMOS_Dashboard_Chapters/01_Staging_Cleaned/LinkedIn_cleaned/<period>/`).
2. Events come from the `unique_events` tab, filtered to a fixed calendar
   quarter (`CURRENT_PERIOD` / `CURRENT_YEAR` at the top of `Consolidation.gs`).
3. Running **Dashboard Chapters → Clean and Consolidate Data** (or
   `runCleaningAndConsolidation()`) writes the current quarter's numbers to
   **`KPIs_Consolidado`** — that tab is cleared and rewritten every run, so it
   only ever shows the one quarter named in `CURRENT_PERIOD`/`CURRENT_YEAR`.
4. The same run also writes to **`KPIs_Historico`**, replacing any existing
   rows for that exact period first (so re-running mid-quarter corrects
   instead of duplicating) and leaving every other quarter's rows untouched.
   **This is the tab the dashboard actually reads** — it's the only one that
   accumulates more than the current quarter, which the quarter filter and
   the quarter-over-quarter change arrows on the stat tiles both depend on.

**To publish a new quarter:** update `CURRENT_PERIOD` / `CURRENT_YEAR` at the
top of `Consolidation.gs` and run `runCleaningAndConsolidation()` again (via
the custom menu or the editor). `KPIs_Historico` gains that quarter's rows and
the dashboard picks it up on the next page load — no redeploy needed. Without
the live feed connected, add rows with the new `"quarter"` value to
`data/kpis.json` instead.

## Data rules

- `li_engagement_rate` is a **decimal** (`0.0185` = 1.85%). LinkedIn sometimes
  exports this as a whole-number percentage instead — a value above 1 trips a
  warning banner naming the offending chapters rather than being silently
  reinterpreted.
- Missing values are `null` and show as **N/A**, never zero. A chapter with no
  value for the ranking metric is left off the chart (with a note saying which)
  and still appears as N/A in the table.
- **`Canada` is the national LinkedIn account, not a chapter with its own
  events** — its event metrics (`events`, `attendance`, `avg_attendance`,
  `largest_event`) are N/A every quarter by design, not a data gap. Its
  LinkedIn metrics are real national numbers.
- `li_engagement_rate` aggregates as a mean **weighted by total LinkedIn
  followers**, not a plain average, so a chapter with a small following
  doesn't swing the headline figure as much as one with a large one.
- `largest_event` aggregates as a **max** across the selected chapters, not a
  sum — it answers "what's the single biggest event," not "how many people
  attended the biggest events combined."
- `avg_attendance` (attendance ÷ events) is derived and not stored; the table
  computes it per chapter, and the footer computes it as one ratio
  (Σattendance ÷ Σevents) across every selected chapter — not an average of
  the per-chapter ratios, so a handful of small chapters can't outweigh a
  single large one.

### Columns

| Key | Column in `KPIs_Historico` | Type |
|---|---|---|
| `chapter` | Chapter | text (required) — one of Montreal, Toronto, Vancouver, Ottawa, Calgary, Canada |
| `quarter` | Period | `Q2_2026` etc. (required) |
| `events` | Events Held | integer |
| `attendance` | Total Attendees | integer |
| `avg_attendance` | *(derived: Total Attendees ÷ Events Held)* | decimal, 1dp |
| `largest_event` | Largest Event (Attendees) | integer |
| `largest_event_name` | Largest Event Name | text (carried through the feed; not yet shown in the UI) |
| `new_li_followers` | New LinkedIn Followers | integer |
| `total_li_followers` | Total LinkedIn Followers | integer |
| `li_impressions` | LinkedIn Impressions | integer |
| `li_engagement_rate` | Average LinkedIn Engagement Rate | decimal 0–1 |
| `li_posts` | LinkedIn Posts Published | integer |

## Publish

**Settings → Pages → Deploy from branch → `main` / `root`.** The site appears at
`https://<user>.github.io/<repo>/` — for this repo,
https://Lauralug0.github.io/somos-chapter-dashboard/.

Pages takes a minute or two on the first deploy. `.nojekyll` is committed so
files are served exactly as they are in the repo.

## Local development

No build step, no dependencies. `fetch` needs `http://`, not `file://`, so serve
the folder:

```bash
python -m http.server 8000
# then open http://localhost:8000/
```

Opening `index.html` straight off disk still works — it just falls through to the
embedded Q2 2026 copy, because the `data/kpis.json` fetch is blocked.

## Tests

```bash
node test/verify.mjs
```

No dependencies and no browser. The suite pulls the `<script>` block out of
`index.html`, runs it against a small DOM stub, and asserts the parts that are
easy to break silently: the source-fallback chain, null handling (N/A, never
zero, including `Canada`'s by-design N/A events), the
`li_engagement_rate > 1` banner, followers-weighted rate aggregation, the
`largest_event` max aggregation, null-last sorting in both directions, URL
round-tripping, and tolerance for `Q2_2026` / `2026-Q2` / `"4.6%"` / a
capitalised `Period` header coming out of Sheets. Run it after editing
`index.html`, `data/kpis.json`, or the metric registry.

## Apps Script setup

The Master_Staging_Sheet is
[10XQuSuabCKKNJdWWH6XsASdzZ_nZpqZf18V-OclH1QM](https://docs.google.com/spreadsheets/d/10XQuSuabCKKNJdWWH6XsASdzZ_nZpqZf18V-OclH1QM/edit).
Its Apps Script project already contains the KPI pipeline
(**`apps-script/Consolidation.gs`** in this repo mirrors what should be
running there — it owns `unique_events`, `KPIs_Consolidado` and
`KPIs_Historico`, and is a Data Analytics Team script: **don't replace it
wholesale**, since other things may depend on its exact behavior).

The dashboard's feed is a **separate file in that same project**,
**`apps-script/DashboardFeed.gs`** — it only reads `KPIs_Historico` and shares
nothing else with the consolidation logic. A project can define only one
`doGet()`, and `Consolidation.gs` doesn't define one, so the two coexist
without conflict.

This is a one-time, mostly-clicking job that needs your own Google account and
can't be scripted from here:

1. Open the sheet above → **Extensions → Apps Script**.
2. Confirm `Consolidation.gs` (or whatever the existing file is named) still
   has the KPI pipeline in it — if you're not sure, the version in this repo's
   `apps-script/Consolidation.gs` is safe to paste back in; it's byte-for-byte
   the original logic plus the `KPIs_Historico` archiving step.
3. In the Files list, click **+ → Script**, name the new file `DashboardFeed`,
   and paste in this repo's `apps-script/DashboardFeed.gs`.
4. **Run → `testFeed`** (function dropdown near the top, inside the new
   `DashboardFeed` file) once. The first run prompts you to authorize the
   script (it only needs read access to this spreadsheet) — approve it, then
   check **View → Logs**: it should print the quarters found in
   `KPIs_Historico`, a row count, and any data-rule warnings (e.g. an
   `li_engagement_rate` that looks like a percentage instead of a decimal).
   If `KPIs_Historico` doesn't exist yet, run
   `runCleaningAndConsolidation()` in `Consolidation.gs` first — it creates
   the tab automatically.
5. **Deploy → New deployment** → gear icon → type **Web app**.
   *Execute as:* **Me**. *Who has access:* **Anyone** (the dashboard calls this
   URL unauthenticated — "Anyone" only exposes the KPI numbers this endpoint
   returns, not edit access to the sheet).
6. Click **Deploy**, authorize again if prompted, then copy the **Web app URL**
   (ends in `/exec`).
7. Paste that URL into `CONFIG.DATA_URL` near the top of `index.html`, commit,
   and push. The live site will start reading from `KPIs_Historico` on the
   next load.

The endpoint also accepts `?period=2026_Q3` to scope to one quarter and
`?debug=1` for unmapped-header / skipped-row counts — handy for checking a new
quarter's rows before trusting them.

Re-deploy (Manage deployments → edit deployment → Version: **New version**)
only after editing `DashboardFeed.gs` itself. A new quarter needs no
redeploy — just re-run `runCleaningAndConsolidation()` after updating
`CURRENT_PERIOD`/`CURRENT_YEAR`, and the next dashboard reload picks it up.

## Accessibility & design notes

- Light and dark themes are both explicitly designed; the toggle beats the OS
  setting in either direction and the choice persists in `localStorage`.
- The chart is a single-series ranked bar list: one hue for every bar, value
  labelled at each bar's tip, so nothing is encoded by colour alone. The table is
  the chart's table-view twin — every value in the chart is readable without
  hovering.
- Bar rows are keyboard-focusable and show the same tooltip on focus as on hover.
  Table headers sort with Enter or Space.
- The categorical palette was validated for colour-vision deficiency and contrast
  against both surfaces before shipping.

> **Note on the sample data.** `data/kpis.json` and the embedded copy ship with
> placeholder figures so the dashboard is reviewable before it is wired to the
> sheet. The source chip labels them *"sample figures"*. Replace them with real
> `KPIs_Historico` numbers, or point `CONFIG.DATA_URL` at the `DashboardFeed.gs`
> web app, before sharing the link outside the Data Analytics Team.
