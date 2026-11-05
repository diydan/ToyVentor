// A small indoor WORKSHOP for the new-player Kip build (Dan, 2026-11-04: "lets start as a workshop, not turntable, with blueprint"). It is dressing only: a wooden floor, a back wall, a pegboard with
// tools, a workbench with a few small props, and a BLUEPRINT of Kip on the wall. The parts pile is NOT in here: the caller lays it on the floor in front of the bench.
//
// Placement (world units, Kip about 2.6 tall, the camera looks along -z with Kip at (x, 0, z), the stage's back is at negative z):
//   floor      14 wide, z - 5 to z + 2, top at y = 0.02 (polygon offset, so it never fights the world's own floor)
//   back wall  14 wide, 5 tall, front face at z - 4.6
//   workbench  centre (x - 2.3, z - 2.6), 3.4 wide, 1 deep, top at y = 1.0
//   pegboard   centre (x - 2.3, y 2.9) on the wall, with a hammer, a wrench and a saw
//   blueprint  centre (x + 3.2, y 1.75, z - 4.55), 3.6 wide, 2.7 tall: the game's camera shows the wall only up to y = 3.2 (measured 2026-11-05), so the WHOLE poster is in view, above the Dress card and clear of Kip
// Everything is built from materials made here (no game helpers), so the module has no dependencies but three. `userData` on the group carries these numbers for the caller.
//
// The blueprint FILLS IN as Kip is built (kid bench slice 2, 2026-11-05): every brick belongs to a region of the drawing (`blueprintRegion`), a region lights up as its bricks land (`regionFractions`), and
// `setBlueprintState` redraws the poster. The Dress step shows the outline only.
//
// The blueprint is drawn on a canvas. Where there is no `document` (a unit test in node) or no 2D context, the poster is a flat blueprint-blue plane: building never throws.
import * as THREE from "three";

const ORANGE = "#ff6b4a", NAVY = "#2b4c85", SKIN = "#f3ba95", YELLOW = "#ffd24d";
export const BLUEPRINT_BLUE = "#1b3a8a";
export const WORKSHOP = { floorW: 14, floorBack: 5, floorFront: 2, wallW: 14, wallH: 5, wallZ: 4.6, benchW: 3.4, benchD: 1, benchTop: 1.0, benchDX: -2.3, benchDZ: -2.6, posterW: 3.6, posterH: 2.7, posterDX: 3.2, posterY: 1.75, posterDZ: -4.55, pegDX: -2.3, pegY: 2.9 } as const;

export interface WorkshopOptions { x: number; z: number; accent?: string }

const validHex = (c: unknown): c is string => typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c);

/** The regions of the drawing: Kip's head, his torso, each arm, each leg and each shoe, plus the hat and the tail when he has them. */
export type BlueprintRegion = "head" | "hat" | "torso" | "armL" | "armR" | "legL" | "legR" | "shoeL" | "shoeR" | "tail";
export const BLUEPRINT_REGIONS: readonly BlueprintRegion[] = ["head", "hat", "torso", "armL", "armR", "legL", "legR", "shoeL", "shoeR", "tail"];
/** The regions every Kip has; the hat and the tail are drawn only when some brick belongs to them. */
export const BLUEPRINT_BASE_REGIONS: readonly BlueprintRegion[] = ["head", "torso", "armL", "armR", "legL", "legR", "shoeL", "shoeR"];
/** What a brick is, read from where it hangs in the rig (world.ts `onbPart`): pose-proof, unlike a seat's height (a part's origin is not its middle, and the rig may be caught mid-motion). */
export type BrickPart = "head" | "hat" | "tail" | "arm" | "leg" | "shoe" | "torso" | "other";

/** How much of a region is built (0 to 1); a region with no bricks is absent (so a Kip with no hat has no hat on the blueprint). */
export type BlueprintFill = Partial<Record<BlueprintRegion, number>>;
export interface BlueprintState { fill?: BlueprintFill; /** The region of the brick the child is holding: drawn dashed. */ focus?: BlueprintRegion | null }

/**
 * The region of the blueprint a brick belongs to. `side` is 0 or 1 (the arm, leg or shoe's index in the rig). A brick whose part is not known (`other`) is placed by its seat: `seat.y` is its height in stage units
 * (Kip is about 2.9 tall with a hat) and `seat.dx` its distance from his middle, so the fallback is still sensible on a rig the caller could not read.
 */
