/**
 * Regression tests for the Apps Script web app — no dependencies.
 *
 * Extracts the <script> block out of apps-script/Dashboard.html, runs it in a
 * fresh VM context against a minimal DOM stub and a fake `google.script`
 * (run / url / history), and asserts the data rules, the server call, the
 * aggregations, the per-chapter / Comparison pages and the URL state all hold.
 * The last section runs apps-script/DashboardFeed.gs itself against a stubbed
 * SpreadsheetApp / HtmlService / ScriptApp.
 *
 * test/fixtures/sample-kpis.json is SYNTHETIC: two quarters (Q2 + Q3 2026) of
 * invented numbers and event names shaped like KPIs_Historico, with no nulls.
 * Real KPIs never enter this repo - they stay in the sheet and are served only
 * by the Apps Script web app. Sections that need missing values, unknown
 * chapters or hostile text build their own small datasets inline.
 *
 * Page content is rendered as HTML strings into #canvas, so most checks
 * assert on that string (the stub keeps `innerHTML` as a plain property).
 *
 *   node test/verify.mjs      # exits non-zero if any check fails
 *
 * Run it after touching apps-script/Dashboard.html, apps-script/DashboardFeed.gs,
 * test/fixtures/sample-kpis.json, or the metric registry.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(ROOT, "apps-script", "Dashboard.html"), "utf8");
const feedCode = readFileSync(join(ROOT, "apps-script", "DashboardFeed.gs"), "utf8");
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const kpis = JSON.parse(readFileSync(join(ROOT, "test", "fixtures", "sample-kpis.json"), "utf8"));

let failures = 0;
const ok = (name, cond, detail = "") => {
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`); }
};
const eq = (name, actual, expected) =>
  ok(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);

/* ------------------------- minimal DOM stub ------------------------- */
function makeEl(tag = "div", id = "") {
  const el = {
    tagName: String(tag).toUpperCase(), id, children: [], parent: null,
    style: {}, dataset: {}, attrs: {}, _text: "", hidden: false,
    className: "", tabIndex: 0, value: "", checked: false, type: "", open: false,
    get textContent() {
      if (this.children.length) return this.children.map(c => c.textContent).join("");
      return this._text;
    },
    set textContent(v) { this.children = []; this._text = String(v); },
    classList: {
      add(...c) { el.className = [...new Set((el.className + " " + c.join(" ")).trim().split(/\s+/))].join(" "); },
      remove(...c) { el.className = el.className.split(/\s+/).filter(x => x && !c.includes(x)).join(" "); },
      contains(c) { return el.className.split(/\s+/).includes(c); },
      toggle(c, on) { on ? this.add(c) : this.remove(c); }
    },
    append(...kids) { for (const k of kids) { k.parent = el; el.children.push(k); } },
    appendChild(k) { el.append(k); return k; },
    remove() { if (el.parent) el.parent.children = el.parent.children.filter(c => c !== el); },
    setAttribute(k, v) { el.attrs[k] = String(v); },
    getAttribute(k) { return k in el.attrs ? el.attrs[k] : null; },
    hasAttribute(k) { return k in el.attrs; },
    removeAttribute(k) { delete el.attrs[k]; },
    addEventListener(type, fn) { (el._on ||= {})[type] ||= []; el._on[type].push(fn); },
    fire(type, ev = {}) { for (const fn of (el._on?.[type] || [])) fn(ev); },
    contains() { return false; },
    select() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 600, height: 34 }; },
    querySelectorAll(sel) {
      const out = [];
      const walk = n => {
        for (const c of n.children) {
          if (sel === 'input[type="checkbox"]' && c.tagName === "INPUT" && c.type === "checkbox") out.push(c);
          walk(c);
        }
      };
      walk(el); return out;
    },
    querySelector(sel) {
      if (sel !== "summary") return null;
      return el.children.find(c => c.tagName === "SUMMARY") || makeEl("summary");
    }
  };
  return el;
}


