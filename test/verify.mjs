/**
 * Regression tests for the dashboard's inline script — no dependencies.
 *
 * Extracts the <script> block out of index.html, runs it in a fresh VM context
 * against a minimal DOM stub, and asserts the data rules, the source-fallback
 * chain, the aggregations, the sorting and the URL state all hold against
 * data/kpis.json — whose Q2 2026 rows are copied verbatim from a real
 * KPIs_Consolidado export and whose Q1 2026 rows are real events/attendance
 * from that same export's unique_events tab (see the README's note on
 * data/kpis.json for what's real vs. genuinely unavailable).
 *
 *   node test/verify.mjs      # exits non-zero on the first failing check
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

const IDS = ["ownerEmail","copyLink","themeBtn","banner","srcDot","srcText","srcMeta","quarterSel",
  "chapLbl","chapCombo","chapSummary","chapPanel","rankSel","resetBtn","main","cards","rankHead",
  "rankSub","bars","barsNote","tableHead","kpiTable","headRow","bodyRows","footRow","tip","toast"];

/**
 * Boot the dashboard script in a fresh context.
 * `fetchImpl(url)` stands in for the network; `search` is the query string.
 */
async function boot({ search = "", fetchImpl } = {}) {
  const byId = new Map();
  for (const id of IDS) byId.set(id, makeEl(id === "chapCombo" ? "details" : "div", id));
  byId.get("chapCombo").children.push(makeEl("summary"));
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

console.log("1. Source resolution (API absent → data/kpis.json)");
const A = await boot({ fetchImpl: servesJSON(kpis) });
eq("fetched data/kpis.json", A.calls.join(","), "data/kpis.json");
eq("source chip", A.txt("srcText"), "Static · data/kpis.json");
ok("chip reports a static snapshot", A.txt("srcMeta").includes("static snapshot"));
ok("chip counts rows/quarters/chapters",
  A.txt("srcMeta").includes("12 rows · 2 quarters · 6 chapters"), A.txt("srcMeta"));

console.log("\n2. Controls built from the data");
eq("quarter options", A.kids("quarterSel").map(o => o.textContent).join("|"), "Q1 2026|Q2 2026");
eq("defaults to latest quarter", A.byId.get("quarterSel").value, "2026_Q2");
eq("rank metric options", A.kids("rankSel").length, 9);
eq("chapter summary", A.txt("chapSummary"), "All chapters (6)");
eq("chapter checkboxes", A.byId.get("chapPanel").querySelectorAll('input[type="checkbox"]').length, 6);

console.log("\n3. Hero + stat tiles (Q2 2026, all chapters — real KPIs_Consolidado numbers)");
let cards = A.kids("cards");
eq("one hero + 3 tiles", cards.length, 4);
ok("hero is the hero", cards[0].className.includes("hero"));
eq("hero label", cards[0].children[0].textContent, "Selected metric · Total attendance");
// Montreal 50 + Toronto 175 + Vancouver 16 + Ottawa 8 + Calgary 41 + Canada 176 = 466
eq("hero value = 466", cards[0].children[1].textContent, "466");
ok("hero delta is up vs Q1", cards[0].children[2].className.includes("up") &&
  cards[0].children[2].textContent.includes("vs Q1 2026"), cards[0].children[2].textContent);
// Q1 attendance (Canada had no events that quarter): 39+38+12+14+17 = 120 -> (466-120)/120 = +288.3%
eq("hero delta amount", cards[0].children[2].children[1].textContent, "+288.3%");
eq("events tile", cards[1].children[1].textContent, "11");                 // 3+3+1+1+2+1
eq("new LI followers tile", cards[2].children[1].textContent, "514");      // 63+157+35+43+26+190
eq("LI engagement tile (weighted by total LI followers)", cards[3].children[1].textContent, "17.2%");
eq("weighted note on rate tile", cards[3].children[2].textContent, "Weighted by total LinkedIn followers.");

console.log("\n4. Ranked bars — Q2 2026, all 6 chapters have real attendance (no N/A here)");
let bars = A.kids("bars");
eq("6 bars for attendance", bars.length, 6);
eq("leader is Canada (176, edges out Toronto's 175)", bars[0].children[0].textContent, "Canada");
eq("leader value", bars[0].children[1].children[1].textContent, "176");
eq("leader bar at the 82% cap", bars[0].children[1].children[0].style.width, "82.00%");
ok("bars sorted descending",
  bars.map(b => Number(b.children[1].children[1].textContent.replace(/,/g, "")))
      .every((v, i, a) => i === 0 || a[i - 1] >= v));
eq("no missing-data note — every chapter reported attendance", A.byId.get("barsNote").hidden, true);

console.log("\n5. Null handling — switch to Q1 2026, rank by largest_event (Canada ran no events that quarter)");
A.byId.get("quarterSel").value = "2026_Q1";
A.byId.get("quarterSel").fire("change");
A.byId.get("rankSel").value = "largest_event";
A.byId.get("rankSel").fire("change");
bars = A.kids("bars");
eq("5 bars, Canada left off", bars.length, 5);
ok("note names Canada", A.txt("barsNote").includes("Canada"), A.txt("barsNote"));
ok("note says N/A in the table", A.txt("barsNote").includes("N/A in the table"));
eq("largest single event leader is Toronto (38)", bars[0].children[0].textContent, "Toronto");
eq("max aggregation, not sum", bars[0].children[1].children[1].textContent, "38");

console.log("\n6. Table (still Q1 2026) — sorting, N/A, totals");
let body = A.kids("bodyRows");
eq("6 table rows", body.length, 6);
const canada = body.find(tr => tr.children[0].textContent === "Canada");
eq("Canada events = N/A (no events that quarter)", A.cell(canada, 1), "N/A");
eq("Canada attendance = N/A", A.cell(canada, 2), "N/A");
eq("Canada largest_event = N/A", A.cell(canada, 4), "N/A");
ok("N/A cells are muted, not zero", canada.children[1].className.includes("na"));
eq("Canada LI engagement = N/A (Q1 has no LinkedIn export in this snapshot)", A.cell(canada, 8), "N/A");
const montreal = body.find(tr => tr.children[0].textContent === "Montreal");
eq("Montreal (real events) is also N/A for LI engagement in Q1", A.cell(montreal, 8), "N/A");
eq("...but has real event numbers", A.cell(montreal, 2), "39");
const head = A.kids("headRow");
eq("1 label + 9 metric columns", head.length, 10);
eq("column order", head.map(h => h.children[0].textContent).join("|"),
  "Chapter|Events|Attendance|Avg / event|Largest event|New LI|Total LI|Impressions|LI engmt.|LI posts");
eq("default sort is attendance desc", body[0].children[0].textContent, "Montreal");
head[3].fire("click");                                   // avg_attendance, desc
body = A.kids("bodyRows");
eq("avg_attendance desc leader", body[0].children[0].textContent, "Toronto");
eq("null sorts last on desc", body[5].children[0].textContent, "Canada");
A.kids("headRow")[3].fire("click");                       // toggle to asc
body = A.kids("bodyRows");
eq("avg_attendance asc leader", body[0].children[0].textContent, "Vancouver");
eq("null still sorts last on asc", body[5].children[0].textContent, "Canada");
A.kids("headRow")[0].fire("click");                      // chapter asc
body = A.kids("bodyRows");
eq("chapter asc first", body[0].children[0].textContent, "Calgary");
eq("chapter asc last", body[5].children[0].textContent, "Vancouver");
let foot = A.kids("footRow");
eq("footer label", foot[0].textContent, "All selected (6)");
eq("footer attendance total", foot[2].textContent, "120");
eq("footer largest_event is max, not sum", foot[4].textContent, "38");
eq("footer avg_attendance ratio (Σattendance/Σevents, Canada excluded)", foot[3].textContent, "20.0");
eq("footer LI columns all N/A in Q1", foot[8].textContent, "N/A");

console.log("\n7. URL state round-trips");
eq("URL after section 5-6's interactions",
  A.sandbox.location.href, "http://127.0.0.1:8765/?q=2026_Q1&rank=largest_event&sort=chapter&dir=asc");
const boxes = A.byId.get("chapPanel").querySelectorAll('input[type="checkbox"]');
for (const b of boxes) b.checked = ["montreal", "toronto", "ottawa"].includes(b.value);
boxes[0].fire("change");
ok("ch appears with a subset", /ch=montreal%2Cottawa%2Ctoronto/.test(A.sandbox.location.href),
  A.sandbox.location.href);
eq("summary reflects subset", A.txt("chapSummary"), "3 of 6 chapters");
eq("3 table rows", A.kids("bodyRows").length, 3);
eq("footer recomputed for subset (Montreal 39 + Toronto 38 + Ottawa 14)", A.kids("footRow")[2].textContent, "91");

console.log("\n8. Empty selection degrades cleanly");
for (const b of boxes) b.checked = false;
boxes[0].fire("change");
eq("summary", A.txt("chapSummary"), "No chapters");
eq("table says no chapters", A.kids("bodyRows")[0].children[0].textContent, "No chapters selected.");
eq("hero is N/A", A.kids("cards")[0].children[1].textContent, "N/A");
ok("hero N/A is muted", A.kids("cards")[0].children[1].className.includes("na"));
eq("bars empty state", A.kids("bars")[0].textContent, "No chapters selected.");

console.log("\n9. Reset returns to defaults");
A.byId.get("resetBtn").fire("click");
eq("quarter reset to latest", A.byId.get("quarterSel").value, "2026_Q2");
eq("chapters reset", A.txt("chapSummary"), "All chapters (6)");
eq("clean URL", A.sandbox.location.href, "http://127.0.0.1:8765/?q=2026_Q2");
eq("banner hidden — real Q2 engagement rates are all well under 1", A.byId.get("banner").hidden, true);

console.log("\n10. Data rule: li_engagement_rate > 1 raises the banner");
{
  const bad = JSON.parse(JSON.stringify(kpis));
  bad.rows.find(r => r.chapter === "Montreal" && r.quarter === "2026_Q2").li_engagement_rate = 4.6;
  bad.rows.find(r => r.chapter === "Ottawa"   && r.quarter === "2026_Q2").li_engagement_rate = 3.6;
  const B = await boot({ fetchImpl: servesJSON(bad) });
  eq("banner visible", B.byId.get("banner").hidden, false);
  ok("banner counts both", B.txt("banner").includes("2 LinkedIn engagement rate values above 1"), B.txt("banner"));
  ok("banner names Montreal", B.txt("banner").includes("Montreal · Q2 2026 · 4.6"), B.txt("banner"));
  ok("banner names Ottawa", B.txt("banner").includes("Ottawa · Q2 2026 · 3.6"));
  ok("banner explains the decimal rule", B.txt("banner").includes("0.0185 = 1.85%"));
  ok("the bad value is not silently rewritten",
    B.kids("bodyRows").find(tr => tr.children[0].textContent === "Montreal").children[8].textContent === "460.0%");
}

console.log("\n11. URL deep-link is honoured on load (Q2 2026, real per-chapter engagement rates)");
{
  const C = await boot({
    search: "?q=2026_Q2&ch=montreal,toronto,vancouver&rank=li_engagement_rate&sort=li_engagement_rate&dir=asc",
    fetchImpl: servesJSON(kpis)
  });
  eq("quarter from URL", C.byId.get("quarterSel").value, "2026_Q2");
  eq("rank metric from URL", C.byId.get("rankSel").value, "li_engagement_rate");
  eq("chapters from URL", C.txt("chapSummary"), "3 of 6 chapters");
  eq("hero follows rank metric", C.kids("cards")[0].children[0].textContent,
    "Selected metric · LinkedIn engagement rate");
  eq("delta vs Q1 is N/A (Q1 has no LinkedIn data for these 3 chapters, not 'no prior quarter')",
    C.kids("cards")[0].children[3].textContent, "Change vs Q1 2026: N/A");
  eq("3 bars", C.kids("bars").length, 3);
  eq("bars always rank desc regardless of table dir — leader is Montreal (18.5%)",
    C.kids("bars")[0].children[0].textContent, "Montreal");
  eq("table honours dir=asc from the URL — first row is Vancouver (13.9%, the lowest)",
    C.kids("bodyRows")[0].children[0].textContent, "Vancouver");
}

console.log("\n12. Stale / junk URL parameters are ignored");
{
  const D = await boot({
    search: "?q=1999_Q9&ch=atlantis,montreal&rank=bogus&sort=nope&dir=sideways",
    fetchImpl: servesJSON(kpis)
  });
  eq("bad quarter → latest", D.byId.get("quarterSel").value, "2026_Q2");
  eq("bad rank → default", D.byId.get("rankSel").value, "attendance");
  eq("unknown chapter dropped", D.txt("chapSummary"), "Montreal");
  eq("one bar", D.kids("bars").length, 1);
}

console.log("\n13. Field-name and quarter-string tolerance (real feed vs. legacy shapes)");
{
  const mixed = { generated_at: "2026-07-08T00:00:00Z", rows: [
    { quarter: "Q2 2026", chapter: "Montreal",  events: 6,   attendance: 287, li_engagement_rate: "4.6%" },
    { Period:  "Q2_2026", chapter: "Toronto",   events: 8,   attendance: 412, li_engagement_rate: 0.041  },
    { quarter: "2026-Q2", chapter: "Vancouver", events: "5", attendance: 241, li_engagement_rate: ""     },
    { quarter: "nonsense", chapter: "Ghost",    events: 1 }
  ]};
  const E = await boot({ fetchImpl: servesJSON(mixed) });
  eq("all three spellings fold into one quarter", E.kids("quarterSel").length, 1);
  eq("quarter label", E.kids("quarterSel")[0].textContent, "Q2 2026");
  eq("unparseable quarter dropped", E.kids("bodyRows").length, 3);
  eq("numeric string coerced", E.kids("footRow")[2].textContent, "940");   // 287+412+241
  const eMontreal = E.kids("bodyRows").find(tr => tr.children[0].textContent === "Montreal");
  eq('"4.6%" → 4.6%', E.cell(eMontreal, 8), "4.6%");
  const eVancouver = E.kids("bodyRows").find(tr => tr.children[0].textContent === "Vancouver");
  eq("empty string → N/A, not 0", E.cell(eVancouver, 8), "N/A");
  const eToronto = E.kids("bodyRows").find(tr => tr.children[0].textContent === "Toronto");
  eq("Period (capital) header recognised", E.cell(eToronto, 2), "412");
  eq("banner stays hidden (4.6% parsed as 0.046)", E.byId.get("banner").hidden, true);
}

console.log("\n14. Embedded fallback when every fetch fails");
{
  const F = await boot({ fetchImpl: servesNothing });
  eq("embedded source", F.txt("srcText"), "Embedded fallback · Q2 2026");
  eq("embedded chapters", F.kids("bodyRows").length, 6);
  eq("embedded hero matches the real Q2 export", F.kids("cards")[0].children[1].textContent, "466");
  eq("only Q2 2026 available", F.kids("quarterSel").length, 1);
  ok("chip explains the fallback", F.txt("srcMeta").includes("fell back after"), F.txt("srcMeta"));
  ok("no prior quarter in the embedded copy → delta says so",
    F.kids("cards")[0].children[2].textContent.includes("No Q1 2026 data to compare"),
    F.kids("cards")[0].children[2].textContent);
  const embeddedCanada = F.kids("bodyRows").find(tr => tr.children[0].textContent === "Canada");
  eq("Canada has real events in the embedded copy too (176 attendees)", F.cell(embeddedCanada, 2), "176");
}

console.log("\n15. Published-CSV parsing (Workspace policy blocks the JSON Apps Script feed for");
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
