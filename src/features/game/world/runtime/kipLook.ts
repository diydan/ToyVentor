// The default Kip, as the Kip demo dresses him (Dan, 2026-11-04: "in all levels the default kip is weird, can we use the kip skin colors and add shirts and pants and a face from
// the kip demo, we may have an old face, the new ones have inset face plates"). Pure: the game's rig (stlRigLoader.ts), the stock toy (catalog.ts) and the tests share it.
//
// WHAT CHANGED. The game's stock toy was a gold dragon-headed creature with blue legs and cream arms and no face. The Kip demo's Kip is a kid head with an inset face plate
// (eyes, brows, blush and a smile drawn on the plate), skin tones, a shirt, pants and boots. This copies the demo's numbers so the two look alike; tests/kip-look.test.ts fails
// when the demo's tables, its face drawing (every canvas call, compared one by one) or the plate seat drift from the copies below.
//
// FROM parts/kip/viewer/kip-vehicles-wardrobe.js: SKIN_TONES, the Spark Bolt Tee (SHIRT_OPTIONS), the Cuffed Jeans (PANTS_OPTIONS), FACE_STEM_MM and the decal plane numbers.
// FROM parts/kip/viewer/kip-faceplate-shape.js: FACEPLATE_SEAT_MM and the plate outline (PLATE_HALF_WIDTH), which clips the face to the plate.
// FROM parts/kip/viewer/kip-forge-sdk.js: createDecalExpressionCanvas('spark', 'kid', 'sculpted', { onPlate: true }), the face the demo opens with.

export interface KipSkinTone { id: string; label: string; hex: string }
/** The demo's five skin tones, in its order. The game's Create screen paints the skin with these. */
export const KIP_SKIN_TONES: readonly KipSkinTone[] = [
  { id: "warm_peach", label: "Warm Peach", hex: "#F3BA95" },
  { id: "golden_tan", label: "Golden Tan", hex: "#D99568" },
  { id: "rich_cocoa", label: "Rich Cocoa", hex: "#8A5035" },
  { id: "soft_ivory", label: "Rosy Ivory", hex: "#F6CBB1" },
  { id: "vinyl_cream", label: "Vinyl Cream", hex: "#F4EFE6" },
];

/** The shirt and the pants he wears by default: the demo's Spark Bolt Tee (short sleeves, so bare arms) and Cuffed Jeans. */
export const KIP_SHIRT = { id: "spark_tee", label: "Spark Bolt Tee", chestHex: "#FF6B4A", sleeveHex: "#FF6B4A", cuffHex: "#FFFFFF", longSleeve: false, shoeHex: "#FF6B4A" } as const;
export const KIP_PANTS = { id: "jeans", label: "Cuffed Jeans", waistHex: "#2B4C85", legHex: "#2B4C85", cuffHex: "#8FB0E0", isShorts: false, shoeHex: "#FF6B4A" } as const;

/** The stock toy's colours: c1 is the shirt (torso), c2 the pants (legs), skin the skin. Lower case, the way the game stores them. */
export const KIP_DEFAULT_COL = {
  c1: KIP_SHIRT.chestHex.toLowerCase(),
  c2: KIP_PANTS.legHex.toLowerCase(),
  skin: KIP_SKIN_TONES[0]!.hex.toLowerCase(),
} as const;
/** The boots: the demo takes the pants' shoe colour (the shirt's when the pants have none). */
export const KIP_BOOT_HEX = KIP_PANTS.shoeHex.toLowerCase();

/** The stock toy's parts: the demo's "kid" human head with the universal face plate, nothing on the head, no tail. `base: "block"` is the game's Figure Pal (the human head). */
export interface StockCharacter { base: string; eyes: string; ears: string; hat: string; back: string; tail: string; prop: string; boots: string }
export const KIP_DEFAULT_CHARACTER: StockCharacter = { base: "block", eyes: "big", ears: "none", hat: "none", back: "none", tail: "none", prop: "none", boots: "none" };
/** What the stock toy was before (a gold horned creature), so a saved game that never changed it can be moved to the new look and one the child made their own is left alone. */
export const OLD_STOCK_CHARACTER: StockCharacter = { base: "creature", eyes: "big", ears: "horns", hat: "none", back: "none", tail: "curly", prop: "none", boots: "none" };
export const OLD_STOCK_COL = { c1: "#ffd24d", c2: "#52b7ff", skin: "#f2b98c" } as const;