export function blueprintRegion(part: BrickPart, side: number = 0, seat?: { dx: number; y: number }): BlueprintRegion {
  const s = side === 1 ? 1 : 0;
  switch (part) {
    case "head": return "head";
    case "hat": return "hat";
    case "tail": return "tail";
    case "arm": return s ? "armR" : "armL";
    case "leg": return s ? "legR" : "legL";
    case "shoe": return s ? "shoeR" : "shoeL";
    case "torso": return "torso";
    default: {
      if (!seat || !Number.isFinite(seat.y) || !Number.isFinite(seat.dx)) return "torso";
      const h = seat.y / 2.9, right = seat.dx > 0 ? 1 : 0;
      if (h > 0.68) return "head";
      if (h > 0.38) return Math.abs(seat.dx) > 0.45 ? (right ? "armR" : "armL") : "torso";
      if (h > 0.12) return right ? "legR" : "legL";
      return right ? "shoeR" : "shoeL";
    }
  }
}

/** How much of each region is built: the share of its bricks that have landed. A region nobody has a brick for is left out. */
export function regionFractions(bricks: ReadonlyArray<{ region: BlueprintRegion; lit: boolean }>): BlueprintFill {
  const total: Partial<Record<BlueprintRegion, number>> = {}, done: Partial<Record<BlueprintRegion, number>> = {};
  for (const b of bricks) { total[b.region] = (total[b.region] ?? 0) + 1; if (b.lit) done[b.region] = (done[b.region] ?? 0) + 1; }
  const out: BlueprintFill = {};
  for (const r of BLUEPRINT_REGIONS) { const t = total[r]; if (t) out[r] = (done[r] ?? 0) / t; }
  return out;
}

/** Is the blueprint finished: Kip has a head and a torso on it and every region that has bricks is full. */
export function blueprintComplete(fill: BlueprintFill | undefined): boolean {
  if (!fill || fill.head === undefined || fill.torso === undefined) return false;
  return BLUEPRINT_REGIONS.every((r) => fill[r] === undefined || (fill[r] as number) >= 1 - 1e-9);
}

/** The rounded rectangles [x, y, width, height, radius] of each region, in the 1024 by 768 drawing (Kip's middle is at x = 470). */
const BP_CX = 470;
export const REGION_SHAPES: Readonly<Record<BlueprintRegion, ReadonlyArray<readonly [number, number, number, number, number]>>> = {
  head: [[BP_CX - 70, 165, 140, 110, 22], [BP_CX - 42, 143, 24, 22, 0], [BP_CX + 18, 143, 24, 22, 0]],   // the head and the two studs on top
  hat: [[BP_CX - 62, 90, 124, 44, 12], [BP_CX - 92, 124, 184, 16, 8]],                                    // the crown of a hat and its brim, above the studs
  torso: [[BP_CX - 80, 290, 160, 170, 24]],
  armL: [[BP_CX - 126, 296, 38, 150, 16]],
  armR: [[BP_CX + 88, 296, 38, 150, 16]],
  legL: [[BP_CX - 70, 472, 58, 150, 14]],
  legR: [[BP_CX + 12, 472, 58, 150, 14]],
  shoeL: [[BP_CX - 88, 622, 84, 40, 16]],
  shoeR: [[BP_CX + 4, 622, 84, 40, 16]],
  tail: [[BP_CX + 92, 470, 70, 26, 13], [BP_CX + 136, 438, 26, 58, 13]],                                   // a curl behind him, low on the right
};
const LIT = "rgba(155,231,255,", GOLD = "#ffd24d";

