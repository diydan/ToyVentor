// A small indoor WORKSHOP for the new-player Kip build (Dan, 2026-11-04: "lets start as a workshop, not turntable, with blueprint"). It is dressing only: a wooden floor, a back wall, a pegboard with
// tools, a workbench with a few small props, and a BLUEPRINT of Kip on the wall. The parts pile is NOT in here: the caller lays it on the floor in front of the bench.
//
// Placement (world units, Kip about 2.6 tall, the camera looks along -z with Kip at (x, 0, z), the stage's back is at negative z):
//   floor      14 wide, z - 5 to z + 2, top at y = 0.02 (polygon offset, so it never fights the world's own floor)
//   back wall  14 wide, 5 tall, front face at z - 4.6
//   workbench  centre (x - 2.3, z - 2.6), 3.4 wide, 1 deep, top at y = 1.0
//   pegboard   centre (x - 2.3, y 2.9) on the wall, with a hammer, a wrench and a saw
//   blueprint  centre (x + 1.6, y 2.6, z - 4.55), 4.2 wide, 3 tall
// Everything is built from materials made here (no game helpers), so the module has no dependencies but three. `userData` on the group carries these numbers for the caller.
//
// The blueprint is drawn on a canvas. Where there is no `document` (a unit test in node) or no 2D context, the poster is a flat blueprint-blue plane: building never throws.
import * as THREE from "three";

const ORANGE = "#ff6b4a", NAVY = "#2b4c85", SKIN = "#f3ba95", YELLOW = "#ffd24d";
export const BLUEPRINT_BLUE = "#1b3a8a";
export const WORKSHOP = { floorW: 14, floorBack: 5, floorFront: 2, wallW: 14, wallH: 5, wallZ: 4.6, benchW: 3.4, benchD: 1, benchTop: 1.0, benchDX: -2.3, benchDZ: -2.6, posterW: 4.2, posterH: 3, posterDX: 1.6, posterY: 2.6, posterDZ: -4.55, pegDX: -2.3, pegY: 2.9 } as const;

export interface WorkshopOptions { x: number; z: number; accent?: string }

const validHex = (c: unknown): c is string => typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c);

/** The blueprint: deep blue, a fine white grid, a double border, a line drawing of Kip from the front with dimension lines and labels, a title block bottom right. */
export function drawBlueprint(ctx: CanvasRenderingContext2D, w = 1024, h = 768, accent = YELLOW): void {
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

  const rr = (x: number, y: number, bw: number, bh: number, r: number) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + bw - r, y); ctx.quadraticCurveTo(x + bw, y, x + bw, y + r);
    ctx.lineTo(x + bw, y + bh - r); ctx.quadraticCurveTo(x + bw, y + bh, x + bw - r, y + bh);
    ctx.lineTo(x + r, y + bh); ctx.quadraticCurveTo(x, y + bh, x, y + bh - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.stroke();
  };
  const cx = 470;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3;
  rr(cx - 70, 165, 140, 110, 22);                    // head
  ctx.strokeRect(cx - 42, 143, 24, 22);              // the two studs on top
  ctx.strokeRect(cx + 18, 143, 24, 22);
  ctx.beginPath(); ctx.arc(cx - 26, 215, 6, 0, Math.PI * 2); ctx.stroke(); // eyes
  ctx.beginPath(); ctx.arc(cx + 26, 215, 6, 0, Math.PI * 2); ctx.stroke();
  rr(cx - 80, 290, 160, 170, 24);                    // torso
  rr(cx - 126, 296, 38, 150, 16);                    // arms
  rr(cx + 88, 296, 38, 150, 16);
  rr(cx - 70, 472, 58, 150, 14);                     // legs
  rr(cx + 12, 472, 58, 150, 14);
  rr(cx - 88, 622, 84, 40, 16);                      // shoes
  rr(cx + 4, 622, 84, 40, 16);

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
    ctx.fillText(text, text === "HEAD" || text === "TORSO" || text === "ARMS" ? tx + 6 : tx - 6 - ctx.measureText(text).width, ty + 6);
  };
  label("HEAD", cx + 78, 205, cx + 70, 215);
  label("TORSO", cx + 140, 365, cx + 80, 365);
  label("ARMS", cx + 136, 420, cx + 126, 420);
  label("LEGS", cx - 150, 540, cx - 70, 540);
  label("SHOES", cx - 150, 642, cx - 88, 642);

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
  ctx.fillText("BLUEPRINT  1:1", 724, 712);
}

function posterTexture(accent: string): THREE.Texture | null {
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
    return tex;
  } catch {
    return null;
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
  const tex = posterTexture(accent);
  const posterMat = new THREE.MeshBasicMaterial(tex ? { map: tex } : { color: BLUEPRINT_BLUE });
  put(new THREE.Mesh(new THREE.PlaneGeometry(W.posterW, W.posterH), posterMat), px, W.posterY, pz, { name: "blueprint" });
  const fw = 0.1, fz = pz - 0.02;
  box(W.posterW + fw * 2, fw, 0.06, "#8a5a2c", px, W.posterY + W.posterH / 2 + fw / 2, fz, { name: "frame" });
  box(W.posterW + fw * 2, fw, 0.06, "#8a5a2c", px, W.posterY - W.posterH / 2 - fw / 2, fz, { name: "frame" });
  box(fw, W.posterH, 0.06, "#8a5a2c", px - W.posterW / 2 - fw / 2, W.posterY, fz, { name: "frame" });
  box(fw, W.posterH, 0.06, "#8a5a2c", px + W.posterW / 2 + fw / 2, W.posterY, fz, { name: "frame" });

  g.userData.floor = { z0: z - W.floorBack, z1: z + W.floorFront, y: 0.02 };
  g.userData.bench = { x: bx, z: bz, topY, w: W.benchW, d: W.benchD };
  g.userData.poster = { x: px, y: W.posterY, z: pz, w: W.posterW, h: W.posterH, drawn: !!tex };
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
