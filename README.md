# SOMOS Latinx in Tech · Chapter Performance Dashboard

Interactive dashboard for chapter KPIs, hosted on GitHub Pages.

**Code ownership:** Data Analytics Team · laura.lugo@somoslatinxintech.com

**Live site:** https://datasomoslit.github.io/somos-chapter-dashboard/

---

## Layout

Same look as the Data Analytics Team's `SOMOS_Dashboard_Generator.html`
(Power BI style, dark): a period selector and a **"Compare with"** selector
in the top bar, one page per
chapter (Montréal, Toronto, Vancouver, Ottawa, Calgary, Canada (National) =
`Canada`), and a **Comparison** page.

A quarter is shown **on its own** by default — no deltas, no comparison. Pick
a quarter in "Compare with" (any other quarter in the data, earlier or later)
to add the change on every KPI card, the quarter-comparison panel and the
quarter-over-quarter insights; "No comparison" goes back to the single quarter.

- **Chapter page:** five KPI cards, ① events this period (largest event + the
  rest combined), ② share of network (single quarter) or quarter comparison
  (when comparing), ③ LinkedIn period metrics, ④ engagement-rate gauge, and
  rule-based insights.
- **Comparison page** (compares chapters): network totals, one mini card per
  chapter, attendees vs new LinkedIn followers, engagement rate
  by chapter, and network insights.

The generator's event timeline and in-person/online donut need `unique_events`
(attendee-level data, never published), so this page shows the largest-event
highlight and the share-of-network / quarter-comparison panel in their place.

Every view has its own URL, so **"Copy link"** can be shared in Slack:

| Parameter | Meaning | Example |
|---|---|---|
| `q` | Quarter (defaults to the latest) | `?q=2026_Q2` |
| `vs` | Quarter to compare against (omit for no comparison) | `?vs=2026_Q2` |
| `view` | Chapter slug or `cmp` (defaults to the first chapter) | `?view=toronto` |

```
https://datasomoslit.github.io/somos-chapter-dashboard/?q=2026_Q3&vs=2026_Q2&view=cmp
```

## Data sources (in this order)

1. **`CONFIG.DATA_URL` in `index.html`** — a JSON feed of `KPIs_Historico`.
   Currently unused for this org (see callout below) — would be
   `apps-script/PublicFeedMirror.gs` deployed from an external account,
   *if* that path gets unblocked. See **Mirroring `KPIs_Historico` to an
   external account** below.
2. **`CONFIG.CSV_URL` in `index.html`** — `KPIs_Historico` published to the web
   as CSV. **Also blocked for this org** (same callout) — kept in the code for
   orgs whose Workspace doesn't restrict "Publish to web".
3. **`data/kpis.json`** — static file in this repo. **This is the actual
   data source in practice right now** — refreshed by hand each quarter via
   `Consolidation.gs`'s `exportKpisJson()`. See **Updating `data/kpis.json`
   each quarter** below.
4. **Embedded Q2 2026 copy inside `index.html`** — last resort.

The dashboard walks the list top to bottom and uses the first source that
returns usable rows. The chip under the header always says which one won, and
names what it fell back from, so a silently stale dashboard is not possible.

> **Why not read `Master_Staging_Sheet` directly?** Three options were tried,
> in order, and all three are blocked by the same domain-wide Google Workspace
> policy on `somoslatinxintech.com` — not a per-deployment setting, so nothing
> in a deploy dialog fixes it:
> - **`DashboardFeed.gs`** (a JSON Apps Script web app) works and returns
>   correct data (verified via its `testFeed()` function) — but the domain
>   forces sign-in on Apps Script web apps regardless of the "Anyone" access
>   setting.
> - **Publishing `KPIs_Historico` to the web as CSV** returns `401
>   Unauthorized` / a sign-in page the same way.
> - **Sharing a mirror spreadsheet with an external Google account** (even
>   just as Viewer, even a single named address, not a public link) is
>   rejected outright — this domain blocks sharing *out* of the organization
>   entirely, not just anonymous/public access.
>
> Only a Workspace admin can lift this. Rather than wait on that, the
> dashboard's live numbers currently come from **`data/kpis.json`**, refreshed
> by hand each quarter — see below. A mirror *can* still work, since Workspace
> policies almost never block *receiving* a share from outside the
> organization, only sending one — see **Mirroring `KPIs_Historico` to an
> external account** for that path, kept here for if/when it's worth setting up.

