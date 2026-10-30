// Auto-discovers every sets/*.json file at build/test time so dropping a new
// expansion set JSON into sets/ loads across Build, Market, Packs, Toybox,
// Play, and Reveal with zero code changes.
import { validateSet, type Part, type ToySet } from "../../shared/part";

const rawModules = import.meta.glob<ToySet>("../../sets/*.json", {
  eager: true,
  import: "default",
});

const orderedEntries = Object.entries(rawModules).sort(([a], [b]) => {
  const aBase = a.endsWith("/base.json");
  const bBase = b.endsWith("/base.json");
  if (aBase !== bBase) return aBase ? -1 : 1;
  return a.localeCompare(b);
});

export const allSets: ToySet[] = orderedEntries.map(([, mod]) => mod);

export const baseSet: ToySet =
  allSets.find((s) => s.id === "base") ??
  allSets[0] ?? { id: "base", name: "Base Library", parts: [] };

export const catalogErrors: string[] = [];
const seenIds = new Set<string>();
const mergedParts: Part[] = [];

for (const [path, set] of orderedEntries) {
  const file = path.split("/").pop() ?? path;
  for (const err of validateSet(set)) {
    catalogErrors.push(`${file}: ${err}`);
  }
  for (const part of set.parts ?? []) {
    if (seenIds.has(part.id)) {
      catalogErrors.push(`${file}: duplicate part id across sets: ${part.id}`);
      continue;
    }
    seenIds.add(part.id);
    mergedParts.push(part);
  }
}

export const allParts: Part[] = mergedParts;
export const partsById: Map<string, Part> = new Map(
  allParts.map((p) => [p.id, p]),
);

/** Printable STL filename in public/parts-stl/, derived from set data (no hardcoded map). */
export function stlFileFor(part: Part | undefined): string | undefined {
  if (!part || !part.printable) return undefined;
  return part.stlFile;
}

/** 3D/AR GLB filename in public/parts-glb/, derived from set data. */
export function glbFileFor(part: Part | undefined): string | undefined {
  if (!part || !part.printable) return undefined;
  if (part.glbFile) return part.glbFile;
  return part.stlFile ? part.stlFile.replace(/\.stl$/i, ".glb") : undefined;
}