const sameParts = (a: Record<string, unknown> | undefined, b: object): boolean => !!a && Object.entries(b).every(([k, v]) => a[k] === v);
const sameCol = (a: Record<string, unknown> | undefined, b: object): boolean => !!a && Object.entries(b).every(([k, v]) => String(a[k] ?? "").toLowerCase() === v);

/**
 * A saved game that still has the old stock Kip (the gold dragon: exactly the old parts AND the old colours, so nothing the child chose) gets the new one. Returns true when it changed
 * `state` (the game's S: `{ sel: { character }, col }`). Anything else, including a Kip with only one of the old settings, is left alone.
 */
export function migrateOldStockKip(state: { type?: unknown; sel?: { character?: Record<string, unknown> } | null; col?: Record<string, unknown> | null }): boolean {
  if (!state || state.type !== "character") return false;
  const ch = state.sel?.character;
  if (!sameParts(ch, OLD_STOCK_CHARACTER) || !sameCol(state.col ?? undefined, OLD_STOCK_COL)) return false;
  state.sel!.character = { ...KIP_DEFAULT_CHARACTER, ...(ch && typeof ch.prop === "string" ? { prop: ch.prop } : {}) };
  state.col = { ...KIP_DEFAULT_COL };
  return true;
}

export interface KipBodyColors { head: string; neck: string; torso: string; arms: string; hands: string; legs: string; boots: string }
/**
 * The colour of each part of the human Kip, the way the demo paints them (resolveBodyColors): head, neck, hands and, in a short-sleeved shirt, the arms are the skin; the torso is the
 * shirt; the legs are the pants. (A long-sleeved shirt would colour the arms too; the game has one shirt colour and no sleeves choice, so the arms stay bare.)
 */
export function kipBodyColors(col: { c1: string; c2: string; skin?: string }): KipBodyColors {
  const skin = col.skin || KIP_DEFAULT_COL.skin;
  return { head: skin, neck: skin, torso: col.c1, arms: skin, hands: skin, legs: col.c2, boots: KIP_BOOT_HEX };
}

// ---- the face plate -----------------------------------------------------------------------------------------------------------------------------------------------
/** Where the demo seats the plate in the head's frame (mm): `holderY` up, `holderZ` forward. kip-vehicles-wardrobe.js `faceplateHolder.position`. */
export const FACE_STEM_MM = 10.167;
export const FACEPLATE_SEAT_MM = { raise: 0.7, sink: 1.6 } as const;
/**
 * The kid head's `face_slot` bore height (kip-vehicles-wardrobe.js WARDROBE_HEADS 'kid' `faceY`). The bench seats the plate at `dt.faceY - 2.50 + raise` for the head it is showing (kip-bench.js, every time the head
 * changes). Until 2026-11-04 (later) this file used the 17.1875 that the wardrobe's builder puts there as its CREATION default, before the head's own number is applied: the plate sat 4.69 mm too high on the
 * head, its top over the brow, and the lower part of the head's face pocket was left empty (a dark hollow under the eyes).
 */
export const KID_FACE_Y = 12.5;
export const FACEPLATE_HOLDER = { y: KID_FACE_Y - 2.5 + FACEPLATE_SEAT_MM.raise, z: FACE_STEM_MM - FACEPLATE_SEAT_MM.sink } as const;
/** Where the two orange crown studs sit on the kid head (kip-vehicles-wardrobe.js WARDROBE_HEADS 'kid' `crownY`, the head's top_studs plane; the bench puts `altCrownBuds.position.y` there). */
export const KID_CROWN_Y = 30.97;
/** The decal plane the face is drawn on, over the plate (kip-vehicles-wardrobe.js `buildConformalFaceplateDecalGeo` defaults). */
export const FACE_DECAL = { width: 23.6, height: 10.1, centerY: 5.25, segX: 56, segY: 28, lift: 0.22, fallbackZ: 2.65, fallbackK: 0.002 } as const;

