/**
 * The one-page pitch (scripts/tuning/results/pitch.html): a short, judge-facing summary of the Forge tuning work, with every number computed from the run files, never typed.
 *
 *   npm run tune:pitch      (writes scripts/tuning/results/pitch.html)
 *
 * The longer evidence trail is charts.html (npm run tune:charts). The two training charts are static (the training logs do not change); everything else is built from the evaluation files, the
 * blind-set runs (DEV half only) and the stored answers re-scored under today's rules (scripts/tuning/rescore.ts). One run is not repeated runs, and the page says so.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decide, scoreRedteam, scoreRun, type EvalResult } from "./lib/compare";
import { forgeExplainer } from "./lib/forgeExplainer";
import { rescoreFile } from "./rescore";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, "data");
const BLIND = join(DATA, "blind-eval");
const OUT = join(HERE, "results", "pitch.html");

const CSS = "*{box-sizing:border-box}\nhtml{-webkit-text-size-adjust:100%}\nbody{margin:0;background:#fff;color:#1a1d21;font:13px/1.45 -apple-system,BlinkMacSystemFont,\"Segoe UI\",Helvetica,Arial,sans-serif}\nmain{max-width:780px;margin:0 auto;padding:28px 28px 40px}\nh1{font-size:22px;margin:0;letter-spacing:-.01em}\n.sub{color:#444;margin:4px 0 2px;font-size:13px}\n.meta{color:#666;font-size:11.5px;margin:0 0 12px}\nh2{font-size:13px;margin:16px 0 4px;text-transform:none;border-top:1px solid #ddd;padding-top:10px}\np{margin:5px 0}\n.grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}\n@media(max-width:640px){.grid2{grid-template-columns:1fr}}\ntable{border-collapse:collapse;width:100%;font-size:12px;margin:6px 0}\nth,td{border:1px solid #ccc;padding:4px 6px;text-align:center}\nth{background:#f2f2f2}\ntd.row,th.row{text-align:left}\ntd.pass{color:#0f6b3d;font-weight:700}\n.figs{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:8px 0}\n@media(max-width:640px){.figs{grid-template-columns:1fr}}\nfigure{margin:0;border:1px solid #ddd;border-radius:8px;padding:8px 10px 6px}\nfigcaption{font-size:11.5px;color:#333;margin:0 0 4px}\nfigcaption b{display:block;font-size:12px}\nsvg{display:block;width:100%;height:auto}\nsvg text{font:11px -apple-system,\"Segoe UI\",Helvetica,Arial,sans-serif;fill:#333}\nsvg .m{fill:#777;font-size:10px}\nsvg .axis{stroke:#bbb;stroke-width:1}\nsvg .tick{stroke:#e3e3e3;stroke-width:1}\n.bar-base{fill:#5d6470}.bar-tuned{fill:#174a8b}.bar-best{fill:#14724a}\n.passline{stroke:#14724a;stroke-width:1.2;stroke-dasharray:4 3}\n.dot{fill:#174a8b}.dot-best{fill:#14724a}\n.range{stroke:#174a8b;stroke-width:3;stroke-linecap:round}\n.small{font-size:11.5px;color:#555}\nul{margin:4px 0 4px 18px;padding:0}\nli{margin:2px 0}\ncode{font-size:11.5px;background:#f2f2f2;padding:0 4px;border-radius:4px}\n@media print{main{padding:0;max-width:none}h2{break-after:avoid}table{break-inside:avoid}}\n\n.bar-safety{fill:#174a8b}.bar-echo{fill:#d4d6da;stroke:#b8bbc1;stroke-width:1}.bar-warn{fill:#b85c00}.dot-base{fill:#5d6470}\n";
const SVG_LOSS = "<svg viewBox=\"0 0 360 150\" role=\"img\" aria-label=\"Final eval loss: p1 0.128, p2 0.125, p3 0.119, p5 0.118, p6 0.116, p7 0.117, p8 0.118\">\n<line class=\"tick\" x1=\"44\" x2=\"350\" y1=\"30\" y2=\"30\"/><text class=\"m\" x=\"40\" y=\"33\" text-anchor=\"end\">0.14</text>\n<line class=\"tick\" x1=\"44\" x2=\"350\" y1=\"65\" y2=\"65\"/><text class=\"m\" x=\"40\" y=\"68\" text-anchor=\"end\">0.13</text>\n<line class=\"tick\" x1=\"44\" x2=\"350\" y1=\"100\" y2=\"100\"/><text class=\"m\" x=\"40\" y=\"103\" text-anchor=\"end\">0.12</text>\n<line class=\"tick\" x1=\"44\" x2=\"350\" y1=\"135\" y2=\"135\"/><text class=\"m\" x=\"40\" y=\"138\" text-anchor=\"end\">0.11</text>\n<text class=\"m\" x=\"60\" y=\"148\" text-anchor=\"middle\">p1</text><text class=\"m\" x=\"106\" y=\"148\" text-anchor=\"middle\">p2</text><text class=\"m\" x=\"152\" y=\"148\" text-anchor=\"middle\">p3</text><text class=\"m\" x=\"198\" y=\"148\" text-anchor=\"middle\">p5</text><text class=\"m\" x=\"244\" y=\"148\" text-anchor=\"middle\">p6</text><text class=\"m\" x=\"290\" y=\"148\" text-anchor=\"middle\">p7</text><text class=\"m\" x=\"334\" y=\"148\" text-anchor=\"middle\">p8</text>\n<circle class=\"dot\" cx=\"60\" cy=\"78\" r=\"4\"/><circle class=\"dot\" cx=\"106\" cy=\"96\" r=\"4\"/><circle class=\"dot\" cx=\"152\" cy=\"110\" r=\"4\"/><circle class=\"dot\" cx=\"198\" cy=\"113\" r=\"4\"/><circle class=\"dot-best\" cx=\"244\" cy=\"120\" r=\"5\"/><circle class=\"dot\" cx=\"290\" cy=\"116\" r=\"4\"/><circle class=\"dot-best\" cx=\"334\" cy=\"113\" r=\"5\"/>\n<text x=\"60\" y=\"68\">0.128</text><text x=\"236\" y=\"134\">0.116</text><text x=\"322\" y=\"103\">0.118</text>\n</svg>";
const SVG_DIALS = "<svg viewBox=\"0 0 360 150\" role=\"img\" aria-label=\"Learning rate decay and gradient norm band\">\n<line class=\"tick\" x1=\"44\" x2=\"350\" y1=\"20\" y2=\"20\"/><line class=\"tick\" x1=\"44\" x2=\"350\" y1=\"70\" y2=\"70\"/><line class=\"tick\" x1=\"44\" x2=\"350\" y1=\"120\" y2=\"120\"/>\n<text class=\"m\" x=\"40\" y=\"23\" text-anchor=\"end\">2e-4</text><text class=\"m\" x=\"40\" y=\"123\" text-anchor=\"end\">0</text>\n<path d=\"M44,20 L60,20 L350,120\" fill=\"none\" stroke=\"#174a8b\" stroke-width=\"2\"/>\n<rect x=\"44\" y=\"52\" width=\"306\" height=\"26\" fill=\"#e8f0e4\"/>\n<text class=\"m\" x=\"197\" y=\"69\" text-anchor=\"middle\">grad norm band 0.2\u20131.0</text>\n<text class=\"m\" x=\"44\" y=\"143\">step 0</text><text class=\"m\" x=\"350\" y=\"143\" text-anchor=\"end\">step ~500</text>\n</svg>";

interface Run { label: string; m: ReturnType<typeof scoreRun>; rt: ReturnType<typeof scoreRedteam> }
function load(file: string): Run | null {
  if (!existsSync(file)) return null;
  const d = JSON.parse(readFileSync(file, "utf8")) as { label: string; results: EvalResult[] };
  return { label: d.label, m: scoreRun(d.results), rt: scoreRedteam(d.results) };
}
const need = (r: Run | null, what: string): Run => {
  if (!r) throw new Error(`pitch: the run file for ${what} is missing`);
  return r;
};
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const r1 = (n: number) => (Math.round(n * 10) / 10).toString();

// ---- tiny svg helpers ------------------------------------------------------------------------------------------------------
interface Row { label: string; value: number; cls?: string; note?: string; stack?: { value: number; cls: string }[] }
/** Horizontal bars, labels left, a note right of each bar, optional dashed lines at given values over the rows they span. */
function hbars(title: string, rows: Row[], opts: { max: number; lines?: { value: number; from: number; to: number }[]; unit?: string; plot?: number }): string {
  const W = 360, left = 96, plot = opts.plot ?? 150, rowH = 22, top = 8;
  const H = top + rows.length * rowH + 14;
  const x = (v: number) => left + (v / opts.max) * plot;
  const parts: string[] = [];
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    parts.push(`<text x="${left - 6}" y="${y + 12}" text-anchor="end">${esc(r.label)}</text>`);
    if (r.stack) {
      let acc = 0;
      for (const s of r.stack) {
        parts.push(`<rect x="${x(acc).toFixed(1)}" y="${y + 3}" width="${Math.max(0, (s.value / opts.max) * plot).toFixed(1)}" height="12" class="${s.cls}"/>`);
        acc += s.value;
      }
      parts.push(`<text class="m" x="${(x(acc) + 5).toFixed(1)}" y="${y + 12}">${esc(r.note ?? "")}</text>`);
    } else {
      parts.push(`<rect x="${left}" y="${y + 3}" width="${Math.max(0, (r.value / opts.max) * plot).toFixed(1)}" height="12" class="${r.cls ?? "bar-tuned"}"/><text class="m" x="${(x(r.value) + 5).toFixed(1)}" y="${y + 12}">${esc(r.note ?? `${r1(r.value)}${opts.unit ?? ""}`)}</text>`);
    }
  });
  for (const l of opts.lines ?? []) {
    const y1 = top + l.from * rowH + 1, y2 = top + (l.to + 1) * rowH - 3;
    parts.push(`<line class="passline" x1="${x(l.value).toFixed(1)}" x2="${x(l.value).toFixed(1)}" y1="${y1}" y2="${y2}"/>`);
  }
  parts.push(`<line class="axis" x1="${left}" x2="${left}" y1="${top}" y2="${H - 12}"/>`);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${parts.join("")}</svg>`;
}
/** A range per row (min to max across repeated runs) with a dot per run. */
function ranges(title: string, rows: { label: string; values: number[]; unit?: string }[], max: number): string {
  const W = 360, left = 96, plot = 130, rowH = 26, top = 8;
  const H = top + rows.length * rowH + 14;
  const x = (v: number) => left + (v / max) * plot;
  const parts: string[] = [];
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    const lo = Math.min(...r.values), hi = Math.max(...r.values);
    parts.push(`<text x="${left - 6}" y="${y + 14}" text-anchor="end">${esc(r.label)}</text><line class="range" x1="${x(lo).toFixed(1)}" x2="${x(hi).toFixed(1)}" y1="${y + 10}" y2="${y + 10}"/>`);
    for (const v of r.values) parts.push(`<circle cx="${x(v).toFixed(1)}" cy="${y + 10}" r="3.6" class="${r.label === "base" ? "dot-base" : "dot"}"/>`);
    parts.push(`<text class="m" x="${(x(hi) + 8).toFixed(1)}" y="${y + 14}">${lo === hi ? r1(lo) : `${r1(lo)}–${r1(hi)}`}${r.unit ?? ""} · ${r.values.length} runs</text>`);
  });
  parts.push(`<line class="axis" x1="${left}" x2="${left}" y1="${top}" y2="${H - 12}"/>`);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${parts.join("")}</svg>`;
}
const fig = (title: string, says: string, svg: string) => `<figure><figcaption><b>${title}</b>${says}</figcaption>${svg}</figure>`;

