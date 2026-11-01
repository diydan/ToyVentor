// Bridges the canonical 12.5 mm / 25 mm TU PartSpec catalog into live app
// set files (sets/base.json + Forge Club expansion sets) and syncs real binary
// STLs into public/parts-stl/ + GLBs into public/parts-glb/.
//
// Run: npm run bridge [-- --no-assets]
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateSet, type Part, type ToySet } from "../shared/part";
import {
  BASE_SET_PARTSPEC_IDS,
  convertPartSpecPart,
  KIP_WARDROBE_PARTSPEC_IDS,
  RACER_GARAGE_PARTSPEC_IDS,
  type BridgeOptions,
  type PartSpecCatalogPart,
  type PartSpecManifestPart,
} from "../shared/partspec";

const root = process.cwd();
const pkgDir = join(root, "parts/partspec");
const syncAssets = !process.argv.includes("--no-assets");

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
  includeAdvanced: true,
  idPrefix: "",
  deriveStatValue: true,
  includeAssets: true,
};

function resolveSourceStl(file: string): string {
  const candidates = [
    join(pkgDir, "out", file),
    join(root, "public/kip/partspec", file),
    join(pkgDir, file),
  ];
  const hit = candidates.find((p) => existsSync(p));
  if (!hit) {
    throw new Error(`STL file "${file}" not found in parts/partspec/out/ or public/kip/partspec/`);
  }
  return hit;
}

function buildParts(
  ids: readonly string[],
  overrides: Record<string, Partial<Part>> = {},
): Array<{ part: Part; sourceStl: string }> {
  const out: Array<{ part: Part; sourceStl: string }> = [];
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
    out.push({ part: merged, sourceStl: resolveSourceStl(man!.file!) });
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

if (syncAssets) {
  const stlOutDir = join(root, "public/parts-stl");
  const glbOutDir = join(root, "public/parts-glb");
  mkdirSync(stlOutDir, { recursive: true });
  mkdirSync(glbOutDir, { recursive: true });

  const stageDir = mkdtempSync(join(tmpdir(), "toyventor-bridge-stl-"));
  try {
    const allBuilt = [...baseBuilt, ...racerBuilt, ...wardrobeBuilt];
    for (const { part, sourceStl } of allBuilt) {
      if (!part.stlFile) continue;
      copyFileSync(sourceStl, join(stlOutDir, part.stlFile));
      copyFileSync(sourceStl, join(stageDir, part.stlFile));
    }
    execFileSync("python3", [join(root, "scripts/stl_to_glb.py"), stageDir, glbOutDir], {
      stdio: "inherit",
    });
    console.log(
      `bridge: synced ${allBuilt.length} binary STLs -> public/parts-stl/ and GLBs -> public/parts-glb/`,
    );
  } finally {
    rmSync(stageDir, { recursive: true, force: true });
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
