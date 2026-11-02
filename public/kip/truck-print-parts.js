// Truck parts provider (Workshop stage 3): what the print view needs from the Truck bench —
// `[{ id, colour, count }]` for exactly what is built on screen. Counts come from the live scene
// (geometry -> part id), so stage/option changes never drift from the printed set; colours are the
// bench materials' own colours. Print STL resolution and plate planning live in kip-print-bom/view.

/** Count visible CAD part instances under `root`; `geoToId` maps a geometry object to its part id. */
export function countSceneParts(root, geoToId) {
  const byId = new Map();
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (let p = o; p; p = p.parent) if (p.visible === false) return;
    const id = geoToId.get(o.geometry);
    if (!id) return;
    const colour = o.material?.color?.getHexString ? `#${o.material.color.getHexString()}` : '#F4EFE6';
    const cur = byId.get(id) || { id, colour, count: 0 };
    cur.count += 1;
    byId.set(id, cur);
  });
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** `getParts` for mountPrintView: the Truck CAD parts currently built (the Kip driver is not printed here). */
export function truckGetParts({ cadRoot, geos, partFiles }) {
  const wanted = new Set(partFiles);
  const geoToId = new Map();
  for (const [pid, g] of Object.entries(geos)) if (wanted.has(pid) && g) geoToId.set(g, pid);
  return countSceneParts(cadRoot, geoToId).filter((p) => p.id !== 'char_faceplate');
}
