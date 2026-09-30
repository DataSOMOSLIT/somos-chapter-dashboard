/**
 * Regression tests for the dashboard's inline script — no dependencies.
 *
 * Extracts the <script> block out of index.html, runs it in a fresh VM context
 * against a minimal DOM stub, and asserts the data rules, the source-fallback
 * chain, the aggregations, the sorting and the URL state all hold.
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
ok("chip reports sample figures", A.txt("srcMeta").includes("sample figures"));
ok("chip counts rows/quarters/chapters",
  A.txt("srcMeta").includes("12 rows · 2 quarters · 6 chapters"), A.txt("srcMeta"));

console.log("\n2. Controls built from the data");
eq("quarter options", A.kids("quarterSel").map(o => o.textContent).join("|"), "Q1 2026|Q2 2026");
eq("defaults to latest quarter", A.byId.get("quarterSel").value, "2026_Q2");
eq("rank metric options", A.kids("rankSel").length, 9);
eq("chapter summary", A.txt("chapSummary"), "All chapters (6)");
eq("chapter checkboxes", A.byId.get("chapPanel").querySelectorAll('input[type="checkbox"]').length, 6);

console.log("\n3. Hero + stat tiles (Q2 2026, all chapters)");
let cards = A.kids("cards");
eq("one hero + 3 tiles", cards.length, 4);
ok("hero is the hero", cards[0].className.includes("hero"));
eq("hero label", cards[0].children[0].textContent, "Selected metric · Total attendance");
// Montreal 287 + Toronto 412 + Vancouver 241 + Ottawa 126 + Calgary 32 + Canada null = 1098
eq("hero value = 1,098", cards[0].children[1].textContent, "1,098");
ok("hero delta is up vs Q1", cards[0].children[2].className.includes("up") &&
  cards[0].children[2].textContent.includes("vs Q1 2026"), cards[0].children[2].textContent);
// Q1 attendance: 210+340+150+80 = 780 (Calgary/Canada null) -> (1098-780)/780 = +40.8%
eq("hero delta amount", cards[0].children[2].children[1].textContent, "+40.8%");
eq("events tile", cards[1].children[1].textContent, "23");                 // 6+8+5+3+1
eq("new LI followers tile", cards[2].children[1].textContent, "901");      // 140+205+110+48+33+365
ok("LI engagement tile is a weighted %", /^\d+\.\d%$/.test(cards[3].children[1].textContent),
  cards[3].children[1].textContent);
eq("weighted note on rate tile", cards[3].children[2].textContent, "Weighted by total LinkedIn followers.");

console.log("\n4. Ranked bars");
let bars = A.kids("bars");
eq("5 bars for attendance (Canada has none)", bars.length, 5);
eq("leader is Toronto", bars[0].children[0].textContent, "Toronto");
eq("leader value", bars[0].children[1].children[1].textContent, "412");
eq("leader bar at the 82% cap", bars[0].children[1].children[0].style.width, "82.00%");
ok("bars sorted descending",
  bars.map(b => Number(b.children[1].children[1].textContent.replace(/,/g, "")))
      .every((v, i, a) => i === 0 || a[i - 1] >= v));
ok("missing-data note names Canada", !A.byId.get("barsNote").hidden && A.txt("barsNote").includes("Canada"),
  A.txt("barsNote"));

console.log("\n5. Null handling — largest_event (Canada has none, Calgary has one small one)");
A.byId.get("rankSel").value = "largest_event";
A.byId.get("rankSel").fire("change");
bars = A.kids("bars");
eq("5 bars, Canada left off", bars.length, 5);
ok("note names Canada", A.txt("barsNote").includes("Canada"), A.txt("barsNote"));
eq("largest single event leader is Toronto (128)", bars[0].children[0].textContent, "Toronto");
eq("max aggregation, not sum", bars[0].children[1].children[1].textContent, "128");

console.log("\n6. Table — sorting, N/A, totals");
let body = A.kids("bodyRows");
eq("6 table rows", body.length, 6);
const canada = body.find(tr => tr.children[0].textContent === "Canada");
eq("Canada events = N/A", A.cell(canada, 1), "N/A");
eq("Canada attendance = N/A", A.cell(canada, 2), "N/A");
eq("Canada largest_event = N/A", A.cell(canada, 4), "N/A");
ok("N/A cells are muted, not zero", canada.children[1].className.includes("na"));
eq("Canada LI engagement renders as %", A.cell(canada, 8), "4.8%");
const head = A.kids("headRow");
eq("1 label + 9 metric columns", head.length, 10);
eq("default sort is attendance desc", body[0].children[0].textContent, "Toronto");
head[3].fire("click");                                   // avg_attendance, desc
body = A.kids("bodyRows");
// avg_attendance: Montreal 47.8, Toronto 51.5, Vancouver 48.2, Ottawa 42.0, Calgary 32.0, Canada null
eq("avg_attendance desc leader", body[0].children[0].textContent, "Toronto");
eq("null sorts last on desc", body[5].children[0].textContent, "Canada");
head[3].fire("click");                                   // toggle to asc
body = A.kids("bodyRows");
eq("avg_attendance asc leader", body[0].children[0].textContent, "Calgary");
eq("null still sorts last on asc", body[5].children[0].textContent, "Canada");
A.kids("headRow")[0].fire("click");                      // chapter asc
body = A.kids("bodyRows");
eq("chapter asc first", body[0].children[0].textContent, "Calgary");
eq("chapter asc last", body[5].children[0].textContent, "Vancouver");
let foot = A.kids("footRow");
eq("footer label", foot[0].textContent, "All selected (6)");
eq("footer attendance total", foot[2].textContent, "1,098");
eq("footer largest_event is max, not sum", foot[4].textContent, "128");
eq("footer events/attendance ratio", foot[3].textContent, "47.7");

console.log("\n7. URL state round-trips");
ok("URL carries quarter + rank + sort",
  /q=2026_Q2/.test(A.sandbox.location.href) && /rank=largest_event/.test(A.sandbox.location.href) &&
  /sort=chapter/.test(A.sandbox.location.href), A.sandbox.location.href);
ok("ch omitted while all chapters selected", !/[?&]ch=/.test(A.sandbox.location.href),
  A.sandbox.location.href);
const boxes = A.byId.get("chapPanel").querySelectorAll('input[type="checkbox"]');
for (const b of boxes) b.checked = ["montreal", "toronto", "ottawa"].includes(b.value);
boxes[0].fire("change");
ok("ch appears with a subset",
  /ch=montreal(%2C|,)ottawa(%2C|,)toronto|ch=montreal(%2C|,)toronto(%2C|,)ottawa/.test(A.sandbox.location.href),
  A.sandbox.location.href);
eq("summary reflects subset", A.txt("chapSummary"), "3 of 6 chapters");
eq("3 table rows", A.kids("bodyRows").length, 3);
eq("footer recomputed for subset", A.kids("footRow")[2].textContent, "825");   // 287+412+126

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
eq("quarter reset", A.byId.get("quarterSel").value, "2026_Q2");
eq("chapters reset", A.txt("chapSummary"), "All chapters (6)");
eq("clean URL", A.sandbox.location.href, "http://127.0.0.1:8765/?q=2026_Q2");
eq("banner hidden for clean data", A.byId.get("banner").hidden, true);

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

console.log("\n11. URL deep-link is honoured on load");
{
  const C = await boot({
    search: "?q=2026_Q1&ch=montreal,toronto,vancouver&rank=li_engagement_rate&sort=li_engagement_rate&dir=asc",
    fetchImpl: servesJSON(kpis)
  });
  eq("quarter from URL", C.byId.get("quarterSel").value, "2026_Q1");
  eq("rank metric from URL", C.byId.get("rankSel").value, "li_engagement_rate");
  eq("chapters from URL", C.txt("chapSummary"), "3 of 6 chapters");
  eq("hero follows rank metric", C.kids("cards")[0].children[0].textContent,
    "Selected metric · LinkedIn engagement rate");
  eq("3 bars", C.kids("bars").length, 3);
  eq("bars ranked by rate", C.kids("bars")[0].children[0].textContent, "Vancouver");
  eq("sort from URL (rate asc)", C.kids("bodyRows")[0].children[0].textContent, "Toronto");
  eq("Q1 hero has no earlier quarter",
    C.kids("cards")[0].children[3].textContent, "No Q4 2025 data to compare");
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
  const montreal = E.kids("bodyRows").find(tr => tr.children[0].textContent === "Montreal");
  eq('"4.6%" → 4.6%', E.cell(montreal, 8), "4.6%");
  const vancouver = E.kids("bodyRows").find(tr => tr.children[0].textContent === "Vancouver");
  eq("empty string → N/A, not 0", E.cell(vancouver, 8), "N/A");
  const toronto = E.kids("bodyRows").find(tr => tr.children[0].textContent === "Toronto");
  eq("Period (capital) header recognised", E.cell(toronto, 2), "412");
  eq("banner stays hidden (4.6% parsed as 0.046)", E.byId.get("banner").hidden, true);
}

console.log("\n14. Embedded fallback when every fetch fails");
{
  const F = await boot({ fetchImpl: servesNothing });
  eq("embedded source", F.txt("srcText"), "Embedded fallback · Q2 2026");
  eq("embedded chapters", F.kids("bodyRows").length, 6);
  eq("embedded hero", F.kids("cards")[0].children[1].textContent, "1,098");
  eq("only Q2 2026 available", F.kids("quarterSel").length, 1);
  ok("chip explains the fallback", F.txt("srcMeta").includes("fell back after"), F.txt("srcMeta"));
  ok("no prior quarter → delta says so",
    F.kids("cards")[0].children[2].textContent.includes("No Q1 2026 data to compare"),
    F.kids("cards")[0].children[2].textContent);
  const canadaRow = F.kids("bodyRows").find(tr => tr.children[0].textContent === "Canada");
  ok("Canada (national LinkedIn account) has no events, by design", A.cell(canadaRow, 1) === "N/A");
}

console.log(`\n${failures ? "FAILED: " + failures + " check(s)" : "ALL CHECKS PASSED"}`);
process.exit(failures ? 1 : 0);
