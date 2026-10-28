// Bridges the PartSpec demo subset into an app set file.
// Run: npm run bridge [-- --copy-stl]
// Reads docs/PartSpec/pkg/{catalog.json,toyventor_parts.json}, writes
// sets/partspec-demo.json (validated before writing), and reports every
// catalog part it did NOT convert, with the reason. App screens still
// import sets/base.json; this set ships nowhere until the lattice print
// decides (docs/decisions/0005-partspec-lattice-merge.md).
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateSet, type ToySet } from "../shared/part";
import {
  convertPartSpecPart,
  DEMO_SUBSET_IDS,
  type PartSpecCatalogPart,
  type PartSpecManifestPart,
} from "../shared/partspec";

const pkgDir = join(process.cwd(), "docs/PartSpec/pkg");
const copyStl = process.argv.includes("--copy-stl");

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

// Subset first: every demo id must convert, or the bridge fails loudly.
const parts = [];
for (const id of DEMO_SUBSET_IDS) {
  const row = catalogById.get(id);
  if (!row) {
    console.error(`bridge: demo id "${id}" not in catalog`);
    process.exit(1);
  }
  const r = convertPartSpecPart(row, manifestById.get(id));
  if (!r.ok) {
    console.error(`bridge: demo id "${id}" did not convert: ${r.reason}`);
    process.exit(1);
  }
  parts.push(r.part);
  if (copyStl) {
    const src = manifestById.get(id)!.file!;
    copyFileSync(join(pkgDir, src), join(process.cwd(), "public/parts-stl", `${r.part.id}.stl`));
  }
}

const set: ToySet = {
  id: "partspec-demo",
  name: "PartSpec Demo (TU lattice, pending print decision)",
  parts,
};
const errors = validateSet(set);
if (errors.length > 0) {
  console.error("bridge: generated set is invalid:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
writeFileSync(
  join(process.cwd(), "sets/partspec-demo.json"),
  JSON.stringify(set, null, 2) + "\n",
);
console.log(`bridge: wrote sets/partspec-demo.json (${parts.length} parts)`);
console.log("bridge: WARNING stat values are placeholders (no upstream numeric stat)");
if (copyStl) console.log("bridge: copied subset STLs to public/parts-stl/ (GLB: scripts/stl_to_glb.py)");

// Whole-catalog report: what full migration still has to solve.
const skipped = new Map<string, number>();
let convertible = 0;
for (const row of catalog.parts) {
  const r = convertPartSpecPart(row, manifestById.get(row.id));
  if (r.ok) convertible++;
  else skipped.set(r.reason.replace(/"[^"]*"/g, '"…"'), (skipped.get(r.reason.replace(/"[^"]*"/g, '"…"')) ?? 0) + 1);
}
console.log(`bridge: whole catalog — ${convertible}/${catalog.parts.length} convertible today; skipped:`);
for (const [reason, n] of [...skipped.entries()].sort((a, b) => b[1] - a[1]))
  console.log(`  ${n}x ${reason}`);
