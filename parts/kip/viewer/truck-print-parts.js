// Truck parts provider (Workshop stage 3): what the print view needs from the Truck bench —
// `[{ id, colour, count }]` for exactly what is built on screen. Counts come from the live scene
// (geometry -> part id), so stage/option changes never drift from the printed set; colours are the
// bench materials' own colours. Print STL resolution and plate planning live in kip-print-bom/view.

/** Count visible CAD part instances under `root`; `geoToId` maps a geometry object to its part id. */
export function countSceneParts(root, geoToId) {
  const byId = new Map();
  root.traverse((o) => {
    if (!o.isMesh) return;
    // Hidden parts are not printed, but `root` itself is hidden while the plate view is open (it hides the truck): its own flag must not count,
    // or every repack from inside the plate view would find nothing.
    for (let p = o; p && p !== root; p = p.parent) if (p.visible === false) return;
    const id = geoToId.get(o.geometry);
    if (!id) return;
    const colour = o.material?.color?.getHexString ? `#${o.material.color.getHexString()}` : '#F4EFE6';
    const cur = byId.get(id) || { id, colour, count: 0 };
    cur.count += 1;
    byId.set(id, cur);
  });
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * `getParts` for mountPrintView: the Truck CAD parts currently built. The Kip driver is NOT in this list: it prints through
 * `truckDriverPrintState` (Workshop stage 4c), so the faceplate the Truck loads for its own cab is dropped here, or it would be counted twice.
 */
export function truckGetParts({ cadRoot, geos, partFiles }) {
  const wanted = new Set(partFiles);
  const geoToId = new Map();
  for (const [pid, g] of Object.entries(geos)) if (wanted.has(pid) && g) geoToId.set(g, pid);
  return countSceneParts(cadRoot, geoToId).filter((p) => p.id !== 'char_faceplate');
}

// The Kip's custom-STL slots that stay on screen while it is seated in the cab (its head and crown); hand, back and hood belong to a Kip
// that stands, holds things and drives its own vehicle, and the Truck hides all of those (prepareSharedKipForTruck).
const SEATED_CUSTOM_SLOTS = ['head', 'crown'];

/**
 * The Kip scene state printed with the Truck (Workshop stage 4c): the driver as sat in the cab, in the shape `resolveSceneBom` takes.
 *   driver  what the Truck itself holds, as wardrobe ids: { edition, head, hair, hat }
 *   kip     the full print state of the Kip bench when one is mounted (outfit, skin, colours, face), else null (the BOM's own defaults)
 * The driver fields win over the Kip's: the Truck's buttons write them first, and the Kip only adopts them when its tab is shown again.
 * The Kip's own vehicle, prop, back and tail are hidden while it is seated, so they are not printed either.
 */
export function truckDriverPrintState({ driver, kip = null }) {
  const slots = {};
  for (const k of SEATED_CUSTOM_SLOTS) if (kip?.customStlSlots?.[k]) slots[k] = kip.customStlSlots[k];
  return {
    ...(kip ?? {}),
    edition: driver.edition === 'snap' ? 'snap' : 'pro',
    head: driver.head || 'kid',
    hair: driver.hair || 'off',
    hat: driver.hat || 'buds',
    vehicle: 'none',
    vehCovers: false,
    racerKit: false,
    prop: 'off',
    back: 'off',
    tail: 'off',
    hasPhotoAccessory: false,
    customHoodMode: 'none',
    customStlSlots: slots,
    photoAccessorySlots: {},
    includeVehicle: false,
  };
}

/** One line for the watcher and the tests: what a parts list contains, so adding a plough or swapping the wheels repacks an open plate view. */
export function partsSignature(parts) {
  return parts.map((p) => `${p.id}:${p.count}:${p.colour}`).join(',');
}

/** Pixels of a canvas as the sticker planner wants them ({ w, h, data }), or null for an empty or unreadable canvas. */
function canvasToRgba(c) {
  if (!c || !c.width || !c.height) return null;
  const g = c.getContext('2d');
  if (!g) return null;
  return { w: c.width, h: c.height, data: g.getImageData(0, 0, c.width, c.height).data };
}

/**
 * `renderStickerSources` for the Truck's print source (Workshop stage 4c leftover): the artwork of the DRIVER's decals, so a face sticker and the shirt
 * print from the Truck tab as they do from the Kip tab. Only the kinds a seated driver can have: the face (human plate, selfie, creature) and the shirt.
 * Craft cut-outs (a photographed prop, crown or hood) cannot occur, because `truckDriverPrintState` clears every slot that holds them.
 * The canvas makers are passed in (kip-forge-sdk.js), so this file stays free of browser globals and the Node tests can use fakes.
 *   makeFace(expr, head, insertMode, { onPlate }) -> canvas      makeShirt(shirtId, pantsId, skinHex) -> canvas      skinTones: [{ id, hex }]
 */
export function truckStickerSources({ makeFace, makeShirt, skinTones }) {
  return (state, bom, bonusExprs = []) => {
    const out = {};
    const skin = (skinTones || []).find((s) => s.id === state.skin) || (skinTones || [])[0];
    for (const dec of bom?.decals || []) {
      if (dec.kind === 'selfie_face') {
        out['face:selfie'] = canvasToRgba(makeFace('selfie', state.head, 'flat', { onPlate: true }));
        for (const e of bonusExprs) out[`face:${e}:flat`] = canvasToRgba(makeFace(e, state.head, 'flat', { onPlate: true }));
      } else if (dec.kind === 'human_face') {
        const ins = dec.faceInsert || 'sculpted';
        out[`face:${dec.expr || 'spark'}:${ins}`] = canvasToRgba(makeFace(dec.expr || 'spark', state.head, ins, { onPlate: true }));
        if (ins === 'flat') for (const e of bonusExprs) out[`face:${e}:flat`] = canvasToRgba(makeFace(e, state.head, 'flat', { onPlate: true }));
      } else if (dec.kind === 'creature_face') {
        const head = dec.head || state.head || 'fox';
        out[`creature:${head}:${dec.expr || 'spark'}`] = canvasToRgba(makeFace(dec.expr || 'spark', head, 'sculpted', { onPlate: false }));
      } else if (dec.kind === 'shirt') {
        out[`shirt:${dec.shirtId}`] = canvasToRgba(makeShirt(dec.shirtId, state.pants || 'off', skin?.hex));
      }
    }
    return out;
  };
}
