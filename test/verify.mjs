/**
 * Regression tests for the dashboard's inline script — no dependencies.
 *
 * Extracts the <script> block out of index.html, runs it in a fresh VM context
 * against a minimal DOM stub, and asserts the data rules, the source-fallback
 * chain, the aggregations, the per-chapter / Comparison pages and the URL
 * state all hold.
 *
 * data/kpis.json holds two real quarters (Q2 + Q3 2026, exported verbatim from
 * KPIs_Historico via Consolidation.gs's exportKpisJson() on 2026-10-04) with
 * no nulls. Sections that need missing values, unknown chapters or hostile
 * text use a clearly-labelled SYNTHETIC dataset instead.
 *
 * Page content is rendered as HTML strings into #canvas, so most checks
 * assert on that string (the stub keeps `innerHTML` as a plain property).
 *
 *   node test/verify.mjs      # exits non-zero if any check fails
 *
 * Run it after touching index.html, data/kpis.json, or the metric registry.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(ROOT, "index.html"), "utf8");
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const kpis = JSON.parse(readFileSync(join(ROOT, "data", "kpis.json"), "utf8"));

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

/**
 * Boot the dashboard script in a fresh context.
 * `fetchImpl(url)` stands in for the network; `search` is the query string.
 */
async function boot({ search = "", fetchImpl } = {}) {
  const byId = new Map();
  for (const id of IDS) byId.set(id, makeEl("div", id));
  const calls = [];

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
    location: { search, pathname: "/", hash: "", href: "http://127.0.0.1:8765/" + search },
    history: { replaceState(_a, _b, url) { sandbox.location.href = "http://127.0.0.1:8765" + url; } },
    navigator: { clipboard: { writeText: async () => {} } },
    fetch: async url => { calls.push(url); return fetchImpl(url); }
  };
  sandbox.globalThis = sandbox;

  vm.runInContext(code, vm.createContext(sandbox), { filename: "index.html:script" });
  await new Promise(r => setTimeout(r, 40));       // let the async boot() settle

  return {
    byId, sandbox, calls,
    txt: id => byId.get(id).textContent,
    kids: id => byId.get(id).children,
    cell: (tr, i) => tr.children[i].textContent
  };
}

const servesJSON = payload => async url => {
  if (url === "data/kpis.json") return { ok: true, json: async () => payload };
  throw new Error("unexpected fetch " + url);
};
const servesNothing = () => { throw new Error("network down"); };

/* ====================================================================== */


const canvas = T => T.byId.get("canvas").innerHTML;
const tabs = T => T.kids("tabs").filter(t => t.tagName === "BUTTON");
const clickTab = (T, view) => tabs(T).find(t => t.dataset.view === view).fire("click");
const pickQuarter = (T, q) => { const s = T.byId.get("quarterSel"); s.value = q; s.fire("change"); };
const pickCompare = (T, q) => { const s = T.byId.get("vsSel"); s.value = q; s.fire("change"); };
const has = (name, T, needle) => ok(name, canvas(T).includes(needle), "canvas lacks " + JSON.stringify(needle));
const lacks = (name, T, needle) => ok(name, !canvas(T).includes(needle), "canvas has " + JSON.stringify(needle));

console.log("1. Source resolution (API absent → data/kpis.json, two real quarters)");
const A = await boot({ fetchImpl: servesJSON(kpis) });
eq("fetched data/kpis.json", A.calls.join(","), "data/kpis.json");
eq("source chip", A.txt("srcText"), "Static · data/kpis.json");
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
eq("URL records quarter + page", A.sandbox.location.href, "http://127.0.0.1:8765/?q=2026_Q3&view=montreal");

console.log("\n3. Chapter page — Toronto, Q3 2026 on its own (no comparison picked)");
clickTab(A, "toronto");
ok("Toronto tab now active", tabs(A)[1].className.includes("active") && !tabs(A)[0].className.includes("active"));
eq("URL follows the tab", A.sandbox.location.href, "http://127.0.0.1:8765/?q=2026_Q3&view=toronto");
has("page title", A, "Toronto <span>Chapter</span>");
has("subtitle + badge (Canada leads attendance, Toronto leads engagement)", A,
  "1 event(s) · 53 attendees · engagement 25.2% · Engagement Leader");