const IDS = ["ownerEmail","copyLink","banner","srcDot","srcText","srcMeta","quarterSel",
  "vsSel","tabs","canvas","toast"];

const EXEC = "https://script.google.com/a/macros/somoslatinxintech.com/s/TEST/exec";

/** Fake google.script.run: `server(name)` returns the payload or throws. */
function makeRun(server, calls) {
  const runner = (onOk, onFail) => new Proxy({}, {
    get(_t, name) {
      if (name === "withSuccessHandler") return fn => runner(fn, onFail);
      if (name === "withFailureHandler") return fn => runner(onOk, fn);
      return (...args) => {
        calls.push(name);
        setTimeout(() => {
          let out;
          try { out = server(name, ...args); } catch (e) { onFail(e); return; }
          onOk(out);
        }, 0);
      };
    }
  });
  return runner(() => {}, () => {});
}

/**
 * Boot the dashboard script in a fresh context.
 * `server(name)` stands in for DashboardFeed.gs; `search` is the /exec URL's
 * query string, handed to the page through google.script.url.getLocation().
 */
async function boot({ search = "", server } = {}) {
  const byId = new Map();
  for (const id of IDS) byId.set(id, makeEl("div", id));
  const calls = [];
  const clipboard = [];

  const documentStub = {
    documentElement: makeEl("html"),
    body: makeEl("body"),
    getElementById: id => byId.get(id) || makeEl("div", id),
    createElement: tag => makeEl(tag),
    createTextNode: t => { const n = makeEl("#text"); n.textContent = t; return n; },
    addEventListener() {},
    execCommand: () => true
  };

  const sandbox = {
    console, setTimeout, clearTimeout, Number, Math, String, Object, Array, Map, Set, JSON, Date,
    URLSearchParams, AbortController, Promise, isFinite, parseFloat, parseInt, RegExp, Error,
    document: documentStub,
    window: { matchMedia: () => ({ matches: false }), innerWidth: 1400 },
    localStorage: { getItem: () => null, setItem() {} },
    navigator: { clipboard: { writeText: async t => { clipboard.push(t); } } },
    href: EXEC + search,          // what the address bar would show
    google: { script: {
      run: makeRun(server, calls),
      url: { getLocation(cb) { setTimeout(() => cb({ parameter: Object.fromEntries(new URLSearchParams(search)), hash: "" }), 0); } },
      history: { replace(_state, params) { sandbox.href = EXEC + "?" + new URLSearchParams(params).toString(); } }
    } }
  };
  sandbox.globalThis = sandbox;

  vm.runInContext(code, vm.createContext(sandbox), { filename: "Dashboard.html:script" });
  await new Promise(r => setTimeout(r, 40));       // let the async boot() settle

  return {
    byId, sandbox, calls, clipboard,
    txt: id => byId.get(id).textContent,
    kids: id => byId.get(id).children,
    cell: (tr, i) => tr.children[i].textContent
  };
}

// What getDashboardData() returns: buildFeedPayload()'s shape plus app_url.
const servesJSON = payload => name => {
  if (name !== "getDashboardData") throw new Error("unexpected server call " + name);
  return { ...JSON.parse(JSON.stringify(payload)), source: "KPIs_Historico · Master_Staging_Sheet", app_url: EXEC };
};
const servesNothing = () => { throw new Error("Exception: You do not have permission to access the requested document."); };

/* ====================================================================== */


const canvas = T => T.byId.get("canvas").innerHTML;
const tabs = T => T.kids("tabs").filter(t => t.tagName === "BUTTON");
const clickTab = (T, view) => tabs(T).find(t => t.dataset.view === view).fire("click");
const pickQuarter = (T, q) => { const s = T.byId.get("quarterSel"); s.value = q; s.fire("change"); };
const pickCompare = (T, q) => { const s = T.byId.get("vsSel"); s.value = q; s.fire("change"); };
const has = (name, T, needle) => ok(name, canvas(T).includes(needle), "canvas lacks " + JSON.stringify(needle));
const lacks = (name, T, needle) => ok(name, !canvas(T).includes(needle), "canvas has " + JSON.stringify(needle));