/** The blueprint: deep blue, a fine white grid, a double border, a line drawing of Kip from the front with dimension lines and labels, a title block bottom right. */
export function drawBlueprint(ctx: CanvasRenderingContext2D, w = 1024, h = 768, accent = YELLOW, state?: BlueprintState): void {
  ctx.fillStyle = BLUEPRINT_BLUE;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 1;
  for (let gx = 0; gx <= w; gx += 32) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke(); }
  for (let gy = 0; gy <= h; gy += 32) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke(); }
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 4;
  ctx.strokeRect(10, 10, w - 20, h - 20);
  ctx.lineWidth = 2;
  ctx.strokeRect(22, 22, w - 44, h - 44);

  const path = (x: number, y: number, bw: number, bh: number, r: number) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + bw - r, y); ctx.quadraticCurveTo(x + bw, y, x + bw, y + r);
    ctx.lineTo(x + bw, y + bh - r); ctx.quadraticCurveTo(x + bw, y + bh, x + bw - r, y + bh);
    ctx.lineTo(x + r, y + bh); ctx.quadraticCurveTo(x, y + bh, x, y + bh - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  };
  const cx = BP_CX;
  const fill = state?.fill ?? {};
  // each region: a fill that grows as its bricks land (gold when it is whole), then its outline; the hat and the tail only when Kip has them
  for (const region of BLUEPRINT_REGIONS) {
    const f = fill[region];
    if ((region === "hat" || region === "tail") && f === undefined) continue;
    const frac = Math.max(0, Math.min(1, Number.isFinite(f as number) ? (f as number) : 0));
    if (frac > 0) {
      ctx.fillStyle = frac >= 1 ? "rgba(255,210,77,0.55)" : `${LIT}${(0.1 + 0.5 * frac).toFixed(2)})`;
      for (const [x, y, bw, bh, r] of REGION_SHAPES[region]) { path(x, y, bw, bh, r); ctx.fill(); }
    }
    ctx.strokeStyle = frac >= 1 ? GOLD : "#ffffff";
    ctx.lineWidth = frac >= 1 ? 4 : 3;
    for (const [x, y, bw, bh, r] of REGION_SHAPES[region]) { path(x, y, bw, bh, r); ctx.stroke(); }
  }
  if (state?.focus && REGION_SHAPES[state.focus]) {                      // the brick in the child's hand belongs here: a dashed orange outline
    ctx.strokeStyle = ORANGE;
    ctx.lineWidth = 5;
    ctx.setLineDash([10, 7]);
    for (const [x, y, bw, bh, r] of REGION_SHAPES[state.focus]) { path(x - 5, y - 5, bw + 10, bh + 10, r + 4); ctx.stroke(); }
    ctx.setLineDash([]);
  }
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(cx - 26, 215, 6, 0, Math.PI * 2); ctx.stroke(); // eyes
  ctx.beginPath(); ctx.arc(cx + 26, 215, 6, 0, Math.PI * 2); ctx.stroke();

  // dimension lines: one tall line on the right with ticks, one wide line under the shoes
  ctx.lineWidth = 1.5;
  const dim = (x1: number, y1: number, x2: number, y2: number) => {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  };
  dim(cx + 190, 143, cx + 190, 662);
  dim(cx + 178, 143, cx + 202, 143); dim(cx + 178, 662, cx + 202, 662);
  dim(cx - 126, 690, cx + 126, 690);
  dim(cx - 126, 678, cx - 126, 702); dim(cx + 126, 678, cx + 126, 702);

  // labels with thin leader lines
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 20px monospace";
  const label = (text: string, tx: number, ty: number, fromX: number, fromY: number) => {
    dim(fromX, fromY, tx, ty);
    ctx.fillText(text, text === "HEAD" || text === "TORSO" || text === "ARMS" || text === "HAT" || text === "TAIL" ? tx + 6 : tx - 6 - ctx.measureText(text).width, ty + 6);
  };
  label("HEAD", cx + 78, 205, cx + 70, 215);
  label("TORSO", cx + 140, 365, cx + 80, 365);
  label("ARMS", cx + 136, 420, cx + 126, 420);
  label("LEGS", cx - 150, 540, cx - 70, 540);
  label("SHOES", cx - 150, 642, cx - 88, 642);
  if (fill.hat !== undefined) label("HAT", cx + 76, 112, cx + 62, 112);
  if (fill.tail !== undefined) label("TAIL", cx + 96, 522, cx + 120, 496);

  // the title block, bottom right
  ctx.fillStyle = validHex(accent) ? accent : YELLOW;
  ctx.fillRect(700, 614, 290, 120);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3;
  ctx.strokeRect(700, 614, 290, 120);
  ctx.fillStyle = BLUEPRINT_BLUE;
  ctx.font = "bold 64px monospace";
  ctx.fillText("KIP", 724, 676);
  ctx.font = "bold 18px monospace";
  ctx.fillText(blueprintComplete(fill) ? "BUILT!  100%" : "BLUEPRINT  1:1", 724, 712);
}

function posterTexture(accent: string): { tex: THREE.Texture; ctx: CanvasRenderingContext2D } | null {
  try {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 768;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    drawBlueprint(ctx, 1024, 768, accent);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return { tex, ctx };
  } catch {
    return null;
  }
}

/** Redraw the blueprint on the wall with this much built (and this region dashed). False when the poster is the flat fallback or the draw failed: it never throws. */
export function setBlueprintState(g: THREE.Group | null | undefined, state: BlueprintState): boolean {
  const p = g?.userData?.poster as { drawn?: boolean; ctx?: CanvasRenderingContext2D; tex?: THREE.Texture; accent?: string } | undefined;
  if (!p || !p.drawn || !p.ctx || !p.tex) return false;
  try {
    drawBlueprint(p.ctx, 1024, 768, p.accent ?? YELLOW, state);
    p.tex.needsUpdate = true;
    return true;
  } catch {
    return false;
  }
}

