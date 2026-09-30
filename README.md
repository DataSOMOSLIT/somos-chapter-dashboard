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
| `ch` | Chapter slugs, comma-separated. Omitted when all are selected. | `?ch=austin,chicago,miami` |
| `rank` | Metric the chart ranks by | `?rank=li_engagement` |
| `sort` | Table sort column (`chapter` or any metric key) | `?sort=attendance` |
| `dir` | `asc` or `desc` | `?dir=asc` |

Example shareable view — Q2 2026, three chapters, ranked by LinkedIn engagement:

```
https://Lauralug0.github.io/somos-chapter-dashboard/?q=2026_Q2&ch=austin,chicago,miami&rank=li_engagement
```

Unknown or stale parameters are ignored rather than breaking the view: a chapter
slug that no longer exists is dropped, and an unrecognised quarter falls back to
the most recent one in the data.

## Data sources (in this order)

1. **`CONFIG.DATA_URL` in `index.html`** — the Google Apps Script web app
   (`apps-script/Code.gs`), live from the `Master_Staging_Sheet`.
2. **`data/kpis.json`** — static file in this repo.
3. **Embedded Q2 2026 copy inside `index.html`** — last resort.

The dashboard walks the list top to bottom and uses the first source that
returns usable rows. The chip under the header always says which one won, and
names what it fell back from, so a silently stale dashboard is not possible.

`CONFIG.DATA_URL` ships empty, so a fresh clone serves `data/kpis.json`. To go
live, paste the Apps Script `/exec` URL into `CONFIG.DATA_URL` and commit.

## Adding a quarter

**With the API:** add a tab named `Q3_2026` to the sheet and fill it. The
dashboard picks it up on reload — no code change, no re-deploy of the script.

**Without the API:** add rows with `"quarter": "2026_Q3"` to `data/kpis.json`
and commit.

## Data rules

- `li_engagement` is a **decimal** (`0.185` = 18.5%). Values above 1 trigger a
  warning banner naming the offending chapters. `retention` follows the same rule.
- Missing values are `null` and show as **N/A**, never zero. A chapter with no
  value for the ranking metric is left off the chart (with a note saying which)
  and still appears as N/A in the table.
- Rates aggregate as a **membership-weighted mean**, not a plain average, so the
  headline figure is not skewed by the smallest chapter.
- `attendance / event` is derived (`attendance ÷ events`) and is not stored.

### Columns

| Key | Column | Type |
|---|---|---|
| `chapter` | Chapter name | text (required) |
| `members` | Total members | integer |
| `new_members` | New members | integer |
| `events` | Events held | integer |
| `attendance` | Event attendance | integer |
| `volunteers` | Active volunteers | integer |
| `li_followers` | LinkedIn followers | integer |
| `li_engagement` | LinkedIn engagement | decimal 0–1 |
| `retention` | Member retention | decimal 0–1 |

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
zero), the `li_engagement > 1` banner, membership-weighted rate aggregation,
null-last sorting in both directions, URL round-tripping, and tolerance for
`Q2_2026` / `2026-Q2` / `"18.5%"` coming out of Sheets. Run it after editing
`index.html`, `data/kpis.json`, or the metric registry.

## Apps Script setup

See the header comment in `apps-script/Code.gs` for the full deploy steps. The
short version:

1. Master_Staging_Sheet → Extensions → Apps Script → paste `Code.gs`.
2. Deploy → New deployment → **Web app**, *Execute as: Me*,
   *Who has access: **Anyone*** (the dashboard calls it unauthenticated).
3. Copy the `/exec` URL into `CONFIG.DATA_URL` in `index.html`.

The endpoint accepts `?quarter=2026_Q3` to scope to one quarter and `?debug=1`
for a per-tab parse report (row counts, skipped rows, unrecognised headers).
Header matching is case- and punctuation-insensitive, so `New Members`,
`new_members` and `NEW-MEMBERS` all land in the same field.

Re-deploy the script (Manage deployments → edit → Version: **New version**) after
editing `Code.gs`. Adding a quarter tab needs no re-deploy.

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
> Master_Staging_Sheet numbers, or point `CONFIG.DATA_URL` at the Apps Script web
> app, before sharing the link outside the Data Analytics Team.