console.log("1. Data comes from getDashboardData() (the synthetic fixture as its payload, two quarters)");
const A = await boot({ server: servesJSON(kpis) });
eq("one server call", A.calls.join(","), "getDashboardData");
eq("source chip", A.txt("srcText"), "Live · KPIs_Historico · Master_Staging_Sheet");
eq("live dot", A.byId.get("srcDot").className, "dot live");
ok("chip counts rows/quarters/chapters",
  A.txt("srcMeta").includes("12 rows · 2 quarters · 6 chapters"), A.txt("srcMeta"));
ok("chip dates the export", A.txt("srcMeta").includes("updated Oct 4, 2026"), A.txt("srcMeta"));

console.log("\n2. Period selector and page tabs (generator order and names)");
eq("period options", A.kids("quarterSel").map(o => o.textContent).join("|"),
  "Q2 2026 · Apr – Jun|Q3 2026 · Jul – Sep");
eq("defaults to the latest quarter", A.byId.get("quarterSel").value, "2026_Q3");
eq("compare-with options exclude the quarter on screen", A.kids("vsSel").map(o => o.textContent).join("|"),
  "No comparison|Q2 2026 · Apr – Jun");
eq("no comparison by default", A.byId.get("vsSel").value, "");
eq("tab order: KNOWN_ORDER, Canada last, then Comparison",
  tabs(A).map(t => t.dataset.view).join(","), "montreal,toronto,vancouver,ottawa,calgary,canada,cmp");
ok("Montreal shown as Montréal", tabs(A)[0].innerHTML.includes("Montréal"));
ok("Canada shown as Canada (National)", tabs(A)[5].innerHTML.includes("Canada (National)"));
ok("first chapter tab is active", tabs(A)[0].className.includes("active"));
ok("period chip in the tab strip", A.kids("tabs").at(-1).innerHTML.includes("Q3 2026 · Jul – Sep"));
eq("URL records quarter + page", A.sandbox.href, EXEC + "?q=2026_Q3&view=montreal");
A.byId.get("copyLink").fire("click");
await new Promise(r => setTimeout(r, 0));
eq("Copy link copies the /exec URL with this view, not the sandbox iframe's",
  A.clipboard.at(-1), EXEC + "?q=2026_Q3&view=montreal");

console.log("\n3. Chapter page — Toronto, Q3 2026 on its own (no comparison picked)");
clickTab(A, "toronto");
ok("Toronto tab now active", tabs(A)[1].className.includes("active") && !tabs(A)[0].className.includes("active"));
eq("URL follows the tab", A.sandbox.href, EXEC + "?q=2026_Q3&view=toronto");
has("page title", A, "Toronto <span>Chapter</span>");
has("subtitle + badge (Canada leads attendance, Toronto leads engagement)", A,
  "1 event(s) · 40 attendees · engagement 22.0% · Engagement Leader");
has("new followers card", A, "+50");
lacks("no deltas without a comparison", A, "vs Q2 2026");
lacks("no comparison panel", A, "Quarter Comparison");
has("share-of-network panel instead", A, "Share of Network");
has("Toronto's share of Q3 attendance (40 / 160)", A, ">25.0%</span>");
has("period chip shows just Q3", A, '<div class="period-chip">Q3 2026 · Jul – Sep</div>');
has("largest event highlighted", A, "Sample Summer Social");
lacks("single event → no 'other events' row", A, "other event");
has("gauge drawn", A, "Engagement rate gauge");
has("gauge scale tops out at 30% (22% × 1.2, rounded up to 5)", A, ">30%</text>");
has("network engagement shown under the gauge (follower-weighted: 364 / 2250)", A, "Network: 16.2%");
has("avg vs network insight (Σ160 / Σ8 = 20)", A, "is above the network average (20)");
lacks("no quarter-over-quarter insight", A, "Attendance down");

