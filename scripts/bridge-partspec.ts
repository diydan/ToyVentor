// Bridges the canonical 12.5 mm / 25 mm TU PartSpec catalog into live app
// set files (sets/base.json + Forge Club expansion sets) and syncs optimized
// print-tier binary STLs into public/parts-stl/ + quantized Web-LOD GLBs into
// public/parts-glb/.
//
// Run: npm run bridge [-- --no-assets] [-- --verify-preprint]
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { validateSet, type Part, type ToySet } from "../shared/part";
import {
  BASE_SET_PARTSPEC_IDS,
  convertPartSpecPart,
  KIP_WARDROBE_PARTSPEC_IDS,
  MECH_ROBOTICS_PARTSPEC_IDS,
  MODULAR_CRAFT_PARTSPEC_IDS,
  RACER_GARAGE_PARTSPEC_IDS,
  type BridgeOptions,
  type PartSpecCatalogPart,
  type PartSpecManifestPart,
} from "../shared/partspec";

const root = process.cwd();
const pkgDir = join(root, "parts/partspec");
const syncAssets = !process.argv.includes("--no-assets");
const verifyPreprint = process.argv.includes("--verify-preprint");

for (const f of ["catalog.json", "toyventor_parts.json"]) {
  if (!existsSync(join(pkgDir, f))) {
    console.error(`bridge: ${f} not found in ${pkgDir} — is the PartSpec package present?`);
    process.exit(1);
  }
}

const catalog = JSON.parse(readFileSync(join(pkgDir, "catalog.json"), "utf8")) as {
  parts: PartSpecCatalogPart[];
};
const manifestDoc = JSON.parse(readFileSync(join(pkgDir, "toyventor_parts.json"), "utf8")) as {
  parts: PartSpecManifestPart[];
};
const manifestById = new Map(manifestDoc.parts.map((p) => [p.id, p]));
const catalogById = new Map(catalog.parts.map((p) => [p.id, p]));

const BRIDGE_OPTS: BridgeOptions = {
  mapAllStats: true,
  includePro: true,
  idPrefix: "",
  deriveStatValue: true,
  includeAssets: true,
};

function resolvePartSpecPython(): string | null {
  const candidates: string[] = [];
  if (process.env.PARTSPEC_PYTHON) candidates.push(process.env.PARTSPEC_PYTHON);
  candidates.push(join(pkgDir, ".venv/bin/python3"));
  try {
    const gitCommon = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (gitCommon) {
      const commonRoot = dirname(resolve(root, gitCommon));
      candidates.push(join(commonRoot, "parts/partspec/.venv/bin/python3"));
    }
  } catch {
    // Non-git checkout; ignore
  }
  return candidates.find((p) => existsSync(p)) ?? null;
}