## Updating `data/kpis.json` each quarter

Since none of the live-feed options above work for this org today, the
dashboard's real data source is `data/kpis.json`, refreshed by hand. This
takes a minute:

1. In `Master_Staging_Sheet`'s Apps Script project (`Consolidation.gs`), run
   **Dashboard Chapters → Export KPIs as JSON (for dashboard repo)** from the
   Sheet's menu (or the function dropdown → `exportKpisJson` → Run).
2. **View → Logs** prints a ready-to-paste JSON block — built directly from
   `KPIs_Historico`, so it can't drift from what was actually consolidated.
3. Copy that whole block and replace `data/kpis.json`'s contents with it
   (or send it to whoever maintains the dashboard repo).
4. Commit and push. The live site picks it up immediately — no deploy step,
   since it's a plain file in the repo GitHub Pages already serves.

Do this after every `runCleaningAndConsolidation()` run (i.e. every quarter).
`exportKpisJson()` exports **every** quarter currently in `KPIs_Historico`, not
just the latest, so pasting its output replaces the file wholesale rather than
appending.

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
- Missing values are `null` and show as **N/A**, never zero.
- **`Canada` is a real chapter, not just the national LinkedIn account** — it
  hosts its own events (verified against `unique_events`: e.g. "Behind the
  Curtain of Hiring", Q2 2026) alongside carrying the national
  LinkedIn numbers. A quarter where it happens to run no events still shows
  N/A for its event columns, same as any other chapter — that's normal
  missing-data handling, not a permanent rule about this chapter.
- `li_engagement_rate` aggregates as a mean **weighted by total LinkedIn
  followers**, not a plain average, so a chapter with a small following
  doesn't swing the headline figure as much as one with a large one.
- `largest_event` aggregates as a **max** across chapters, not a
  sum — it answers "what's the single biggest event," not "how many people
  attended the biggest events combined."
- `avg_attendance` (attendance ÷ events) is derived and not stored; it is
  computed per chapter, and the network average is one ratio
  (Σattendance ÷ Σevents) across chapters — not an average of
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
| `largest_event_name` | Largest Event Name | text |
| `new_li_followers` | New LinkedIn Followers | integer |
| `total_li_followers` | Total LinkedIn Followers | integer |
| `li_impressions` | LinkedIn Impressions | integer |
| `li_engagement_rate` | Average LinkedIn Engagement Rate | decimal 0–1 |
| `li_posts` | LinkedIn Posts Published | integer |

## Publish

**Settings → Pages → Deploy from branch → `main` / `root`.** The site appears at
`https://<user>.github.io/<repo>/` — for this repo,
https://datasomoslit.github.io/somos-chapter-dashboard/.

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
embedded Q2–Q3 2026 copy, because the `data/kpis.json` fetch is blocked.

## Tests

```bash
node test/verify.mjs
```

No dependencies and no browser. The suite pulls the `<script>` block out of
`index.html`, runs it against a small DOM stub, and asserts the parts that are
easy to break silently: the source-fallback chain, null handling (N/A, never
zero — a chapter with events but no LinkedIn export yet, or vice versa), the
`li_engagement_rate > 1` banner, followers-weighted rate aggregation, the
`largest_event` max aggregation, single-quarter vs compare mode and its deltas, chapter page
order and names, HTML escaping of event names, URL round-tripping, and tolerance for `Q2_2026` / `2026-Q2` / `"4.6%"` / a
capitalised `Period` header coming out of Sheets, and the CSV parser (quoted
commas in event names, doubled-quote escaping, CRLF/LF line endings). Run it
after editing `index.html`, `data/kpis.json`, or the metric registry.

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
   next load — **except this doesn't currently work for this org** (step 5's
   "Anyone" setting is overridden by a domain policy that forces sign-in
   regardless). `CONFIG.DATA_URL` stays empty for now; use the mirror method
   below instead. Steps 1–6 are still worth doing — `testFeed()` is the
   fastest way to sanity-check `KPIs_Historico` — just skip step 7.

The endpoint also accepts `?period=2026_Q3` to scope to one quarter and
`?debug=1` for unmapped-header / skipped-row counts — handy for checking a new
quarter's rows before trusting them.

Re-deploy (Manage deployments → edit deployment → Version: **New version**)
only after editing `DashboardFeed.gs` itself. A new quarter needs no
redeploy — just re-run `runCleaningAndConsolidation()` after updating
`CURRENT_PERIOD`/`CURRENT_YEAR`, and the next dashboard reload picks it up.

