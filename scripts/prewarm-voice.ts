// Warm the edge cache for every "say what it is" clip the game can ask for, so the first tap on any object, in any language, is
// instant instead of a ~2 s generation. Run once after a deploy (clips are immutable, so a re-run is free: all cache hits).
//
//   npx tsx scripts/prewarm-voice.ts https://toyventor.com          # generate/warm everything (calls the TTS model once per new clip)
//   npx tsx scripts/prewarm-voice.ts https://toyventor.com --list   # just print what it would request
//   options: --concurrency 4
//
// The clip set is exactly what the game can say: each built-in prop's own noun + colour, plus a lantern's light in every colour (a
// level may give a lantern any light colour), and each Describe & Build part in the colour the exploded view draws it, in all seven
// languages. About 460 clips; a full cold run is a few minutes.
import { readFileSync } from "node:fs";
import { PROP_SPECS } from "../src/features/game/world/runtime/propReactions";
import { COLOR_KEYS, LANGUAGES, type ColorKey, type NounKey } from "../src/lib/propNames";
import { PART_IDS } from "../src/lib/partNames";
import { voiceUrl } from "../src/lib/propVoice";
// @ts-expect-error viewer JS modules ship without d.ts
import { partColour } from "../parts/kip/viewer/kip-describe-view.js";

const args = process.argv.slice(2);
const base = args.find((a) => /^https?:\/\//.test(a));
const listOnly = args.includes("--list");
const cIdx = args.indexOf("--concurrency");
const concurrency = cIdx >= 0 ? Math.max(1, Number(args[cIdx + 1]) || 4) : 4;

const combos = new Map<string, { noun: NounKey; color: ColorKey }>();
for (const s of Object.values(PROP_SPECS)) if (s.noun) combos.set(`${s.noun}|${s.color}`, { noun: s.noun, color: s.color });
for (const color of COLOR_KEYS) combos.set(`light|${color}`, { noun: "light", color });

const partsData = JSON.parse(readFileSync(new URL("../parts/kip/viewer/kip-describe-parts.json", import.meta.url), "utf8"));
const paths: string[] = [];
for (const l of LANGUAGES) for (const c of combos.values()) paths.push(voiceUrl(c.noun, c.color, l.code));
for (const l of LANGUAGES) for (const id of PART_IDS) paths.push(`/api/voice?lang=${l.code}&p=${id}&hex=${(partColour(partsData, id) as string).slice(1)}`);

console.log(`${paths.length} clips (${combos.size} props + ${PART_IDS.length} parts, x ${LANGUAGES.length} languages)`);
if (listOnly || !base) {
  if (!listOnly) console.log("give a base URL to warm them, e.g. https://toyventor.com (or --list to print the paths)");
  else for (const p of paths) console.log(p);
  process.exit(0);
}

const stats = { hit: 0, miss: 0, failed: 0, bytes: 0 };
const failures: string[] = [];
let next = 0;
async function worker() {
  while (next < paths.length) {
    const p = paths[next++]!;
    try {
      const res = await fetch(new URL(p, base).toString());
      if (!res.ok) { stats.failed++; failures.push(`${res.status} ${p}`); continue; }
      stats.bytes += (await res.arrayBuffer()).byteLength;
      if (res.headers.get("x-voice-cache") === "hit") stats.hit++; else stats.miss++;
    } catch (e) {
      stats.failed++; failures.push(`${(e as Error).message} ${p}`);
    }
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));
console.log(`warmed: ${stats.miss} generated, ${stats.hit} already cached, ${stats.failed} failed, ${(stats.bytes / 1e6).toFixed(1)} MB total`);
for (const f of failures.slice(0, 10)) console.log("  FAILED", f);
process.exit(stats.failed ? 1 : 0);