console.log("\n3b. Compare with Q2 2026 → deltas and the quarter comparison appear");
pickCompare(A, "2026_Q2");
eq("URL records the comparison", A.sandbox.href, EXEC + "?q=2026_Q3&vs=2026_Q2&view=toronto");
has("period chip names both quarters", A, "Q3 2026 · Jul – Sep vs Q2 2026");
has("events delta 3 → 1", A, "▼ −66.7% vs Q2 2026");
has("attendance delta 120 → 40", A, "▼ −66.7% vs Q2 2026");
has("engagement delta in points (17% → 22%)", A, "▲ +5.0 pts vs Q2 2026");
has("quarter comparison panel", A, "Quarter Comparison");
lacks("share panel replaced", A, "Share of Network");
has("legend lists both quarters", A, "Q2 2026</span>");
has("attendance quarter-over-quarter insight", A, "Attendance down 66.7%</strong> vs Q2 2026 (120 → 40)");

console.log("\n4. Chapter page — Canada (National), two events");
clickTab(A, "canada");
has("display name in the title", A, "Canada (National) <span>Chapter</span>");
has("attendance leader badge (60)", A, "Attendance Leader");
has("largest event", A, "Sample National Webinar");
has("everything else combined: 1 other event, 60 − 45 = 15", A, "1 other event</div>");
has("other events attendance", A, ">15</div>");

console.log("\n5. Comparison page — Q3 2026 network totals and deltas");
clickTab(A, "cmp");
has("title", A, "Chapter <span>Comparison</span>");
has("network events 8 (Q2: 10)", A, ">8</div>");
has("events delta", A, "▼ −20.0% vs Q2 2026");
has("network attendance 160", A, ">160</div>");
has("attendance delta 241 → 160", A, "▼ −33.6% vs Q2 2026");
has("network new followers", A, "+183");
has("network posts", A, ">44</div>");
has("largest single event is a max, not a sum", A, ">45</div>");
eq("one mini card per chapter", (canvas(A).match(/class="cmp-mini"/g) || []).length, 6);
has("clustered bar chart", A, "Attendees and new LinkedIn followers by chapter");
has("engagement bar for Toronto", A, ">22.0%</div>");
has("network insight: attendance leader", A, "Canada (National) leads in attendees</strong> (60, avg 30/event)");
has("network insight: engagement leader", A, "Toronto leads in engagement</strong> — 22.0%");
has("network insight: lowest engagement", A, "Canada (National) has the lowest engagement</strong> (8.0%)");
has("network insight: quarter over quarter", A, "Network attendance down 33.6%</strong> vs Q2 2026 (241 → 160)");

console.log("\n6. Switching to Q2 2026 — the first quarter on record");
pickQuarter(A, "2026_Q2");
eq("stays on the Comparison page; comparing Q2 with itself is dropped", A.sandbox.href,
  EXEC + "?q=2026_Q2&view=cmp");
eq("compare-with now offers Q3", A.kids("vsSel").map(o => o.textContent).join("|"), "No comparison|Q3 2026 · Jul – Sep");
has("Q2 network attendance 241", A, ">241</div>");
lacks("no comparison → no deltas", A, "vs Q");
lacks("no comparison → no QoQ insight", A, "Network attendance");
has("Toronto led Q2 attendance (120)", A, "Toronto leads in attendees</strong> (120");
clickTab(A, "calgary");
has("Calgary flagged for Q2's lowest engagement (3.0%)", A, "Improvement Opportunity");
has("share panel on a single quarter", A, "Share of Network");
pickCompare(A, "2026_Q3");
has("Q2 compared with a later quarter: Calgary 25 vs 10 reads as Q2 being higher", A, "▲ +150.0% vs Q3 2026");
has("bars still in chronological order (Q2 first)", A, '<span class="qt-q">Q2</span>');
pickCompare(A, "");
lacks("choosing 'No comparison' removes the deltas", A, "vs Q3 2026");