/** [zb, half width] of the plate every 0.25 mm up from its trimmed chin edge (kip-faceplate-shape.js `PLATE_HALF_WIDTH`). */
export const PLATE_HALF_WIDTH: readonly (readonly [number, number])[] = [
  [0.0, 8.037], [0.25, 8.292], [0.5, 8.517], [0.75, 8.742], [1.0, 8.967], [1.25, 9.192], [1.5, 9.417], [1.75, 9.642],
  [2.0, 9.867], [2.25, 10.092], [2.5, 10.317], [2.75, 10.542], [3.0, 10.767], [3.25, 10.983], [3.5, 11.173], [3.75, 11.34],
  [4.0, 11.486], [4.25, 11.614], [4.5, 11.725], [4.75, 11.82], [5.0, 11.9], [5.25, 11.966], [5.5, 12.018], [5.75, 12.058],
  [6.0, 12.084], [6.25, 12.098], [6.4, 12.1], [6.5, 12.099], [6.75, 12.088], [7.0, 12.064], [7.25, 12.027], [7.5, 11.977],
  [7.75, 11.914], [8.0, 11.837], [8.25, 11.745], [8.5, 11.638], [8.75, 11.513], [9.0, 11.371], [9.25, 11.208], [9.5, 11.023],
  [9.75, 10.812], [10.0, 10.587], [10.25, 10.347], [10.5, 10.127], [10.75, 9.906], [11.0, 9.681], [11.25, 9.455], [11.5, 9.228],
  [11.75, 8.997], [12.0, 8.744], [12.25, 8.402], [12.5, 6.873], [12.6, 6.093],
];
export const PLATE_TOP_ZB = 12.8;

/** Half width of the plate at height `zb` (linear between stations; 0 outside the plate). */
export function plateHalfWidth(zb: number): number {
  const t = PLATE_HALF_WIDTH;
  if (zb < 0 || zb > PLATE_TOP_ZB) return 0;
  if (zb >= t[t.length - 1]![0]) {
    const [z0, h0] = t[t.length - 1]!;
    return Math.max(0, h0 * (1 - (zb - z0) / (PLATE_TOP_ZB - z0)));
  }
  let i = Math.min(t.length - 2, Math.max(0, Math.floor(zb / 0.25)));
  while (i > 0 && t[i]![0] > zb) i--;
  while (i < t.length - 2 && t[i + 1]![0] < zb) i++;
  const [za, ha] = t[i]!, [zc, hc] = t[i + 1]!;
  return ha + (hc - ha) * ((zb - za) / (zc - za));
}

// ---- the face ---------------------------------------------------------------------------------------------------------------------------------------------------
/** The 2D context the face is drawn with (a real canvas's, or a recorder in the tests). */
export type FaceCtx = CanvasRenderingContext2D;

/** Eye centres on the 512 x 256 art for the sculpted plate: x = 256 +- 5.8 mm * 21.69 px per mm. */
const FACE_EYE_X: readonly [number, number] = [130, 382];
const FACE_EYE_Y = 110;
const FACE_BROW_Y = 44;

/**
 * Draw the Kip demo's default face (expression "spark", the kid head, the sculpted plate, drawn for the plate) on a 512 x 256 canvas: blush, brows, eyes with iris, lashes and two
 * catchlights, and the smile that lands on the moulded ridge; then clip it to the rounded plate. The same calls in the same order as the demo's `createDecalExpressionCanvas`.
 */