has("new followers card", A, "+93");
lacks("no deltas without a comparison", A, "vs Q2 2026");
lacks("no comparison panel", A, "Quarter Comparison");
has("share-of-network panel instead", A, "Share of Network");
has("Toronto's share of Q3 attendance (53 / 202)", A, ">26.2%</span>");
has("period chip shows just Q3", A, '<div class="period-chip">Q3 2026 · Jul – Sep</div>');
has("largest event highlighted", A, "Somos Latinx in Tech Summer Soirée");
lacks("single event → no 'other events' row", A, "other event");
has("gauge drawn", A, "Engagement rate gauge");
has("gauge scale tops out at 35% (25.2% × 1.2, rounded up to 5)", A, ">35%</text>");
has("network engagement shown under the gauge", A, "Network: 19.1%");
has("avg vs network insight (Σ202 / Σ8 = 25.3)", A, "is above the network average (25.3)");
lacks("no quarter-over-quarter insight", A, "Attendance down");

console.log("\n3b. Compare with Q2 2026 → deltas and the quarter comparison appear");
pickCompare(A, "2026_Q2");
eq("URL records the comparison", A.sandbox.location.href, "http://127.0.0.1:8765/?q=2026_Q3&vs=2026_Q2&view=toronto");
has("period chip names both quarters", A, "Q3 2026 · Jul – Sep vs Q2 2026");
has("events delta 3 → 1", A, "▼ −66.7% vs Q2 2026");
has("attendance delta 175 → 53", A, "▼ −69.7% vs Q2 2026");
has("engagement delta in points (17.93% → 25.2%)", A, "▲ +7.3 pts vs Q2 2026");
has("quarter comparison panel", A, "Quarter Comparison");
lacks("share panel replaced", A, "Share of Network");
has("legend lists both quarters", A, "Q2 2026</span>");
has("attendance quarter-over-quarter insight", A, "Attendance down 69.7%</strong> vs Q2 2026 (175 → 53)");

console.log("\n4. Chapter page — Canada (National), two events");
clickTab(A, "canada");
has("display name in the title", A, "Canada (National) <span>Chapter</span>");
has("attendance leader badge (91)", A, "Attendance Leader");
has("largest event", A, "Career Momentum: Staying Ready Between Opportunities");
has("everything else combined: 1 other event, 91 − 59 = 32", A, "1 other event</div>");
has("other events attendance", A, ">32</div>");

console.log("\n5. Comparison page — Q3 2026 network totals and deltas");
clickTab(A, "cmp");
has("title", A, "Chapter <span>Comparison</span>");
has("network events 8 (Q2: 11)", A, ">8</div>");
has("events delta", A, "▼ −27.3% vs Q2 2026");
has("network attendance 202", A, ">202</div>");
has("attendance delta 351 → 202", A, "▼ −42.5% vs Q2 2026");
has("network new followers", A, "+331");
has("network posts", A, ">65</div>");
has("largest single event is a max, not a sum", A, ">59</div>");
eq("one mini card per chapter", (canvas(A).match(/class="cmp-mini"/g) || []).length, 6);
has("clustered bar chart", A, "Attendees and new LinkedIn followers by chapter");
has("engagement bar for Toronto", A, ">25.2%</div>");
has("network insight: attendance leader", A, "Canada (National) leads in attendees</strong> (91, avg 45.5/event)");
has("network insight: engagement leader", A, "Toronto leads in engagement</strong> — 25.2%");
has("network insight: lowest engagement", A, "Canada (National) has the lowest engagement</strong> (10.1%)");
has("network insight: quarter over quarter", A, "Network attendance down 42.5%</strong> vs Q2 2026 (351 → 202)");

console.log("\n6. Switching to Q2 2026 — the first quarter on record");
pickQuarter(A, "2026_Q2");
eq("stays on the Comparison page; comparing Q2 with itself is dropped", A.sandbox.location.href,
  "http://127.0.0.1:8765/?q=2026_Q2&view=cmp");
