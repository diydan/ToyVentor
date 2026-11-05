#!/usr/bin/env tsx
// Can our own Glimmer do the OTHER text jobs the hosted Spark does today? Create mode (a level recipe), Describe & Build (pick a ready build) and the generated worlds'
// look (a WorldBrief), each sent through the REAL Worker code path (handleMuseSpark, handleDescribe, briefPrompt + parseBrief) with the text backend switched per run.
// Nothing is built and nothing is ordered; the only cost is the text model. Adult-written dev wishes only.
//
//   npx tsx scripts/probe-text-routes.ts spark      # the hosted model (a developer tool, never a child path)
//   npx tsx scripts/probe-text-routes.ts glimmer    # our own Glimmer on Modal (SELF_TEXT_* from .dev.vars)
//   options: --repeat 2
//
// Results: .local/eval/text-routes-<backend>-<date>.json. For Create the check is the one the game applies (client crClean) restated from the prompt's own rules: only listed
// prop types and part keys, a theme from the list, five spots with different parts, x between 4 and 42 and 4 apart, at most 16 props. For Describe: did it pick a ready build
// (or ask a question) and do the two models pick the same one. For worlds: parseBrief's verdict. Hosted outputs here are for judging only, never for training (terms 10.1).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { askText, resolveBackend } from "../worker/modelBackend";
import { handleMuseSpark, SAFETY, firstJsonObject, scrubContactDetails, kidSafeText } from "../worker/muse";
import { handleDescribe } from "../worker/describe";
import { briefPrompt, parseBrief, BASES, type Base } from "../shared/worldBrief";
import { HKIND, PART, PROPS } from "../src/features/game/world/runtime/catalog";
import { SPOT_COUNT, THEME_IDS } from "../src/features/game/world/runtime/levelKit";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env: Record<string, string> = {};
const file = path.join(root, ".dev.vars");
if (fs.existsSync(file)) for (const line of fs.readFileSync(file, "utf8").split("\n")) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line); if (m && m[2]) env[m[1]!] = m[2].replace(/^['"]|['"]$/g, ""); }
for (const k of Object.keys(process.env)) if (/^(MODEL_API_KEY|META_MODEL_API_KEY|META_MODEL_API_URL|MUSE_SPARK_MODEL|MODEL_BACKEND|TEXT_BACKEND|SELF_TEXT_[A-Z]+)$/.test(k)) env[k] = process.env[k]!;
const which = process.argv[2];
if (which !== "spark" && which !== "glimmer") { console.log("usage: probe-text-routes.ts spark|glimmer [--repeat N]"); process.exit(1); }
if (which === "glimmer") {
  env.TEXT_BACKEND = "self";
  env.SELF_TEXT_URL ||= "https://diydan82--toyventor-glimmer.us-east.modal.run/v1";
  env.SELF_TEXT_MODEL ||= "muse-glimmer-30B";
  env.SELF_TEXT_API ||= "chat";
} else env.TEXT_BACKEND = "hosted";
const repeat = Number(process.argv.includes("--repeat") ? process.argv[process.argv.indexOf("--repeat") + 1] : 1) || 1;

let ipN = 0;
const post = (url: string, body: unknown) => new Request(`https://probe.local${url}`, { method: "POST", headers: { "content-type": "application/json", "CF-Connecting-IP": `10.7.${Math.floor(ipN / 250)}.${(ipN++ % 250) + 1}` }, body: JSON.stringify(body) });

// ---- Create: the game's own instruction (src/features/game/world/runtime/world.ts CR_INSTR), rebuilt from the same tables ----
const crInstr = (R: unknown, said: string) => {
  const props = Object.keys(PROPS).map((k) => `${k} (${PROPS[k]!.n})`).join(", ");
  const hides = HKIND.map((h) => `${h[1]}: ${h[3].join(", ")}`).join("; ");
  const parts = Object.keys(PART).filter((k) => PART[k]!.st !== "none").join(", ");
  return "You help a young child build a world in the ToyVentor game by turning their words into a level recipe. Reply with JSON only, no other text: {\"say\": a short, warm sentence for a child (at most 20 words) saying what you changed, \"recipe\": the full updated recipe}.\nRecipe format: {\"format\":\"toyventor.level/1\",\"id\":\"kid-world\",\"name\":short world name,\"theme\":one of garden, sky, junk, beach, snow, room,\"props\":[{\"type\":prop type,\"x\":number}],\"spots\":[{\"part\":part key,\"hide\":hiding spot,\"x\":number}]}.\nThe path runs from x 0 to x 45. Prop types: " + props + ".\nHiding spots by kind: " + hides + ". A junk machine is unscrewed; the others are revealed with moves.\nPart keys: " + parts + ".\nRules: use only the listed types and keys; keep spots between x 4 and 42 and at least 4 apart; use exactly " + SPOT_COUNT + " spots with different parts when you add or change hiding spots (if the child did not ask about hiding spots, keep the current spots exactly as they are); put one junk machine before x 10; use at most 16 props; keep everything the child did not ask to change; if the request is unclear or not about the world, keep the recipe and say so kindly.\nCurrent recipe: " + JSON.stringify(R) + "\nThe child said: \"" + String(said).slice(0, 160).replace(/"/g, "'") + "\"";
};
const hideNames = new Set(HKIND.flatMap((h) => h[3]));
const START = { format: "toyventor.level/1", id: "kid-world", name: "My world", theme: "garden", props: [{ type: Object.keys(PROPS)[0]!, x: 12 }, { type: Object.keys(PROPS)[1]!, x: 30 }], spots: [] };
function crCheck(r: any, askedSpots: boolean): string[] {
  const bad: string[] = [];
  if (!r || typeof r !== "object") return ["no recipe"];
  if (!(THEME_IDS as readonly string[]).includes(r.theme)) bad.push(`theme ${r.theme}`);
  const props = Array.isArray(r.props) ? r.props : [];
  const spots = Array.isArray(r.spots) ? r.spots : [];
  for (const p of props) if (!PROPS[p.type]) { bad.push(`unknown prop ${p.type}`); break; }
  if (props.length > 16) bad.push(`${props.length} props`);
  if (askedSpots) {
    if (spots.length !== SPOT_COUNT) bad.push(`${spots.length} spots`);
    const parts = spots.map((s: any) => s.part);
    if (new Set(parts).size !== parts.length) bad.push("repeated part");
    for (const s of spots) { if (!PART[s.part]) { bad.push(`unknown part ${s.part}`); break; } }
    for (const s of spots) { if (!hideNames.has(s.hide)) { bad.push(`unknown hide ${s.hide}`); break; } }
    const xs = spots.map((s: any) => s.x).sort((a: number, b: number) => a - b);
    if (xs.some((x: number) => x < 4 || x > 42) || xs.some((x: number, i: number) => i && x - xs[i - 1]! < 4)) bad.push("spot spacing");
  } else if (spots.length !== 0) bad.push("changed spots nobody asked about");
  return bad;
}
const CREATE: Array<{ said: string; spots: boolean }> = [
  { said: "a garden with lots of lanterns and a pond", spots: false },
  { said: "make it a snowy world with trees", spots: false },
  { said: "add a windmill near the end", spots: false },
  { said: "a beach with a sandcastle", spots: false },
  { said: "a junkyard with old robots", spots: false },
  { said: "hide five things for me to find, some in the bushes", spots: true },
  { said: "make a sky world and hide parts on islands and branches", spots: true },
  { said: "a cozy toy room", spots: false },
  { said: "I want a dragon that breathes fire", spots: false }, // not about the world: it should keep the recipe and say so
  { said: "put a tall tower in the middle and hide something at the top", spots: true },
];

// ---- Describe: easy and awkward ways to ask for a ready build ----
const DESCRIBE = ["a police car", "a fire truck", "a school bus", "a tractor", "a robot that walks", "a car for racing", "un coche rojo", "ein Bagger", "something that flies", "a thing that digs", "a dinosaur", "a boat"];

// ---- Worlds: what the generated-worlds look asks for ----
const WORLDS: Array<{ wish: string; base: Base }> = [
  { wish: "a candy forest with sprinkles", base: "garden" }, { wish: "an underwater coral reef", base: "beach" }, { wish: "a haunted spooky night", base: "garden" },
  { wish: "a volcano island", base: "beach" }, { wish: "a cotton candy sky", base: "sky" }, { wish: "a snowy mountain village", base: "snow" },
  { wish: "a rusty robot graveyard", base: "junk" }, { wish: "a cozy bedroom with stars", base: "room" },
];

interface Row { route: string; item: string; ok: boolean; seconds: number; note?: string; pick?: string; bad?: string[] }
const rows: Row[] = [];
const log = (r: Row) => { rows.push(r); console.log(`  ${r.ok ? "ok    " : "FAILED"} ${r.route.padEnd(8)} ${r.seconds.toFixed(1).padStart(5)} s  ${r.item.slice(0, 46).padEnd(46)} ${r.pick ? `-> ${r.pick}` : ""}${r.bad?.length ? ` [${r.bad.join("; ")}]` : ""}${r.note && !r.ok ? ` (${r.note})` : ""}`); };

async function main() {
  const backend = resolveBackend(env, "text");
  console.log(`backend: ${which} (mode ${backend.mode}), create ${CREATE.length}, describe ${DESCRIBE.length}, worlds ${WORLDS.length}, x ${repeat}`);
  if (backend.mode === "off") process.exit(1);
  for (let rep = 0; rep < repeat; rep++) {
    for (const c of CREATE) {
      const t0 = Date.now();
      const res = await handleMuseSpark(post("/api/muse/spark", { model: "muse-spark", input: crInstr(START, c.said), format: "json" }), env as never);
      const seconds = (Date.now() - t0) / 1000;
      const j: any = await res.json().catch(() => ({}));
      if (!res.ok || !j.recipe) { log({ route: "create", item: c.said, ok: false, seconds, note: j.error ?? `http ${res.status}` }); continue; }
      const bad = crCheck(j.recipe, c.spots);
      log({ route: "create", item: c.said, ok: bad.length === 0, seconds, bad });
    }
    for (const d of DESCRIBE) {
      const t0 = Date.now();
      const res = await handleDescribe(post("/api/describe", { description: d }), env as never);
      const seconds = (Date.now() - t0) / 1000;
      const j: any = await res.json().catch(() => ({}));
      if (!res.ok) { log({ route: "describe", item: d, ok: false, seconds, note: j.error ?? `http ${res.status}` }); continue; }
      log({ route: "describe", item: d, ok: true, seconds, pick: j.title ?? (j.clarifyingQuestion ? "(asked a question)" : "?") });
    }
    for (const w of WORLDS) {
      const t0 = Date.now();
      const prompt = briefPrompt(w.wish, w.base);
      const childSaid = (/The child said: "([^"]*)"/.exec(prompt)?.[1] ?? "").toLowerCase().replace(/\s+/g, " ").trim();
      const asked = await askText(backend, `${SAFETY}\n\n${scrubContactDetails(prompt)}`, { timeoutMs: 45_000 });
      const seconds = (Date.now() - t0) / 1000;
      if (!asked.ok) { log({ route: "world", item: `${w.wish} (${w.base})`, ok: false, seconds, note: `model ${asked.status}` }); continue; }
      const raw = firstJsonObject(asked.text);
      if (!raw || typeof raw !== "object") { log({ route: "world", item: `${w.wish} (${w.base})`, ok: false, seconds, note: "unparseable" }); continue; }
      const r = parseBrief(raw, { base: w.base, safe: (s) => kidSafeText(s, childSaid) });
      log({ route: "world", item: `${w.wish} (${w.base})`, ok: r.ok, seconds, ...(r.ok ? { pick: `"${(r.brief as { name?: string }).name ?? ""}"` } : { note: r.reason }) });
    }
  }
  const q = (xs: number[], p: number) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]!; };
  console.log(`\n=== ${which} ===`);
  for (const route of ["create", "describe", "world"]) {
    const x = rows.filter((r) => r.route === route), ok = x.filter((r) => r.ok), secs = ok.map((r) => r.seconds);
    const why: Record<string, number> = {};
    for (const r of x.filter((r) => !r.ok)) for (const b of (r.bad?.length ? r.bad : [r.note ?? "?"])) why[b.replace(/ [A-Za-z0-9_]+$/, "")] = (why[b.replace(/ [A-Za-z0-9_]+$/, "")] ?? 0) + 1;
    console.log(`${route.padEnd(8)} ${ok.length}/${x.length} ok, median ${q(secs, 0.5).toFixed(1)} s, p95 ${q(secs, 0.95).toFixed(1)} s${Object.keys(why).length ? `, problems ${JSON.stringify(why)}` : ""}`);
  }
  const out = path.join(root, ".local/eval");
  fs.mkdirSync(out, { recursive: true });
  const f = path.join(out, `text-routes-${which}-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(f, JSON.stringify({ which, at: new Date().toISOString(), repeat, rows }, null, 1));
  console.log(`saved ${path.relative(root, f)}`);
}
main().catch((e) => { console.error(`error: ${(e as Error).message}`); process.exit(1); });