export function drawKipFace(ctx: FaceCtx, width = 512, height = 256): void {
  ctx.clearRect(0, 0, width, height);
  const eyeCol = "#241814";
  const mouthCol = "#3B221B";
  const glintCol = "#ffffff";
  const cheekCol = "#ff6b4a";
  // Signature Coral Spark cheek blushes
  ctx.fillStyle = cheekCol;
  for (const bx of [78, 434]) {
    const rg = ctx.createRadialGradient(bx, 174, 4, bx, 174, 30);
    rg.addColorStop(0, "rgba(255, 107, 74, 0.55)");
    rg.addColorStop(0.65, "rgba(255, 118, 92, 0.24)");
    rg.addColorStop(1, "rgba(255, 118, 92, 0.0)");
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.ellipse(bx, 174, 30, 17, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Eyebrows (the neutral kid pair)
  ctx.strokeStyle = "rgba(54, 32, 22, 0.90)";
  ctx.lineWidth = 9.5;
  ctx.lineCap = "round";
  for (const bx of FACE_EYE_X) {
    ctx.beginPath();
    ctx.arc(bx, FACE_BROW_Y, 38, Math.PI * 1.22, Math.PI * 1.78);
    ctx.stroke();
  }
  // Eyes
  const eye = (cx: number, cy: number, side: number): void => {
    ctx.fillStyle = eyeCol;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 36, 43, 0, 0, Math.PI * 2);
    ctx.fill();
    // warm chestnut-amber iris crescent
    ctx.fillStyle = "#8B5437";
    ctx.beginPath();
    ctx.ellipse(cx, cy + 17, 24, 15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#BA7D56";
    ctx.beginPath();
    ctx.ellipse(cx + 3, cy + 20, 15, 7.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // pupil
    ctx.fillStyle = eyeCol;
    ctx.beginPath();
    ctx.ellipse(cx, cy - 2, 18.5, 21.0, 0, 0, Math.PI * 2);
    ctx.fill();
    // upper lash sweep and the outer flick
    ctx.strokeStyle = eyeCol;
    ctx.lineWidth = 8.0;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(cx, cy + 4, 38, Math.PI * 1.08, Math.PI * 1.92);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + side * 33, cy - 12);
    ctx.lineTo(cx + side * 42, cy - 20);
    ctx.stroke();
    // twin catchlights
    ctx.fillStyle = glintCol;
    ctx.beginPath();
    ctx.ellipse(cx - 12, cy - 14, 11.8, 13.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + 12, cy + 13, 5.4, 6.2, 0, 0, Math.PI * 2);
    ctx.fill();
  };
  eye(FACE_EYE_X[0], FACE_EYE_Y, -1);
  eye(FACE_EYE_X[1], FACE_EYE_Y, 1);
  // the resting smile, on the plate's moulded ridge
  ctx.strokeStyle = mouthCol;
  ctx.lineWidth = 12;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(201.8, 216.7);
  ctx.quadraticCurveTo(256, 242.1, 310.2, 216.7);
  ctx.stroke();
  // clip the art to the rounded plate (pulled in 0.4 mm)
  const right: [number, number][] = [];
  const left: [number, number][] = [];
  for (let row = 0; row <= height; row += 4) {
    const zb = 10.3 - row / 25.35;
    const hw = Math.max(0, plateHalfWidth(zb) - 0.4);
    right.push([256 + hw * 21.69, row]);
    left.push([256 - hw * 21.69, row]);
  }
  ctx.save();
  ctx.globalCompositeOperation = "destination-in";
  ctx.fillStyle = "#000";
  ctx.beginPath();
  right.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  for (let i = left.length - 1; i >= 0; i--) ctx.lineTo(left[i]![0], left[i]![1]);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ---- hair, and what the top of the head wears ------------------------------------------------------------------------------------------------------------------------
// Dan, 2026-11-04: "default kip should have hat or hair, we should use the smooth cover if not hair or hat, or hide the studs". The human head has two crown studs. Bare, they showed as two
// orange knobs on the stock Kip. Now the top of a human head wears, in this order: a hat (as before), else a hairstyle (the stock Kip's is the demo's Swept, chestnut), else the smooth
// cover (kipCover.ts: the curved, stud-free top that clips onto the studs, shared/forgeCover.ts) in the skin colour. The studs are never left showing.

/** The demo's hair tones (kip-vehicles-wardrobe.js HAIR_COLORS), in its order. */
export const KIP_HAIR_COLORS: readonly { id: string; label: string; hex: string }[] = [
  { id: "chestnut", label: "Chestnut", hex: "#6E412A" },
  { id: "espresso", label: "Espresso", hex: "#2A211E" },
  { id: "golden_blonde", label: "Golden Blonde", hex: "#F2B83B" },
  { id: "auburn_ginger", label: "Auburn Ginger", hex: "#D85A2B" },
  { id: "berry_spark", label: "Berry Spark", hex: "#D9468F" },
  { id: "cobalt", label: "Cobalt Blue", hex: "#2E6FDB" },
];
/** The stock Kip's hair tone (the demo's first). */
export const KIP_DEFAULT_HAIR_HEX = KIP_HAIR_COLORS[0]!.hex.toLowerCase();

export interface KipHairStyle {
  id: string;
  label: string;
  /** Has its own 2x1 studs on top, so a hat can sit on it (the other eleven are sculpted tops). */
  hatReady: boolean;
  /** How far above the head's stud plane the wig's studs sit (WIG_TOP_Z, 4.8 mm for a hat-ready wig). */
  topH: number;
  /** Where the wig's lowest point (its hem) is, relative to the head's stud plane (mm). */
  seatY: number;
}
/** The demo's nineteen hairstyles (kip-vehicles-wardrobe.js HAIR_OPTIONS without 'off'). tests/kip-hair.test.ts compares this with the demo's source. */
export const KIP_HAIRSTYLES: readonly KipHairStyle[] = [
  { id: "short_swept", label: "Swept", hatReady: true, topH: 4.8, seatY: -16.5 },
  { id: "bob", label: "Bob", hatReady: true, topH: 4.8, seatY: -19.0 },
  { id: "swoosh", label: "Swoosh", hatReady: true, topH: 4.8, seatY: -16.5 },
  { id: "long_layered", label: "Long Flow", hatReady: true, topH: 4.8, seatY: -22.5 },
  { id: "twin_braids", label: "Twin Braids", hatReady: true, topH: 4.8, seatY: -22.5 },
  { id: "shag", label: "Shag", hatReady: true, topH: 4.8, seatY: -17.0 },
  { id: "bowl", label: "Bowl Cut", hatReady: true, topH: 4.8, seatY: -16.0 },
  { id: "slick", label: "Sleek Part", hatReady: true, topH: 4.8, seatY: -16.0 },
  { id: "pompadour", label: "Pompadour", hatReady: false, topH: 0, seatY: -16.5 },
  { id: "top_bun", label: "Top Bun", hatReady: false, topH: 0, seatY: -16.5 },
  { id: "side_sweep", label: "Side Sweep", hatReady: false, topH: 0, seatY: -19.0 },
  { id: "spiky", label: "Spiky Tufts", hatReady: false, topH: 0, seatY: -16.5 },
  { id: "pigtails", label: "Twin Pigtails", hatReady: false, topH: 0, seatY: -17.0 },
  { id: "ponytail", label: "High Ponytail", hatReady: false, topH: 0, seatY: -16.5 },
  { id: "curly", label: "Cloud Curls", hatReady: false, topH: 0, seatY: -17.0 },
  { id: "mohawk", label: "Action Mohawk", hatReady: false, topH: 0, seatY: -16.5 },
  { id: "pixie", label: "Pixie Tufts", hatReady: false, topH: 0, seatY: -15.0 },
  { id: "side_pony", label: "Side Ponytail", hatReady: false, topH: 0, seatY: -16.5 },
  { id: "low_bun", label: "Low Nape Bun", hatReady: false, topH: 0, seatY: -16.5 },
];
/** The stock Kip's hairstyle. */
export const KIP_DEFAULT_HAIR_ID = "short_swept";

export const kipHairStyle = (id: string | undefined | null): KipHairStyle | null => KIP_HAIRSTYLES.find((h) => h.id === id) ?? null;
/** The wig's STL (public/kip/partspec). */
export const kipHairUrl = (id: string): string => `/kip/partspec/toyventor_hair_${id}_S.stl`;

/** What a human head wears on top. `hair` is a style id; `none` is its own bare head (the child, or a test, asked for none). */
export type KipTop =
  | { kind: "hat"; hair: KipHairStyle | null }   // a hat; on a hat-ready wig it is lifted by the wig's studs, on a sculpted wig the wig stays off
  | { kind: "hair"; hair: KipHairStyle }
  | { kind: "cover"; hair: null };

/**
 * Hat first, else hair, else the smooth cover. A character that never chose hair (no `hair` key: every save made before this) gets the stock Swept style, unless it wears a hat, so a
 * toy that already had a hat looks exactly as before. `hair: "none"` is a choice and gives the smooth cover. A sculpted-top wig under a hat is dropped (a hat cannot sit on it; the demo
 * swaps to a hat-ready style, the game just keeps the hat).
 */
export function resolveKipTop(sel: { hat?: string; hair?: string }): KipTop {
  const hasHat = !!sel.hat && sel.hat !== "none";
  const chosen = sel.hair === undefined ? (hasHat ? null : kipHairStyle(KIP_DEFAULT_HAIR_ID)) : kipHairStyle(sel.hair);
  if (hasHat) return { kind: "hat", hair: chosen && chosen.hatReady ? chosen : null };
  return chosen ? { kind: "hair", hair: chosen } : { kind: "cover", hair: null };
}