eq("compare-with now offers Q3", A.kids("vsSel").map(o => o.textContent).join("|"), "No comparison|Q3 2026 · Jul – Sep");
has("Q2 network attendance 351", A, ">351</div>");
lacks("no comparison → no deltas", A, "vs Q");
lacks("no comparison → no QoQ insight", A, "Network attendance");
has("Toronto led Q2 attendance (175)", A, "Toronto leads in attendees</strong> (175");
clickTab(A, "calgary");
has("Calgary flagged for Q2's lowest engagement (2.8%)", A, "Improvement Opportunity");
has("share panel on a single quarter", A, "Share of Network");
pickCompare(A, "2026_Q3");
has("Q2 compared with a later quarter: Calgary 41 vs 15 reads as Q2 being higher", A, "▲ +173.3% vs Q3 2026");
has("bars still in chronological order (Q2 first)", A, '<span class="qt-q">Q2</span>');
pickCompare(A, "");
lacks("choosing 'No comparison' removes the deltas", A, "vs Q3 2026");

console.log("\n7. Deep links are honoured; junk is ignored");
{
  const B = await boot({ search: "?q=2026_Q2&view=vancouver", fetchImpl: servesJSON(kpis) });
  eq("quarter from URL", B.byId.get("quarterSel").value, "2026_Q2");
  has("page from URL", B, "Vancouver <span>Chapter</span>");
  const C = await boot({ search: "?q=Q3_2026&view=CMP", fetchImpl: servesJSON(kpis) });
  eq("legacy Q3_2026 spelling normalised", C.byId.get("quarterSel").value, "2026_Q3");
  has("view is case-insensitive", C, "Chapter <span>Comparison</span>");
  const D = await boot({ search: "?q=1999_Q9&view=atlantis&rank=bogus&ch=x", fetchImpl: servesJSON(kpis) });
  eq("bad quarter → latest", D.byId.get("quarterSel").value, "2026_Q3");
  const V = await boot({ search: "?q=2026_Q3&vs=2026_Q3&view=cmp", fetchImpl: servesJSON(kpis) });
  eq("comparing a quarter with itself is ignored", V.byId.get("vsSel").value, "");
  const W = await boot({ search: "?q=2026_Q3&vs=Q2_2026&view=cmp", fetchImpl: servesJSON(kpis) });
  has("comparison deep link honoured", W, "▼ −42.5% vs Q2 2026");
  eq("unknown page → first chapter, old params dropped", D.sandbox.location.href,
    "http://127.0.0.1:8765/?q=2026_Q3&view=montreal");
}

console.log("\n8. Data rule: li_engagement_rate > 1 raises the banner");
eq("banner hidden — real engagement rates are all well under 1", A.byId.get("banner").hidden, true);
{
  const bad = JSON.parse(JSON.stringify(kpis));
  bad.rows.find(r => r.chapter === "Montreal" && r.quarter === "2026_Q2").li_engagement_rate = 4.6;
  bad.rows.find(r => r.chapter === "Ottawa"   && r.quarter === "2026_Q2").li_engagement_rate = 3.6;
  const B = await boot({ search: "?q=2026_Q2&view=montreal", fetchImpl: servesJSON(bad) });
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
  const S = await boot({ fetchImpl: servesJSON(synthetic) });
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
  const E = await boot({ search: "?view=cmp", fetchImpl: servesJSON(mixed) });
  eq("all three spellings fold into one quarter", E.kids("quarterSel").length, 1);
  eq("unparseable quarter dropped", tabs(E).length, 4);           // 3 chapters + Comparison
  has("numeric strings coerced (287 + 412 + 241)", E, ">940</div>");
  has('"4.6%" → 4.6%', E, ">4.6%</div>");
  eq("banner stays hidden (4.6% parsed as 0.046)", E.byId.get("banner").hidden, true);
}