console.log("\n7. Deep links are honoured; junk is ignored");
{
  const B = await boot({ search: "?q=2026_Q2&view=vancouver", server: servesJSON(kpis) });
  eq("quarter from URL", B.byId.get("quarterSel").value, "2026_Q2");
  has("page from URL", B, "Vancouver <span>Chapter</span>");
  const C = await boot({ search: "?q=Q3_2026&view=CMP", server: servesJSON(kpis) });
  eq("legacy Q3_2026 spelling normalised", C.byId.get("quarterSel").value, "2026_Q3");
  has("view is case-insensitive", C, "Chapter <span>Comparison</span>");
  const D = await boot({ search: "?q=1999_Q9&view=atlantis&rank=bogus&ch=x", server: servesJSON(kpis) });
  eq("bad quarter → latest", D.byId.get("quarterSel").value, "2026_Q3");
  const V = await boot({ search: "?q=2026_Q3&vs=2026_Q3&view=cmp", server: servesJSON(kpis) });
  eq("comparing a quarter with itself is ignored", V.byId.get("vsSel").value, "");
  const W = await boot({ search: "?q=2026_Q3&vs=Q2_2026&view=cmp", server: servesJSON(kpis) });
  has("comparison deep link honoured", W, "▼ −33.6% vs Q2 2026");
  eq("unknown page → first chapter, old params dropped", D.sandbox.href,
    EXEC + "?q=2026_Q3&view=montreal");
}

console.log("\n8. Data rule: li_engagement_rate > 1 raises the banner");
eq("banner hidden — every engagement rate in the fixture is under 1", A.byId.get("banner").hidden, true);
{
  const bad = JSON.parse(JSON.stringify(kpis));
  bad.rows.find(r => r.chapter === "Montreal" && r.quarter === "2026_Q2").li_engagement_rate = 4.6;
  bad.rows.find(r => r.chapter === "Ottawa"   && r.quarter === "2026_Q2").li_engagement_rate = 3.6;
  const B = await boot({ search: "?q=2026_Q2&view=montreal", server: servesJSON(bad) });
  eq("banner visible", B.byId.get("banner").hidden, false);
  ok("banner counts both", B.txt("banner").includes("2 LinkedIn engagement rate values above 1"), B.txt("banner"));
  ok("banner names Montreal", B.txt("banner").includes("Montreal · Q2 2026 · 4.6"), B.txt("banner"));
  ok("banner names Ottawa", B.txt("banner").includes("Ottawa · Q2 2026 · 3.6"));
  ok("banner explains the decimal rule", B.txt("banner").includes("0.0185 = 1.85%"));
  has("the bad value is not silently rewritten", B, "460.0%");
}

