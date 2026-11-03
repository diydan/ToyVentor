// The closed list of what the Carousel scenes say out loud: src/lib/scenePrompts.json, made from the real scene code (see scripts/lib/scene-prompts-enum.ts).
//
//   npx tsx scripts/scene-prompts.ts           # write src/lib/scenePrompts.json
//   npx tsx scripts/scene-prompts.ts --check   # exit 1 when the file is not what the scene code gives (a drift test; no files written)
//   npx tsx scripts/scene-prompts.ts --list    # print every line with the scenes it belongs to (no files written)
//
// Run it after changing any spoken line in runtime/level2Scene.ts, level2Recipes.ts or learnRungs.ts, then commit the JSON. The clips themselves are made on demand
// (the first time a child hears a line) or all at once with `npx tsx scripts/prewarm-voice.ts <base url>`, which includes these lines.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildManifest, enumeratePrompts, serializeManifest } from "./lib/scene-prompts-enum";

const PATH = join(dirname(fileURLToPath(import.meta.url)), "../src/lib/scenePrompts.json");
const mode = process.argv[2] ?? "";
if (mode && mode !== "--check" && mode !== "--list") {
  console.error("usage: scene-prompts.ts [--check | --list]");
  process.exit(2);
}

const lines = enumeratePrompts();
const next = serializeManifest(buildManifest(lines.keys()));

if (mode === "--list") {
  for (const [text, from] of [...lines].sort((a, b) => (a[0] < b[0] ? -1 : 1))) console.log(`${JSON.stringify(text)}  <- ${from.join(", ")}`);
  console.log(`${lines.size} lines`);
} else if (mode === "--check") {
  let current = "";
  try {
    current = readFileSync(PATH, "utf8");
  } catch {
    // missing: reported below
  }
  if (current === next) {
    console.log(`scenePrompts.json is up to date (${lines.size} lines)`);
  } else {
    const had = new Set((JSON.parse(current || '{"prompts":[]}') as { prompts: Array<{ text: string }> }).prompts.map((p) => p.text));
    for (const t of lines.keys()) if (!had.has(t)) console.error(`  missing from the file: ${JSON.stringify(t)}`);
    for (const t of had) if (!lines.has(t)) console.error(`  in the file but no longer said: ${JSON.stringify(t)}`);
    console.error("src/lib/scenePrompts.json is out of date: run `npx tsx scripts/scene-prompts.ts` and commit it");
    process.exit(1);
  }
} else {
  writeFileSync(PATH, next);
  console.log(`wrote ${PATH} (${lines.size} lines)`);
}