console.log("\n11. Embedded fallback when every fetch fails");
{
  const F = await boot({ search: "?view=cmp", fetchImpl: servesNothing });
  eq("embedded source", F.txt("srcText"), "Embedded fallback · Q2–Q3 2026");
  eq("both quarters available", F.kids("quarterSel").length, 2);
  ok("chip explains the fallback", F.txt("srcMeta").includes("fell back after"), F.txt("srcMeta"));
  has("embedded copy matches the real Q3 export", F, ">202</div>");
  pickQuarter(F, "2026_Q2");
  has("embedded Q2 matches the 2026-10-04 re-export (351, not the old 466)", F, ">351</div>");
}

console.log("\n12. Published-CSV parsing (Workspace policy blocks the JSON Apps Script feed for");
console.log("    this org, so a published-to-web CSV of KPIs_Historico is the live-data path)");
{
  const G = await boot({ fetchImpl: servesJSON(kpis) });   // any boot exposes the sandbox's top-level fns
  const { parseCSV, csvToRawRows, normalizeRows } = G.sandbox;

  eq("parseCSV: plain fields", JSON.stringify(parseCSV("a,b,c\n1,2,3")), JSON.stringify([["a","b","c"],["1","2","3"]]));
  eq("parseCSV: quoted field with an embedded comma",
    JSON.stringify(parseCSV('Chapter,Largest Event Name\nMontreal,"Tamos Juntos, Summer Social"')),
    JSON.stringify([["Chapter","Largest Event Name"],["Montreal","Tamos Juntos, Summer Social"]]));
  eq("parseCSV: doubled quotes unescape to one quote",
    JSON.stringify(parseCSV('a\n"3""x"""')), JSON.stringify([["a"],['3"x"']]));
  eq("parseCSV: CRLF and bare LF both end a row",
    JSON.stringify(parseCSV("a,b\r\n1,2\n3,4")), JSON.stringify([["a","b"],["1","2"],["3","4"]]));
  eq("parseCSV: blank trailing line dropped, not an empty row", parseCSV("a,b\n1,2\n").length, 2);

  const csv = [
    "Chapter,Period,Events Held,Total Attendees,Average Attendees per Event,Largest Event (Attendees),Largest Event Name,New LinkedIn Followers,Total LinkedIn Followers,LinkedIn Impressions,Average LinkedIn Engagement Rate,LinkedIn Posts Published",
    'Montreal,Q2_2026,3,50,16.7,22,"Latinx Unmuted",63,841,6333,0.1851,11',
    'Toronto,Q2_2026,3,175,58.3,76,"Side Project Showcase, Encore",157,1230,16448,0.1793,21',
    "Canada,Q2_2026,,,,,,,,,,,"      // blank event/LI cells -> N/A, not 0
  ].join("\r\n");
  const raw = csvToRawRows(csv);
  eq("csvToRawRows: 3 data rows", raw.length, 3);
  eq("csvToRawRows: Period column maps to `quarter`", raw[0].quarter, "Q2_2026");
  eq("csvToRawRows: header matching is case/punctuation-insensitive like DashboardFeed.gs",
    raw[0].chapter, "Montreal");
  ok("csvToRawRows: quoted comma in an event name survives", raw[1].largest_event_name.includes("Encore"),
    raw[1].largest_event_name);

  const rows = normalizeRows(raw);
  eq("normalizeRows accepts CSV output exactly like the JSON feed's", rows.length, 3);
  const csvMontreal = rows.find(r => r.chapter === "Montreal");
  eq("numbers parsed from CSV text", csvMontreal.attendance, 50);
  eq("rate parsed from CSV text", csvMontreal.li_engagement_rate, 0.1851);
  const csvCanada = rows.find(r => r.chapter === "Canada");
  eq("blank CSV cells become null (N/A), not 0 or NaN", csvCanada.attendance, null);
  eq("derived avg_attendance is still computed from the CSV numbers",
    Number(csvMontreal.avg_attendance.toFixed(1)), 16.7);
}

console.log(`\n${failures ? "FAILED: " + failures + " check(s)" : "ALL CHECKS PASSED"}`);
process.exit(failures ? 1 : 0);