console.log("\n9. SYNTHETIC dataset — nulls, an unknown chapter, hostile text");
{
  const synthetic = { generated_at: "2026-10-04T00:00:00Z", rows: [
    { quarter: "2026_Q3", chapter: "Montreal",  events: 2, attendance: 30, largest_event: 20,
      largest_event_name: '<img src=x onerror="alert(1)">', new_li_followers: 5, total_li_followers: 100,
      li_impressions: 900, li_engagement_rate: 0.12, li_posts: 4 },
    { quarter: "2026_Q3", chapter: "Vancouver", events: null, attendance: null, largest_event: null,
      new_li_followers: 7, total_li_followers: null, li_impressions: null, li_engagement_rate: null, li_posts: null },
    { quarter: "2026_Q3", chapter: "Canada",    events: 1, attendance: 10, largest_event: 10, li_engagement_rate: 0.05, li_posts: 2 },
    { quarter: "2026_Q3", chapter: "Halifax",   events: 1, attendance: 12, largest_event: 12, li_engagement_rate: 0.08, li_posts: 3 }
  ]};
  const S = await boot({ server: servesJSON(synthetic) });
  eq("unknown chapter sorts after known ones, Canada still last",
    tabs(S).map(t => t.dataset.view).join(","), "montreal,vancouver,halifax,canada,cmp");
  ok("unknown chapter gets a fallback colour", tabs(S)[2].innerHTML.includes("#00B7C3"), tabs(S)[2].innerHTML);
  has("event names are escaped", S, "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  lacks("no raw markup from data", S, "<img src=x");
  clickTab(S, "vancouver");
  has("no events → empty highlight", S, "No events in this period");
  has("no posts → organic followers note", S, "No LinkedIn posts tracked");
  has("no engagement → gauge placeholder", S, "No engagement tracked");
  has("null impressions render as N/A, not 0", S, '<div class="kpi-value gray">N/A</div>');
  clickTab(S, "cmp");
  has("network events skip the null (2 + 1 + 1)", S, ">4</div>");
  has("null engagement shows as N/A in the bar chart", S, ">N/A</div>");
  has("null cells in mini cards are muted N/A", S, '<span class="cmp-val na">N/A</span>');
}

console.log("\n10. Field-name and quarter-string tolerance (real feed vs. legacy shapes)");
{
  const mixed = { generated_at: "2026-07-08T00:00:00Z", rows: [
    { quarter: "Q2 2026", chapter: "Montreal",  events: 6,   attendance: 287, li_engagement_rate: "4.6%" },
    { Period:  "Q2_2026", chapter: "Toronto",   events: 8,   attendance: 412, li_engagement_rate: 0.041  },
    { quarter: "2026-Q2", chapter: "Vancouver", events: "5", attendance: 241, li_engagement_rate: ""     },
    { quarter: "nonsense", chapter: "Ghost",    events: 1 }
  ]};
  const E = await boot({ search: "?view=cmp", server: servesJSON(mixed) });
  eq("all three spellings fold into one quarter", E.kids("quarterSel").length, 1);
  eq("unparseable quarter dropped", tabs(E).length, 4);           // 3 chapters + Comparison
  has("numeric strings coerced (287 + 412 + 241)", E, ">940</div>");
  has('"4.6%" → 4.6%', E, ">4.6%</div>");
  eq("banner stays hidden (4.6% parsed as 0.046)", E.byId.get("banner").hidden, true);
}

console.log("\n11. No data without the server — no embedded copy, no fallback");
{
  const F = await boot({ search: "?view=cmp", server: servesNothing });
  eq("banner visible", F.byId.get("banner").hidden, false);
  ok("banner carries the server's message", F.txt("banner").includes("You do not have permission"), F.txt("banner"));
  eq("no tabs", tabs(F).length, 0);
  has("empty canvas message", F, "No data to show.");
  eq("source chip says not loaded", F.txt("srcText"), "Not loaded");

  const Err = await boot({ server: () => ({ error: '"KPIs_Historico" not found.', rows: [] }) });
  ok("an { error } payload is shown too", Err.txt("banner").includes('"KPIs_Historico" not found.'), Err.txt("banner"));

  const Empty = await boot({ server: () => ({ rows: [] }) });
  ok("an empty sheet explains what to run", Empty.txt("banner").includes("runCleaningAndConsolidation()"), Empty.txt("banner"));

  ok("Dashboard.html embeds no KPI rows", !/largest_event_name\s*:\s*["']/.test(html) && !/EMBEDDED/.test(html));
  ok("Dashboard.html makes no network requests of its own", !/\bfetch\(|XMLHttpRequest/.test(code));
}

console.log("\n12. DashboardFeed.gs — server side, against a stubbed sheet");
{
  const header = ["Chapter", "Period", "Events Held", "Total Attendees", "Average Attendees per Event",
    "Largest Event (Attendees)", "Largest Event Name", "New LinkedIn Followers", "Total LinkedIn Followers",
    "LinkedIn Impressions", "Average LinkedIn Engagement Rate", "LinkedIn Posts Published", "Notes"];
  const values = [header,
    ["Montreal", "Q2_2026", 3, 44, 14.7, 22, "Latinx Unmuted", 63, 841, 6333, 0.1851, 11, ""],
    ["Toronto",  "Q3_2026", 1, 53, 53, 53, "Summer Soirée", 93, 1287, 6826, "25.2%", 7, ""],
    ["Canada",   "Q3_2026", "N/A", "N/A", "N/A", "N/A", "N/A", 127, 465, 14922, 4.6, 21, ""],
    ["",         "Q3_2026", 1, 1, 1, 1, "orphan", 1, 1, 1, 0.1, 1, ""],
    ["Ghost",    "someday", 1, 1, 1, 1, "x", 1, 1, 1, 0.1, 1, ""]];
  const gas = (sheets) => {
    const ctx = {
      Date, JSON, String, Number, Math, isFinite, Logger: { log() {} },
      SpreadsheetApp: { getActiveSpreadsheet: () => ({
        getName: () => "Master_Staging_Sheet",
        getSheetByName: n => sheets[n] ? { getDataRange: () => ({ getValues: () => sheets[n] }) } : null
      }) },
      ScriptApp: { getService: () => ({ getUrl: () => EXEC }) },
      HtmlService: { createHtmlOutputFromFile(f) {
        const out = { file: f, setTitle(t) { out.title = t; return out; }, addMetaTag(k, v) { out[k] = v; return out; } };
        return out;
      } }
    };
    vm.runInContext(feedCode, vm.createContext(ctx), { filename: "DashboardFeed.gs" });
    return ctx;
  };

  const g = gas({ KPIs_Historico: values });
  const page = g.doGet();
  eq("doGet serves the Dashboard HTML file", page.file, "Dashboard");
  ok("doGet sets a title and a mobile viewport", page.title.includes("SOMOS") && /width=device-width/.test(page.viewport));

  const d = g.getDashboardData();
  eq("rows with a chapter and a valid period only", d.rows.length, 3);
  eq("periods normalised and sorted", JSON.stringify(d.quarters), JSON.stringify(["2026_Q2", "2026_Q3"]));
  eq("app_url is the deployment's /exec URL", d.app_url, EXEC);
  eq("source names the tab and spreadsheet", d.source, "KPIs_Historico · Master_Staging_Sheet");
  ok("no spreadsheet id in the payload", !("spreadsheet_id" in d));
  const mtl = d.rows.find(r => r.chapter === "Montreal");
  eq("numbers come through", mtl.attendance, 44);
  eq("rate stays a decimal", mtl.li_engagement_rate, 0.1851);
  eq('"25.2%" text → 0.252', d.rows.find(r => r.chapter === "Toronto").li_engagement_rate, 0.252);
  const can = d.rows.find(r => r.chapter === "Canada");
  eq('"N/A" → null, not 0', can.attendance, null);
  eq('"N/A" event name → null', can.largest_event_name, null);
  ok("engagement rate above 1 is flagged", d.warnings.some(w => w.includes("Canada") && w.includes("4.6")), JSON.stringify(d.warnings));
  ok("the result survives google.script.run (plain JSON, no Dates)",
    JSON.stringify(JSON.parse(JSON.stringify(d))) === JSON.stringify(d));

  const missing = gas({}).getDashboardData();
  ok("missing KPIs_Historico → { error } explaining what to run", /runCleaningAndConsolidation/.test(missing.error), missing.error);
  eq("…with no rows", missing.rows.length, 0);
  eq("…and still an app_url", missing.app_url, EXEC);

  const noPeriod = gas({ KPIs_Historico: [["Chapter", "Events Held"], ["Toronto", 1]] }).getDashboardData();
  ok("a header without Period is reported, not guessed", noPeriod.warnings.some(w => /Period/.test(w)), JSON.stringify(noPeriod.warnings));
}

console.log("\n13. GitHub Pages index.html is only a link to the web app");
{
  const index = readFileSync(join(ROOT, "index.html"), "utf8");
  ok("links to the Apps Script /exec URL", /https:\/\/script\.google\.com\/a\/macros\/somoslatinxintech\.com\/s\/[\w-]+\/exec/.test(index));
  ok("no KPI data, no data fetch", !/largest_event_name|kpis\.json|li_engagement_rate|fetch\(/.test(index));
}

console.log(`\n${failures ? "FAILED: " + failures + " check(s)" : "ALL CHECKS PASSED"}`);
process.exit(failures ? 1 : 0);
