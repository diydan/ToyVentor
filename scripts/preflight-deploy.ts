// Deploy preflight: fails loudly on the known placeholder states so
// deploy day is not spent debugging them. Run: npm run preflight
// Local checks only — Cloudflare auth, remote D1 and Worker secrets can
// only be confirmed by Dan's `wrangler login` session; the exact commands
// are printed at the end either way.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildReviewCopy } from "./export-spec";

const root = process.cwd();
let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.error(`preflight FAIL: ${msg}`);
};
const ok = (msg: string) => console.log(`preflight ok: ${msg}`);

// 1. Real D1 database id (all-zero placeholder works locally only).
const wrangler = readFileSync(join(root, "wrangler.jsonc"), "utf8");
const dbId = wrangler.match(/"database_id"\s*:\s*"([^"]*)"/)?.[1];
if (!dbId) fail("wrangler.jsonc has no d1 database_id");
else if (/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(dbId))
  fail("wrangler.jsonc database_id is the all-zero local placeholder — run `npx wrangler d1 create toyventor` and paste the returned id");
else ok(`D1 database_id set (${dbId.slice(0, 8)}…)`);

// 2. Local dev secret present (proves the value exists to upload remotely).
const devVars = join(root, ".dev.vars");
if (!existsSync(devVars)) fail(".dev.vars missing — MODEL_API_KEY has nowhere to be read from");
else if (!/^MODEL_API_KEY=\S+/m.test(readFileSync(devVars, "utf8")))
  fail(".dev.vars has no non-empty MODEL_API_KEY");
else ok(".dev.vars carries MODEL_API_KEY (value not shown)");

// 3. Migrations present for the remote apply step.
if (!existsSync(join(root, "migrations/0001_ownership.sql")))
  fail("migrations/0001_ownership.sql missing");
else ok("ownership migration present");

if (!existsSync(join(root, "migrations/0002_parent_time.sql")))
  fail("migrations/0002_parent_time.sql missing");
else ok("parent time migration present");

// 4. Built client exists or the deploy script will build it.
if (existsSync(join(root, "dist/client/index.html"))) ok("dist/ build present");
else console.log("preflight note: no dist/ yet — `npm run deploy` builds first, this is fine");

// 5. Native stage: no stale iframe bundle, runtime entry exists (Phase 0A).
if (existsSync(join(root, "public/world/ToyVentor-World.html")))
  fail("public/world/ToyVentor-World.html still present: stale iframe bundle must be deleted (Phase 0A)");
else if (existsSync(join(root, "public/world/three")))
  fail("public/world/three still present: stale vendored three must be deleted (Phase 0A)");
else if (!existsSync(join(root, "src/features/game/world/runtime/world.ts")))
  fail("src/features/game/world/runtime/world.ts missing: native runtime entry not found");
else ok("native stage runtime present, no stale iframe bundle (public/world absent)");

// 6. No untracked source files that a clean checkout would lack (the P2-2
// class: sources present here but missing after a fresh clone). Git never
// reports ignored paths, so .gitignore cover stays excluded automatically.
// Without a git repository (zip/CI artifact) the check is skipped, not failed.
try {
  const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    encoding: "utf8",
    stdio: "pipe",
  });
  const srcDirs = [
    "src/", "worker/", "shared/", "tests/", "public/", "scripts/",
    "seed/", "game/", "sets/", "parts/",
  ];
  const stray = status
    .split("\n")
    .filter((line) => line.startsWith("??"))
    .map((line) => line.slice(2).trim())
    .filter((p) => srcDirs.some((d) => p.startsWith(d)));
  if (stray.length > 0)
    fail(`untracked source files a clean checkout would lack: ${stray.join(", ")}`);
  else ok("no untracked source files outside .gitignore cover");
} catch {
  console.log("preflight note: no git repository — untracked-file check skipped");
}