function findExistingSourceStl(file: string): string | null {
  const candidates = [
    join(pkgDir, "out", file),
    join(root, "public/kip/partspec", file),
    join(root, "public/kip/partspec/mockup", file),
    join(pkgDir, file),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

type AssetSyncItem = {
  part: Part;
  partspecId: string;
  sourceStl: string | null;
};

function buildParts(
  ids: readonly string[],
  overrides: Record<string, Partial<Part>> = {},
): AssetSyncItem[] {
  const out: AssetSyncItem[] = [];
  for (const id of ids) {
    const row = catalogById.get(id);
    if (!row) {
      console.error(`bridge: catalog id "${id}" not found`);
      process.exit(1);
    }
    const man = manifestById.get(id);
    const r = convertPartSpecPart(row, man, BRIDGE_OPTS);
    if (!r.ok) {
      console.error(`bridge: id "${id}" failed conversion: ${r.reason}`);
      process.exit(1);
    }
    const merged: Part = { ...r.part, ...(overrides[id] ?? {}) };
    out.push({
      part: merged,
      partspecId: id,
      sourceStl: findExistingSourceStl(man!.file!),
    });
  }
  return out;
}

// Digital-only AR/game skin carried over onto the 12.5 mm TU grid (2x1 = 25x12.5 mm).
const RACER_RED_SKIN: Part = {
  id: "skin-racer-red",
  name: "Racer Red Skin",
  line: "snap",
  mount: "stud",
  sizeClass: "small",
  grid: { units: [2, 1], profile: "tu_stud_small" },
  footprintMm: [25, 12.5],
  stat: { name: "speed", value: 1 },
  printable: false,
  skin: "month1/racer-red",
};

const baseBuilt = buildParts(BASE_SET_PARTSPEC_IDS, {
  racer_spoiler: { skin: "month1/racer-red" },
});
const racerBuilt = buildParts(RACER_GARAGE_PARTSPEC_IDS);
const wardrobeBuilt = buildParts(KIP_WARDROBE_PARTSPEC_IDS);
const modularCraftBuilt = buildParts(MODULAR_CRAFT_PARTSPEC_IDS);
const mechRoboticsBuilt = buildParts(MECH_ROBOTICS_PARTSPEC_IDS);

const setsToWrite: Array<{ filename: string; set: ToySet }> = [
  {
    filename: "base.json",
    set: {
      id: "base",
      name: "Base Library (12.5 mm TU)",
      parts: [...baseBuilt.map((x) => x.part), RACER_RED_SKIN],
    },
  },
  {
    filename: "racer-garage.json",
    set: {
      id: "racer-garage",
      name: "Forge Club · Racer Garage",
      parts: racerBuilt.map((x) => x.part),
    },
  },
  {
    filename: "kip-wardrobe.json",
    set: {
      id: "kip-wardrobe",
      name: "Forge Club · Kip & Critter Wardrobe",
      parts: wardrobeBuilt.map((x) => x.part),
    },
  },
  {
    filename: "modular-craft.json",
    set: {
      id: "modular-craft",
      name: "Forge Club · Modular Craft Kit",
      parts: modularCraftBuilt.map((x) => x.part),
    },
  },
  {
    filename: "mech-robotics.json",
    set: {
      id: "mech-robotics",
      name: "Forge Club · Functional Mechanics & Mech Robotics",
      parts: mechRoboticsBuilt.map((x) => x.part),
    },
  },
];

for (const { filename, set } of setsToWrite) {
  const errors = validateSet(set);
  if (errors.length > 0) {
    console.error(`bridge: generated ${filename} is invalid:`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  writeFileSync(join(root, "sets", filename), JSON.stringify(set, null, 2) + "\n");
  console.log(`bridge: wrote sets/${filename} (${set.parts.length} parts)`);
}

// Remove obsolete demo set file now that canonical TU sets are live.
const legacyDemo = join(root, "sets/partspec-demo.json");
if (existsSync(legacyDemo)) {
  unlinkSync(legacyDemo);
  console.log("bridge: removed superseded sets/partspec-demo.json");
}

function collectExpansionSyncItems(existingItems: AssetSyncItem[]): AssetSyncItem[] {
  const seenStl = new Set(existingItems.map((x) => x.part.stlFile).filter(Boolean));
  const extra: AssetSyncItem[] = [];
  for (const file of readdirSync(join(root, "sets")).filter((f) => f.endsWith(".json")).sort()) {
    const doc = JSON.parse(readFileSync(join(root, "sets", file), "utf8")) as ToySet;
    for (const part of doc.parts ?? []) {
      if (!part.printable || !part.stlFile || seenStl.has(part.stlFile)) continue;
      seenStl.add(part.stlFile);
      const partspecId = part.id.replace(/-/g, "_");
      const man = manifestById.get(partspecId);
      const sourceStl = man?.file
        ? findExistingSourceStl(man.file)
        : findExistingSourceStl(part.stlFile);
      extra.push({ part, partspecId, sourceStl });
    }
  }
  return extra;
}

function dirBytes(dir: string, ext: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .reduce((sum, f) => sum + statSync(join(dir, f)).size, 0);
}

if (syncAssets) {
  const stlOutDir = join(root, "public/parts-stl");
  const glbOutDir = join(root, "public/parts-glb");
  const optManifest = join(pkgDir, "asset_optimization_manifest.json");
  mkdirSync(stlOutDir, { recursive: true });
  mkdirSync(glbOutDir, { recursive: true });

  const venvPython = resolvePartSpecPython();
  const stageRoot = mkdtempSync(join(tmpdir(), "toyventor-bridge-stl-"));
  const rawStageDir = join(stageRoot, "raw");
  const webStageDir = join(stageRoot, "web");
  mkdirSync(rawStageDir, { recursive: true });
  mkdirSync(webStageDir, { recursive: true });

  try {
    const coreItems = [...baseBuilt, ...racerBuilt, ...wardrobeBuilt];
    const allItems = [...coreItems, ...collectExpansionSyncItems(coreItems)];
    const buildMissingArgs: string[] = [];

    for (const { part, partspecId, sourceStl } of allItems) {
      if (!part.stlFile) continue;
      const stagedPath = join(rawStageDir, part.stlFile);
      if (sourceStl) {
        copyFileSync(sourceStl, stagedPath);
      } else if (venvPython && manifestById.has(partspecId)) {
        buildMissingArgs.push("--build-missing", `${partspecId}=${stagedPath}`);
      } else if (existsSync(join(stlOutDir, part.stlFile))) {
        copyFileSync(join(stlOutDir, part.stlFile), stagedPath);
      } else {
        throw new Error(
          `STL for "${part.id}" (${part.stlFile}) not found on disk and PartSpec .venv unavailable to synthesize it`,
        );
      }
    }

    if (venvPython) {
      const optArgs = [
        join(root, "scripts/optimize_assets.py"),
        "--in",
        rawStageDir,
        "--stl-out",
        stlOutDir,
        "--web-stage",
        webStageDir,
        "--partspec-dir",
        pkgDir,
        "--manifest",
        optManifest,
        "--update-manifest",
        ...buildMissingArgs,
      ];
      const firstPrint = join(stlOutDir, "forge-mount-first-print.stl");
      if (existsSync(firstPrint)) {
        optArgs.push("--standalone", firstPrint);
      }
      if (verifyPreprint) {
        optArgs.push("--verify-preprint");
      }
      execFileSync(venvPython, optArgs, { stdio: "inherit" });
      execFileSync(
        venvPython,
        [join(root, "scripts/stl_to_glb.py"), webStageDir, glbOutDir, "--manifest", optManifest],
        { stdio: "inherit" },
      );
    } else {
      for (const f of readdirSync(rawStageDir).filter((n) => n.endsWith(".stl"))) {
        copyFileSync(join(rawStageDir, f), join(stlOutDir, f));
      }
      execFileSync(
        "python3",
        [join(root, "scripts/stl_to_glb.py"), rawStageDir, glbOutDir, "--manifest", optManifest],
        { stdio: "inherit" },
      );
    }

    const totalStlMb = (dirBytes(stlOutDir, ".stl") / (1024 * 1024)).toFixed(2);
    const totalGlbMb = (dirBytes(glbOutDir, ".glb") / (1024 * 1024)).toFixed(2);
    console.log(
      `bridge: synced ${allItems.length} catalog parts -> public/parts-stl/ (${totalStlMb} MB) & public/parts-glb/ (${totalGlbMb} MB)`,
    );
  } finally {
    rmSync(stageRoot, { recursive: true, force: true });
  }
}

// Whole-catalog readiness report in full TU mode.
const skipped = new Map<string, number>();
let convertible = 0;
for (const row of catalog.parts) {
  const r = convertPartSpecPart(row, manifestById.get(row.id), BRIDGE_OPTS);
  if (r.ok) convertible++;
  else {
    const norm = r.reason.replace(/"[^"]*"/g, '"…"');
    skipped.set(norm, (skipped.get(norm) ?? 0) + 1);
  }
}
console.log(
  `bridge: whole catalog — ${convertible}/${catalog.parts.length} convertible in full TU mode${
    skipped.size ? "; skipped:" : ""
  }`,
);
for (const [reason, n] of [...skipped.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${n}x ${reason}`);
}