**Publishing `KPIs_Historico` as CSV was tried and is also blocked** (Sheet →
File → Share → Publish to web → select `KPIs_Historico` → CSV → Publish
returns `401 Unauthorized` / a sign-in page, the same failure mode as the web
app above). `CONFIG.CSV_URL` stays in the code for orgs whose Workspace
doesn't restrict "Publish to web", but doesn't work for this one either.

## Mirroring `KPIs_Historico` to an external account (optional, deferred)

**Not currently in use** — the manual export above is what actually runs this
dashboard. This is here for later, if a live feed becomes worth the setup.

The idea: a **mirror** — a separate, minimal spreadsheet, not owned by
`somoslatinxintech.com`, containing nothing but a copy of `KPIs_Historico`
(never `unique_events` or `all_events`, which carry attendee names and
emails). An account outside the domain reads *that* instead, which isn't
subject to the domain's policy.

**The direction matters.** The first attempt at this had `Consolidation.gs`'s
own account create the mirror and try to share it *out* to an external
account — rejected, same as the CSV publish above: this domain blocks sharing
out of the organization entirely, in any form. The fix is to reverse it: have
the **external account own the mirror** and share it *into* the domain — a
Workspace's outbound-sharing restriction essentially never blocks *receiving*
a share from outside, only sending one.

**One-time setup** (needs a Google account outside `somoslatinxintech.com`
with room to create a file in Drive — this project's `lalorelu@gmail.com` was
out of storage space when this was attempted, which is why it's deferred, not
because the approach doesn't work):

1. From that external account, create a new blank Google Sheet — e.g. "SOMOS
   Dashboard · Public Feed." Copy its ID out of the URL
   (`.../spreadsheets/d/`**`<this part>`**`/edit`).
2. From that same external account, **share the new sheet with the
   `somoslatinxintech.com` account that runs `Consolidation.gs`, as Editor**
   (File → Share). This is the direction that isn't blocked.
3. Back in `Master_Staging_Sheet`'s Apps Script project, open
   `Consolidation.gs` and set `PUBLIC_FEED_SHEET_ID` (near the top) to that
   ID. Save.
4. Run ▶ **`syncPublicFeedNow`** once (function dropdown) to populate the
   mirror immediately — this account now has Editor access on a file it
   doesn't own, which `SpreadsheetApp.openById()` can write to regardless of
   who owns it. View → Logs confirms it copied. (Runs automatically from here
   on, as part of `runCleaningAndConsolidation()`.)
5. From the **external account**: open the mirror sheet → **Extensions →
   Apps Script** (or [script.google.com](https://script.google.com) → **New
   project**, since a standalone project not opened via the sheet works fine
   too — the script opens the mirror by ID either way).
6. Paste in this repo's **`apps-script/PublicFeedMirror.gs`**. Set
   `MIRROR_SHEET_ID` near the top to the same ID from step 1. Save.
7. Run ▶ **`testFeed`** once to authorize and confirm the row count in
   View → Logs.
8. **Deploy → New deployment → Web app.** *Execute as:* **Me**. *Who has
   access:* **Anyone** — this account owns the file and isn't under
   `somoslatinxintech.com`'s policy, so this should actually work (verify: the
   `/exec` URL should return JSON directly, not redirect to a sign-in page).
9. Paste that URL into `CONFIG.DATA_URL` in `index.html`, commit, and push.

**Every subsequent quarter**, once set up: after running
`runCleaningAndConsolidation()` in `Consolidation.gs` as usual, the mirror
updates automatically (it's called from inside that function) — no extra
step, and no redeploy of `PublicFeedMirror.gs` needed unless its own code
changes.

## Accessibility & design notes

- Dark only, matching the generator's palette and per-chapter colours.
- Every chart value is also printed as text (bar labels, mini cards), so
  nothing depends on colour or hovering alone.
- Text from the data (chapter and event names) is HTML-escaped before rendering.
- Page tabs, the period selector and "Copy link" are native buttons/selects
  and work from the keyboard; the tab strip scrolls sideways on phones.

> **Note on `data/kpis.json`.** It holds the real `exportKpisJson()` output
> (Q2 + Q3 2026, exported 2026-10-04) — a static snapshot refreshed by hand
> each quarter (see **Updating `data/kpis.json` each quarter**), not a live feed.