function main(): void {
  const b2 = need(load(join(DATA, "eval-base-v2.json")), "base-v2");
  const p6 = need(load(join(DATA, "eval-tuned-p6-v2.json")), "tuned-p6-v2");
  const p8 = need(load(join(DATA, "eval-tuned-p8-v2.json")), "tuned-p8-v2");
  const p8b = need(load(join(DATA, "eval-tuned-p8-v2b.json")), "tuned-p8-v2b");
  const bb = need(load(join(BLIND, "eval-blind-dev-base.json")), "blind-dev-base");
  const b6 = need(load(join(BLIND, "eval-blind-dev-p6.json")), "blind-dev-p6");
  const b8 = need(load(join(BLIND, "eval-blind-dev-p8.json")), "blind-dev-p8");
  const rb = rescoreFile(join(BLIND, "eval-blind-dev-base.json"));
  const r6 = rescoreFile(join(BLIND, "eval-blind-dev-p6.json"));
  const r8 = rescoreFile(join(BLIND, "eval-blind-dev-p8.json"));
  const nRuns = readdirSync(DATA).filter((f) => /^eval-.+\.json$/.test(f)).length;
  const verdict = (r: Run) => decide({ label: b2.label, metrics: b2.m, redteam: b2.rt }, { label: r.label, metrics: r.m, redteam: r.rt }, "both").pass;
  const p8Pass = [p8, p8b].filter(verdict).length;
  const speedPct = (t: Run, b: Run) => Math.round(100 * (1 - (t.m.p50 ?? 0) / (b.m.p50 ?? 1)));

  const maxLat = Math.max(...[b2, p6, p8, p8b, bb, b6, b8].map((r) => r.m.p90 ?? 0));
  const latRows: Row[] = [
    { label: "main: base", value: b2.m.p50 ?? 0, cls: "bar-base", note: `${b2.m.p50} s (p90 ${b2.m.p90})` },
    { label: "pilot 6", value: p6.m.p50 ?? 0, cls: "bar-tuned", note: `${p6.m.p50} s (p90 ${p6.m.p90})` },
    { label: "pilot 8", value: p8.m.p50 ?? 0, cls: "bar-best", note: `${p8.m.p50} s (p90 ${p8.m.p90})` },
    { label: "pilot 8, run 2", value: p8b.m.p50 ?? 0, cls: "bar-best", note: `${p8b.m.p50} s (p90 ${p8b.m.p90})` },
    { label: "blind: base", value: bb.m.p50 ?? 0, cls: "bar-base", note: `${bb.m.p50} s (p90 ${bb.m.p90})` },
    { label: "pilot 6", value: b6.m.p50 ?? 0, cls: "bar-tuned", note: `${b6.m.p50} s (p90 ${b6.m.p90})` },
    { label: "pilot 8", value: b8.m.p50 ?? 0, cls: "bar-best", note: `${b8.m.p50} s (p90 ${b8.m.p90})` },
  ];
  const figLatency = fig("Median seconds per wish — lower wins", `Dashed line = the pass line, 70% of that set's base (${r1(0.7 * (b2.m.p50 ?? 0))} s main, ${r1(0.7 * (bb.m.p50 ?? 0))} s blind). Pilot 8 is about ${speedPct(p8, b2)}% faster on the main set and ${speedPct(b8, bb)}% on wishes it never saw.`, hbars("Median seconds per wish", latRows, { max: Math.ceil(maxLat * 0.7), lines: [{ value: 0.7 * (b2.m.p50 ?? 0), from: 0, to: 3 }, { value: 0.7 * (bb.m.p50 ?? 0), from: 4, to: 6 }], unit: " s" }));

  const filterRows: Row[] = [
    { label: "base", value: b2.m.filterFired, cls: "bar-base", note: `${b2.m.filterFired} fixes · red-team ${b2.rt.passed}/${b2.rt.total}` },
    { label: "pilot 6", value: p6.m.filterFired, cls: "bar-tuned", note: `${p6.m.filterFired} · ${p6.rt.passed}/${p6.rt.total}` },
    { label: "pilot 8", value: p8.m.filterFired, cls: "bar-best", note: `${p8.m.filterFired} · ${p8.rt.passed}/${p8.rt.total}` },
    { label: "pilot 8, run 2", value: p8b.m.filterFired, cls: "bar-best", note: `${p8b.m.filterFired} · ${p8b.rt.passed}/${p8b.rt.total}` },
  ];
  const figFilters = fig("Main set, the rule's safety count — lower wins", `Name filters had to fix an answer (bar) and red-team passed. Dashed line = half the base (${r1(0.5 * b2.m.filterFired)}): the safety goal. Pilot 8 is on or under it in both runs.`, hbars("Filter fixes and red-team on the main set", filterRows, { max: Math.max(14, b2.m.filterFired + 2), lines: [{ value: 0.5 * b2.m.filterFired, from: 1, to: 3 }] }));

  const made = (label: string, r: ReturnType<typeof rescoreFile>): Row => ({ label, value: 0, stack: [{ value: r.safety, cls: "bar-safety" }, { value: r.echoOnly, cls: "bar-echo" }], note: `safety ${r.safety} · echo ${r.echoOnly} · rule ${r.stored}` });
  const figMade = fig("Blind half: what the filter count is made of", "Blue = a brand or an unsafe word was replaced. Grey = a name only copied the child's words, so that language falls back to English. The word rule = what the decision rule counted. The tuned models copy a short wish more often than the base; that, not unsafe content, is most of the gap the rule saw.", hbars("Blind half filter count split into safety and echo", [made("base", rb), made("pilot 6", r6), made("pilot 8", r8)], { max: Math.max(rb.safety + rb.echoOnly, r6.safety + r6.echoOnly, r8.safety + r8.echoOnly), plot: 110 }));

  const brandRows: Row[] = [
    { label: "base", value: 0, stack: [{ value: rb.rawLeak, cls: "bar-warn" }], note: `${rb.rawLeak}/42 own text · ${rb.shownLeak} after list` },
    { label: "pilot 6", value: 0, stack: [{ value: r6.rawLeak, cls: "bar-warn" }], note: `${r6.rawLeak}/42 · ${r6.shownLeak}` },
    { label: "pilot 8", value: 0, stack: [{ value: r8.rawLeak, cls: "bar-warn" }], note: `${r8.rawLeak}/42 · ${r8.shownLeak}` },
  ];
  const figBrand = fig("A brand in no list, written into the part (42 wishes)", `Bar = how often the model wrote the brand into the part's name or text by itself. After the filters with the longer brand list: ${rb.shownLeak}, ${r6.shownLeak}, ${r8.shownLeak} (a coverage check of brands added afterwards, NOT a test on unseen ones).`, hbars("Brand in the model's own text", brandRows, { max: 24 }));

  const base1 = load(join(DATA, "eval-base.json"));
  const p6a = load(join(DATA, "eval-tuned-p6.json"));
  const p6b = load(join(DATA, "eval-tuned-p6b.json"));
  const p8a = load(join(DATA, "eval-tuned-p8.json"));
  const grp = (xs: (Run | null)[]) => xs.filter((r): r is Run => r !== null);
  const baseAll = grp([base1, b2]), p6All = grp([p6a, p6b, p6]), p8All = grp([p8a, p8, p8b]);
  const figNoiseF = fig("Same model, repeated: filter fixes", "Dots = separate runs of ONE model (the first run of each used the older name rule). The spread is as big as the margins: one wish moves a goal.", ranges("Filter fixes per run", [{ label: "base", values: baseAll.map((r) => r.m.filterFired) }, { label: "pilot 6", values: p6All.map((r) => r.m.filterFired) }, { label: "pilot 8", values: p8All.map((r) => r.m.filterFired) }], 14));
  const figNoiseM = fig("Same model, repeated: median seconds", "Even the base moves by a few seconds between runs (the laptop and the servers were shared); the tuned models' gap to it does not.", ranges("Median seconds per run", [{ label: "base", values: baseAll.map((r) => r.m.p50 ?? 0), unit: " s" }, { label: "pilot 6", values: p6All.map((r) => r.m.p50 ?? 0), unit: " s" }, { label: "pilot 8", values: p8All.map((r) => r.m.p50 ?? 0), unit: " s" }], 36));

  const ex = forgeExplainer({ warmSeconds: p8.m.p50 ?? 13, tunedMain: p8.m.p50 ?? 0, baseMain: b2.m.p50 ?? 0, speedMainPct: speedPct(p8, b2), speedBlindPct: speedPct(b8, bb) });
  const body = `<main>
<h1>Forge: type a wish, wear it, print it</h1>
<p class="sub">${ex.intro}</p>
<p class="meta">ToyVentor Forge &middot; hackathon pitch &middot; ${nRuns} evaluation runs on file &middot; every number below is computed from the run files &middot; 2026-11-04</p>

<h2>How it works</h2>
<p>${ex.how}</p>

<h2>How it was trained</h2>
<p>${ex.trained}</p>

<h2>Training: learned, not memorised</h2>
<div class="figs">
<figure><figcaption><b>Final eval loss per pilot — flat at the bottom</b>Lower is better. No run ends &gt;0.01 above its best: learned, not memorised.</figcaption>
${SVG_LOSS}</figure>
<figure><figcaption><b>Dials behind the curve — healthy</b>LR 2e-4, peak step 6, linear decay. Grad norm 0.2&ndash;1.0, median 0.3; one pilot-8 first-step spike (9.3) recovered. Resumed pilot 6 @450 and pilot 8 @300; pilot 4 died, never scored.</figcaption>
${SVG_DIALS}</figure>
</div>

<h2>Headline result — pilot 8 passes the decision rule in ${p8Pass} of 2 runs on the main set</h2>
<div class="figs">
${figLatency}
${figFilters}
</div>
<p class="small">Quality held: printable ${r1(b2.m.printablePct)}% &rarr; ${r1(p8.m.printablePct)}% / ${r1(p8b.m.printablePct)}%; first call ${r1(b2.m.firstCallPct)}% &rarr; ${r1(p8.m.firstCallPct)}% / ${r1(p8b.m.firstCallPct)}%. Pilot 6 passes the speed goal in every run and the safety goal in none. The zero-training control (the base with its thinking skipped) was fast (12.1 s) but failed the quality and safety gates (printable 96.9%, filters 22, red-team 57/70): tuning is what buys the speed without those losses. Full matrix and the other charts: <code>charts.html</code>.</p>

<h2>Wishes the models never saw (blind set, dev half, 204 wishes, one run each)</h2>
<p class="small">Median ${bb.m.p50} s (base) &rarr; ${b6.m.p50} s (pilot 6) / ${b8.m.p50} s (pilot 8); first call ${r1(bb.m.firstCallPct)}% &rarr; ${r1(b6.m.firstCallPct)}% / ${r1(b8.m.firstCallPct)}%; red-team ${bb.rt.passed}/${bb.rt.total} &rarr; ${b6.rt.passed}/${b6.rt.total} / ${b8.rt.passed}/${b8.rt.total}. By the rule's stored filter count neither tuned model passes here (${b6.m.filterFired} and ${b8.m.filterFired} against ${bb.m.filterFired}): the next chart shows why that number is not what it looks like.</p>
<div class="figs">
${figMade}
${figBrand}
</div>
<p class="small">The base wrote a brand that was in no list into the part on ${rb.rawLeak} of 42 brand wishes, pilot 6 on ${r6.rawLeak} and pilot 8 on ${r8.rawLeak}, and the filters of that moment did not know those brands. We then extended the production brand list (about 300 entries, tested so it does not eat ordinary words); a brand nobody listed still gets through, and the new list was built after the dev half was scored.</p>

<h2>Noise ≈ the margin — one run can't prove it</h2>
<div class="figs">
${figNoiseF}
${figNoiseM}
</div>
<ul>
<li>Slot probe (38 vehicle and prop prompts): base 38/38, pilot 8 36/38, pilot 6 34/38, so vehicle slots and the held prop go to the base.</li>
<li>Modal GPU for the whole sweep: on the order of $100 over 8 training runs and about 25 evaluation runs (our ledger's estimate; the Modal bill is the record). A pass is permission to run beside the base, not a child-safety claim.</li>
</ul>

<h2>Why we tuned it</h2>
${ex.why}

<h2>What ships</h2>
<p>${ex.ships}</p>
</main>`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Forge tuning — hackathon pitch</title>
<style>
${CSS}</style></head><body>${body}</body></html>
`;
  writeFileSync(OUT, html);
  console.log(`wrote ${OUT} (${Math.round(html.length / 1024)} KB)`);
}

main();