// 7. Every printable part resolves to a real, valid STL and GLB within size
// budgets. Filenames come from set data via the same rule as src/lib/catalog.ts
// (stlFile field, .stl -> .glb); the hand-maintained UI maps are gone, so there
// is nothing left to drift — this checks the catalogue against the payloads.
{
  const MAX_SINGLE_GLB_BYTES = 250 * 1024;
  const MAX_TOTAL_GLB_BYTES = 5 * 1024 * 1024;
  const MAX_SINGLE_STL_BYTES = Math.round(1.6 * 1024 * 1024);
  const MAX_TOTAL_STL_BYTES = 23 * 1024 * 1024;

  const problems: string[] = [];
  const isValidStl = (path: string): boolean => {
    const buf = readFileSync(path);
    if (buf.length === 0) return false;
    const sample = buf.subarray(0, 300).toString("ascii");
    // ASCII STL starts with "solid" plus an early facet line; binary
    // headers may also start with "solid", so the facet decides.
    if (sample.trimStart().startsWith("solid") && sample.includes("facet")) return true;
    if (buf.length < 84) return false;
    const triangles = buf.readUInt32LE(80);
    return buf.length === 84 + triangles * 50;
  };
  const isValidGlb = (path: string): boolean => {
    const buf = readFileSync(path);
    if (buf.length < 28) return false;
    const magic = buf.readUInt32LE(0);
    const version = buf.readUInt32LE(4);
    const totalLength = buf.readUInt32LE(8);
    const jsonLength = buf.readUInt32LE(12);
    const jsonChunkType = buf.readUInt32LE(16);
    return (
      magic === 0x46546c67 &&
      version === 2 &&
      totalLength === buf.length &&
      jsonLength > 0 &&
      20 + jsonLength <= buf.length &&
      jsonChunkType === 0x4e4f534a
    );
  };
  const setFiles = readdirSync(join(root, "sets")).filter((f) => f.endsWith(".json"));
  for (const file of setFiles) {
    const set = JSON.parse(readFileSync(join(root, "sets", file), "utf8")) as {
      parts?: { id: string; printable?: boolean; stlFile?: string; glbFile?: string }[];
    };
    for (const part of set.parts ?? []) {
      if (!part.printable) continue;
      if (!part.stlFile) {
        problems.push(`${file}:${part.id} printable but has no stlFile`);
        continue;
      }
      const stl = join(root, "public/parts-stl", part.stlFile);
      if (!existsSync(stl) || statSync(stl).size === 0)
        problems.push(`${file}:${part.id} missing or empty public/parts-stl/${part.stlFile}`);
      else {
        const stlBytes = statSync(stl).size;
        if (!isValidStl(stl)) problems.push(`${file}:${part.id} invalid STL header in ${part.stlFile}`);
        if (stlBytes > MAX_SINGLE_STL_BYTES)
          problems.push(`${file}:${part.id} ${part.stlFile} exceeds 1.6 MB cap (${(stlBytes / 1024).toFixed(0)} KB)`);
      }
      const glbName = part.glbFile ?? part.stlFile.replace(/\.stl$/i, ".glb");
      const glb = join(root, "public/parts-glb", glbName);
      if (!existsSync(glb) || statSync(glb).size === 0)
        problems.push(`${file}:${part.id} missing or empty public/parts-glb/${glbName}`);
      else {
        const glbBytes = statSync(glb).size;
        if (!isValidGlb(glb)) problems.push(`${file}:${part.id} invalid GLB v2 binary in ${glbName}`);
        if (glbBytes > MAX_SINGLE_GLB_BYTES)
          problems.push(`${file}:${part.id} ${glbName} exceeds 250 KB Web-LOD cap (${(glbBytes / 1024).toFixed(0)} KB)`);
      }
    }
  }

  const totalStlBytes = readdirSync(join(root, "public/parts-stl"))
    .filter((f) => f.endsWith(".stl"))
    .reduce((sum, f) => sum + statSync(join(root, "public/parts-stl", f)).size, 0);
  const totalGlbBytes = readdirSync(join(root, "public/parts-glb"))
    .filter((f) => f.endsWith(".glb"))
    .reduce((sum, f) => sum + statSync(join(root, "public/parts-glb", f)).size, 0);

  if (totalStlBytes > MAX_TOTAL_STL_BYTES)
    problems.push(`public/parts-stl total ${(totalStlBytes / (1024 * 1024)).toFixed(2)} MB exceeds 23.0 MB budget`);
  if (totalGlbBytes > MAX_TOTAL_GLB_BYTES)
    problems.push(`public/parts-glb total ${(totalGlbBytes / (1024 * 1024)).toFixed(2)} MB exceeds 5.0 MB budget`);

  if (problems.length > 0) fail(`print payload gaps: ${problems.join("; ")}`);
  else
    ok(
      `print & web payloads valid (${setFiles.join(", ")}; STL ${(totalStlBytes / (1024 * 1024)).toFixed(2)} MB, GLB ${(totalGlbBytes / (1024 * 1024)).toFixed(2)} MB)`,
    );
}

// 8. The review copy of the spec has not drifted: rebuild it with the date
// already embedded in the existing file and require byte equality. That
// catches body drift without churning the date on every run.
{
  const reviewPath = join(root, "docs/product/spec-for-review.md");
  const specPath = join(root, "docs/product/spec.md");
  if (!existsSync(reviewPath)) fail("docs/product/spec-for-review.md missing");
  else {
    const existing = readFileSync(reviewPath, "utf8");
    const date = existing.match(/generated (\d{4}-\d{2}-\d{2})/)?.[1];
    if (!date) fail("docs/product/spec-for-review.md has no generation date to rebuild with");
    else {
      const rebuilt = buildReviewCopy(readFileSync(specPath, "utf8"), date);
      if (rebuilt === existing) ok("review copy of the spec is current");
      else fail("docs/product/spec-for-review.md drifted from docs/product/spec.md: run `npm run spec:review`");
    }
  }
}

// 9. The service worker cannot serve a stale build: assert the Phase 2
// strategy is still intact as simple concept checks, not brittle regexes.
// (If these ever disagree with the file, fix the check, not the file.)
{
  const sw = readFileSync(join(root, "public/sw.js"), "utf8");
  const swProblems: string[] = [];
  const version = sw.match(/toyventor-v(\d+)/)?.[1];
  if (!version || Number(version) < 2)
    swProblems.push("cache version not bumped past toyventor-v1");
  if (!sw.includes("/sw.js")) swProblems.push("/sw.js itself is not excluded from caching");
  if (!sw.includes("/api/")) swProblems.push("/api/ is not excluded from caching");
  if (!sw.includes("navigate")) swProblems.push("no navigation fallback for offline shell");
  if (!sw.includes("networkFirst")) swProblems.push("no network-first path for shell/world");
  if (!sw.includes("cacheFirst") || !/IMMUTABLE|isImmutable/.test(sw))
    swProblems.push("cache-first is not gated on immutable paths");
  if (swProblems.length > 0) fail(`service worker strategy drift: ${swProblems.join("; ")}`);
  else ok(`service worker strategy intact (cache toyventor-v${version})`);
}

if (failures > 0) {
  console.log(`
First-deploy remediation (Dan, needs your Cloudflare login):
  npx wrangler login
  npx wrangler d1 create toyventor        # only if the database does not exist
  npx wrangler secret put MODEL_API_KEY   # value from .dev.vars, never committed
  npx wrangler d1 migrations apply toyventor --remote
  npm run deploy`);
  console.error(`preflight: ${failures} blocking item(s) above`);
  process.exit(1);
}
console.log("preflight: local checks pass — redeploy with `npm run deploy`");
