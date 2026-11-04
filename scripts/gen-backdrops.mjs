#!/usr/bin/env node
// Generate the parallax backdrop art for the outdoor worlds with Muse Image (docs/specs/parallax-backdrops-spec.md, docs/specs/environment-spec.md: a day and a night far band and a mid
// strip for each world). Raw outputs are the ART OF RECORD: the service takes no seed, so a picture cannot be regenerated, only replaced. They are written to
// docs/mockups/generated-backdrops/worlds/<id>.webp with the verbatim prompt in manifest.json, and a job whose file already exists is SKIPPED (a second run never spends again). `scripts/make-backdrops.py`
// then bakes them into the game's own assets (runtime/assets/).
//
//   node scripts/gen-backdrops.mjs --list                  the jobs and which exist
//   node scripts/gen-backdrops.mjs sky-far-day beach-mid    only these (each is ONE paid call, 8 to 15 s)
//   node scripts/gen-backdrops.mjs --all                    every job that does not exist yet
//   node scripts/gen-backdrops.mjs --force sky-far-day      replace one (a new call)
//
// The key and base URL come from .dev.vars (never printed). `size` only sets the ASPECT (8:1 gives 4480 x 560); there is no transparency, so a mid strip is painted on pure black and keyed out by make-backdrops.py.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "docs", "mockups", "generated-backdrops", "worlds");
const MANIFEST = path.join(DIR, "manifest.json");

const STYLE = "Smooth flat illustration, soft clay toy style for a children's game, no text.";
const FAR = (what) => `A wide panoramic ${what}. ${STYLE} Level horizon, nothing in the middle of the picture, the same soft look from left to right.`;
const MID = (what) => `A wide horizontal strip of ${what}, soft clay toy style, centered with empty space above, on a PURE SOLID BLACK background (#000000), nothing else, no ground line, no sky, no text.`;

/** id -> prompt. Eight to one bands (4096x512 requested; the service answers 4480x560). */
export const JOBS = {
  "sky-far-day": FAR("daytime sky for a children's game: a bright blue sky fading to pale cream at the horizon, a warm sun, big soft fluffy white and pale pink clouds stacked in layers along the bottom like a cloud meadow, a few tiny distant floating islands, hazy and light"),
  "sky-far-night": FAR("night sky for a children's game: a deep indigo sky with many twinkling stars and a glowing full moon, soft layered clouds in blue and lavender along the bottom like a cloud meadow, a few tiny distant floating islands with warm glowing windows"),
  "sky-mid": MID("soft puffy rounded clouds in white and pale pink with two tiny floating grassy islands with small round trees"),
  "beach-far-day": FAR("daytime beach landscape for a children's game: a bright turquoise sea meeting a light blue sky at a level horizon, a warm sun, a few fluffy white clouds, tiny distant sailboats, soft sandy dunes with palm tree silhouettes along the bottom, hazy and light"),
  "beach-far-night": FAR("night beach landscape for a children's game: a deep blue starry sky with a glowing full moon, a dark calm sea with the moon's reflection at a level horizon, tiny distant sailboats with warm lit windows, soft dunes with palm tree silhouettes along the bottom in navy and indigo"),
  "beach-mid": MID("cute rounded sand dunes in warm cream and gold with small round cartoon palm trees, a tiny striped beach hut and a few round rocks"),
  "snow-far-day": FAR("daytime snowy mountain landscape for a children's game: a clear light blue sky with a bright sun and a few thin white clouds, layered soft snow-covered mountains in white and pale blue with tiny pine trees along the bottom, hazy and light"),
  "snow-far-night": FAR("night snowy mountain landscape for a children's game: a deep blue-purple sky full of stars with a glowing full moon and soft green and pink northern lights ribbons, layered snow-covered mountains in icy blue and indigo with tiny pine trees along the bottom"),
  "snow-mid": MID("rounded snowy hills in white and icy blue with small round snow-covered pine trees and one tiny cozy igloo"),
  "junk-far-day": FAR("daytime scrapyard skyline for a children's game: a blue sky with a warm sun and a few fluffy clouds, distant piles of colourful scrap, old tyres and rusty cranes as soft silhouettes in muted grey, purple and orange along the bottom, hazy and light"),
  "junk-far-night": FAR("sunset scrapyard skyline for a children's game: a deep purple and orange sunset sky fading to indigo with the first stars, distant piles of scrap, old tyres and cranes as dark soft silhouettes along the bottom"),
  // The first Junkyard strip (MID(...), "centered") came back as ONE compact cluster 1800 px wide, so the game mirrored it over and over along the horizon. This one asks for the whole width (2026-11-04).
  "junk-mid": `A wide horizontal strip of a long continuous scrapyard skyline that fills the WHOLE width of the picture from the far left edge to the far right edge with no gaps: low rolling heaps of scrap, stacked old tyres, round barrels, wooden crates, two rusty cranes, a tall pile of junk and a little tin shed, spread evenly along the entire strip and all different from each other, in muted orange, teal and purple, soft clay toy style, empty space above, on a PURE SOLID BLACK background (#000000), nothing else, no ground line, no sky, no text.`,
};