/** The workshop around (x, z). Never throws. */
export function buildWorkshop(opts: WorkshopOptions): THREE.Group {
  const x = Number.isFinite(opts.x) ? opts.x : 0, z = Number.isFinite(opts.z) ? opts.z : 0;
  const accent = validHex(opts.accent) ? opts.accent : YELLOW;
  const g = new THREE.Group();
  g.name = "workshop";
  g.userData.workshop = true;
  const W = WORKSHOP;

  const mats = new Map<string, THREE.MeshStandardMaterial>();
  const mat = (color: string, o: { rough?: number; offset?: boolean } = {}): THREE.MeshStandardMaterial => {
    const key = `${color}|${o.rough ?? 0.7}|${o.offset ? 1 : 0}`;
    let m = mats.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.7, metalness: 0.05 });
      if (o.offset) { m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2; }
      mats.set(key, m);
    }
    return m;
  };
  const put = (m: THREE.Mesh, px: number, py: number, pz: number, o: { cast?: boolean; name?: string } = {}): THREE.Mesh => {
    m.position.set(px, py, pz);
    m.castShadow = o.cast ?? false;
    m.receiveShadow = true;
    if (o.name) m.name = o.name;
    g.add(m);
    return m;
  };
  const box = (w: number, h: number, d: number, color: string, px: number, py: number, pz: number, o: { cast?: boolean; name?: string; rough?: number } = {}) =>
    put(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, { rough: o.rough })), px, py, pz, o);
  const cyl = (r: number, h: number, color: string, px: number, py: number, pz: number, o: { cast?: boolean; name?: string; rx?: number; rz?: number } = {}) => {
    const m = put(new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 20), mat(color)), px, py, pz, o);
    if (o.rx) m.rotation.x = o.rx;
    if (o.rz) m.rotation.z = o.rz;
    return m;
  };

  // (a) the floor: wooden planks, top at y = 0.02, a little polygon offset so the world's own floor never wins
  const woods = ["#b9824a", "#a8713f", "#c48d55"];
  for (let i = 0; i < W.floorW; i++) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(1, W.floorBack + W.floorFront), mat(woods[i % 3]!, { rough: 0.85, offset: true }));
    p.rotation.x = -Math.PI / 2;
    put(p, x - W.floorW / 2 + 0.5 + i, 0.02, z - (W.floorBack - W.floorFront) / 2, { name: "floor" });
  }

  // (b) the back wall, with a skirting board
  box(W.wallW, W.wallH, 0.2, "#7f93a8", x, W.wallH / 2, z - W.wallZ - 0.1, { name: "wall" });
  box(W.wallW, 0.26, 0.1, "#5b6b7c", x, 0.13, z - W.wallZ + 0.05, { name: "skirting" });

  // (c) the pegboard and its tools
  const pegX = x + W.pegDX, pegZ = z - W.wallZ + 0.04;
  box(3.4, 1.7, 0.08, "#c9a46a", pegX, W.pegY, pegZ, { name: "pegboard" });
  for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) box(0.07, 0.07, 0.02, "#7a5a32", pegX - 1.4 + c * 0.4, W.pegY - 0.55 + r * 0.55, pegZ + 0.05);
  const tz = pegZ + 0.1;
  // hammer: a wooden handle and a navy head
  box(0.12, 0.95, 0.1, "#9a6a36", pegX - 1.1, W.pegY - 0.05, tz, { name: "hammer" });
  box(0.55, 0.22, 0.14, NAVY, pegX - 1.1, W.pegY + 0.5, tz);
  // wrench: an orange bar with a ring at each end
  box(0.14, 1.0, 0.08, ORANGE, pegX - 0.2, W.pegY - 0.05, tz, { name: "wrench" });
  [0.55, -0.6].forEach((dy) => { const t = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.05, 8, 20), mat(ORANGE)); put(t, pegX - 0.2, W.pegY + dy, tz); });
  // saw: a yellow blade outline (four thin bars) and a skin-coloured handle
  box(1.0, 0.04, 0.05, YELLOW, pegX + 0.95, W.pegY + 0.35, tz, { name: "saw" });
  box(1.0, 0.04, 0.05, YELLOW, pegX + 0.95, W.pegY - 0.05, tz);
  box(0.04, 0.44, 0.05, YELLOW, pegX + 0.45, W.pegY + 0.15, tz);
  box(0.04, 0.44, 0.05, YELLOW, pegX + 1.45, W.pegY + 0.15, tz);
  box(0.36, 0.3, 0.08, SKIN, pegX + 1.62, W.pegY + 0.15, tz);

  // (d) the workbench: a thick top, four legs, a trim in the accent colour along the front edge, and a few props
  const bx = x + W.benchDX, bz = z + W.benchDZ, topY = W.benchTop;
  box(W.benchW, 0.14, W.benchD, "#b07a43", bx, topY - 0.07, bz, { cast: true, name: "benchtop" });
  box(W.benchW, 0.05, 0.05, accent, bx, topY - 0.025, bz + W.benchD / 2 + 0.02, { name: "benchtrim" });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.14, topY - 0.14, 0.14, "#8a5a2c", bx + sx * (W.benchW / 2 - 0.12), (topY - 0.14) / 2, bz + sz * (W.benchD / 2 - 0.12), { cast: true, name: "benchleg" });
  box(W.benchW - 0.4, 0.06, W.benchD - 0.3, "#8a5a2c", bx, 0.3, bz, { cast: true, name: "benchshelf" });
  // a mug (navy, with a handle) and a screwdriver (an orange handle and a steel shaft)
  cyl(0.13, 0.26, NAVY, bx - 1.1, topY + 0.13, bz - 0.1, { cast: true, name: "mug" });
  const mh = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.025, 8, 14), mat(NAVY));
  put(mh, bx - 0.93, topY + 0.13, bz - 0.1, { cast: true });
  cyl(0.06, 0.28, ORANGE, bx + 0.3, topY + 0.06, bz + 0.15, { cast: true, name: "screwdriver", rz: Math.PI / 2 });
  cyl(0.025, 0.3, "#c9d1da", bx + 0.58, topY + 0.06, bz + 0.15, { cast: true, rz: Math.PI / 2 });
  box(0.3, 0.2, 0.3, YELLOW, bx + 1.1, topY + 0.1, bz - 0.1, { cast: true, name: "tin" });

  // (e) the blueprint poster and its frame
  const px = x + W.posterDX, pz = z + W.posterDZ;
  const drawn = posterTexture(accent);
  const tex = drawn ? drawn.tex : null;
  const posterMat = new THREE.MeshBasicMaterial(tex ? { map: tex } : { color: BLUEPRINT_BLUE });
  put(new THREE.Mesh(new THREE.PlaneGeometry(W.posterW, W.posterH), posterMat), px, W.posterY, pz, { name: "blueprint" });
  const fw = 0.1, fz = pz - 0.02;
  box(W.posterW + fw * 2, fw, 0.06, "#8a5a2c", px, W.posterY + W.posterH / 2 + fw / 2, fz, { name: "frame" });
  box(W.posterW + fw * 2, fw, 0.06, "#8a5a2c", px, W.posterY - W.posterH / 2 - fw / 2, fz, { name: "frame" });
  box(fw, W.posterH, 0.06, "#8a5a2c", px - W.posterW / 2 - fw / 2, W.posterY, fz, { name: "frame" });
  box(fw, W.posterH, 0.06, "#8a5a2c", px + W.posterW / 2 + fw / 2, W.posterY, fz, { name: "frame" });

  g.userData.floor = { z0: z - W.floorBack, z1: z + W.floorFront, y: 0.02 };
  g.userData.bench = { x: bx, z: bz, topY, w: W.benchW, d: W.benchD };
  g.userData.poster = { x: px, y: W.posterY, z: pz, w: W.posterW, h: W.posterH, drawn: !!tex, ctx: drawn ? drawn.ctx : null, tex, accent };
  g.userData.pegboard = { x: pegX, y: W.pegY, z: pegZ };
  return g;
}

/** Take the workshop out of its scene and free every geometry, material and texture in it. Safe to call twice. */
export function disposeWorkshop(g: THREE.Group): void {
  if (!g) return;
  const geos = new Set<THREE.BufferGeometry>(), mats = new Set<THREE.Material>(), texs = new Set<THREE.Texture>();
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) geos.add(m.geometry);
    const ms = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
    for (const mm of ms) { mats.add(mm); const map = (mm as THREE.MeshBasicMaterial).map; if (map) texs.add(map); }
  });
  g.parent?.remove(g);
  geos.forEach((x) => x.dispose());
  texs.forEach((x) => x.dispose());
  mats.forEach((x) => x.dispose());
}
