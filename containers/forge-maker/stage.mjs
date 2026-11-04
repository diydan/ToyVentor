// Stages the files the maker needs into ./context (the Docker build context), from an explicit list.
// Why a staging step: the daemon imports the PartSpec Python modules and reads a few JSON files at runtime (found 2026-11-04 by logging every
// file it opened while it made a crown, a head and a back part). Everything else in the repo (STLs, cards, the 600 MB PartSpec output, node_modules)
// stays out of the image. Run by `wrangler deploy` through the "build" setting in wrangler.jsonc, or by hand: node containers/forge-maker/stage.mjs
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const OUT = join(HERE, "context");

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

let files = 0;
let bytes = 0;
function put(rel) {
  const from = join(ROOT, rel);
  if (!existsSync(from)) throw new Error(`stage: missing ${rel}`);
  const to = join(OUT, rel);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to);
  files += 1;
  bytes += statSync(from).size;
}
/** Files directly inside `rel` whose names match `re` (not subfolders). */
function putTop(rel, re) {
  const found = readdirSync(join(ROOT, rel)).filter((n) => re.test(n) && statSync(join(ROOT, rel, n)).isFile());
  if (!found.length) throw new Error(`stage: nothing matched in ${rel}`);
  for (const n of found) put(`${rel}/${n}`);
}
/** Every file under `rel`, skipping bytecode caches. */
function putTree(rel) {
  for (const n of readdirSync(join(ROOT, rel))) {
    if (n === "__pycache__" || n.endsWith(".pyc") || n === ".DS_Store") continue;
    const p = `${rel}/${n}`;
    if (statSync(join(ROOT, p)).isDirectory()) putTree(p);
    else put(p);
  }
}

for (const rel of [
  "scripts/forge_optimizer_daemon.py",
  "scripts/optimize_assets.py",
  "scripts/stl_to_glb.py",
  "public/kip/kip-partspec-manifest.json", // read by the Kip SDK
]) put(rel);
putTop("parts/kip", /\.(py|json)$/);
putTree("parts/kip/sdk");
putTree("parts/kip/household");
putTop("parts/partspec", /\.(py|json)$/); // the modules the daemon imports, and catalog / interfaces / schema JSON
putTree("parts/partspec/validation");
putTree("parts/partspec/print_profiles");

cpSync(join(HERE, "requirements.txt"), join(OUT, "requirements.txt"));
console.log(`stage: ${files} files, ${(bytes / 1048576).toFixed(1)} MB into ${OUT}`);