const vars = Object.fromEntries(readFileSync(path.join(ROOT, ".dev.vars"), "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]));
const key = vars.MODEL_API_KEY || vars.META_MODEL_API_KEY;
const base = (vars.META_MODEL_API_URL || "").replace(/\/+$/, "");

const readManifest = () => { try { return JSON.parse(readFileSync(MANIFEST, "utf8")); } catch { return {}; } };
const fileFor = (id, ext = "webp") => path.join(DIR, `${id}.${ext}`);
const have = (id) => existsSync(fileFor(id)) || existsSync(fileFor(id, "png"));

async function generate(id) {
  const prompt = JOBS[id];
  const t0 = Date.now();
  const res = await fetch(`${base}/images/generations`, {
    method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "muse-image-1.0", prompt, n: 1, size: "4096x512", response_format: "b64_json" }), signal: AbortSignal.timeout(150_000),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  if (res.status !== 200 || !json?.data?.[0]?.b64_json) throw new Error(`${id}: HTTP ${res.status} ${text.slice(0, 200)}`);
  const bytes = Buffer.from(json.data[0].b64_json, "base64");
  mkdirSync(DIR, { recursive: true });
  const ext = json.output_format === "png" ? "png" : "webp";
  writeFileSync(fileFor(id, ext), bytes);
  const m = readManifest();
  m[id] = { prompt, requested: "4096x512", file: `${id}.${ext}`, bytes: bytes.length, ms: Date.now() - t0, usage: json.usage ?? null, at: new Date().toISOString() };
  writeFileSync(MANIFEST, JSON.stringify(m, null, 1) + "\n");
  return `${id}: ${Date.now() - t0} ms, ${bytes.length} bytes`;
}

const args = process.argv.slice(2);
if (args.includes("--list") || !args.length) {
  for (const id of Object.keys(JOBS)) console.log(`${have(id) ? "have   " : "missing"}  ${id}`);
  process.exit(0);
}
if (!key || !base) { console.error("no key or META_MODEL_API_URL in .dev.vars"); process.exit(2); }
const force = args.includes("--force");
const ids = args.includes("--all") ? Object.keys(JOBS) : args.filter((a) => !a.startsWith("--"));
for (const id of ids) if (!JOBS[id]) { console.error(`unknown job ${id}`); process.exit(2); }
let spent = 0;
for (const id of ids) {
  if (have(id) && !force) { console.log(`skip    ${id} (exists)`); continue; }
  try { console.log("made   ", await generate(id)); spent++; } catch (e) { console.log("FAILED ", String(e.message ?? e)); }
}
console.log(`${spent} image call${spent === 1 ? "" : "s"} made`);
