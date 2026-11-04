import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { BACKDROPS, GARDEN_BACKDROP, TUCK, backdropFor, createBackdrop, disposeArtCache, layerX, layoutLayer, visibleSlice, type ArtCache, type ArtLoader } from "../src/features/game/world/runtime/backdrop";

// The Garden's parallax backdrop (docs/specs/parallax-backdrops-spec.md). The geometry is checked against numbers worked out by hand in the spec (its table
// of the visible band at the mockup's camera) and against plain trigonometry, not against the code's own unprojection.
const root = new URL("..", import.meta.url).pathname;
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

/** The game's play camera: position (x, 2.6 + dd * .24, dd), looking at (x, 1.1 + (zd - 1) * 1.2, 0), fov 36 (world.ts per-frame camera). */
function playCamera(dd: number, aspect: number, x = 22, zd = 1) {
  const cam = new THREE.PerspectiveCamera(36, aspect, 0.1, 500);
  cam.position.set(x, 2.6 + dd * 0.24, dd);
  cam.lookAt(x, 1.1 + (zd - 1) * 1.2, 0);
  cam.updateMatrixWorld();
  return cam;
}
const deg = (r: number) => (r * 180) / Math.PI;
const GROUND_EDGE = -10;

describe("the visible slice of a backdrop plane, from the live camera", () => {
  it("matches the spec's table at the mockup's camera (distance 10): z -22 shows -3.0 to +3.15, z -46 shows -9.0 to +1.8", () => {
    const cam = playCamera(10, 1.9);
    const a = visibleSlice(cam, -22, GROUND_EDGE)!;
    expect(a.ground).toBeCloseTo(-3.0, 3);
    expect(a.top).toBeCloseTo(3.15, 1);
    const b = visibleSlice(cam, -46, GROUND_EDGE)!;
    expect(b.ground).toBeCloseTo(-9.0, 3);
    expect(b.top).toBeCloseTo(1.8, 1);
  });
  it("matches plain trigonometry at other distances, including a phone's 22 where the top ray rises above the horizon", () => {
    for (const dd of [10, 14, 22, 34, 46]) {
      const cam = playCamera(dd, 0.46);
      const camY = 2.6 + dd * 0.24, pitch = Math.atan((camY - 1.1) / dd), half = (18 * Math.PI) / 180;
      for (const z of [-22, -34]) {
        const s = visibleSlice(cam, z, GROUND_EDGE)!;
        const dz = dd - z;
        expect(s.top, `dd ${dd} z ${z} top`).toBeCloseTo(camY - Math.tan(pitch - half) * dz, 3);
        expect(s.ground, `dd ${dd} z ${z} ground`).toBeCloseTo(camY - (camY / (dd - GROUND_EDGE)) * dz, 3);
      }
    }
    // the phone case is the one the mockup never saw: at distance 22 the camera looks nearly level, so the band is about twice as tall
    const phone = visibleSlice(playCamera(22, 0.46), -22, GROUND_EDGE)!, desk = visibleSlice(playCamera(10, 1.9), -22, GROUND_EDGE)!;
    expect(phone.top - phone.ground).toBeGreaterThan(1.7 * (desk.top - desk.ground));
  });
  it("the window span grows with aspect and with distance, and is centred on the camera", () => {
    const wide = visibleSlice(playCamera(10, 2.0), -22, GROUND_EDGE)!, narrow = visibleSlice(playCamera(10, 0.5), -22, GROUND_EDGE)!;
    expect(wide.xMax - wide.xMin).toBeGreaterThan(3 * (narrow.xMax - narrow.xMin));
    for (const s of [wide, narrow]) expect((s.xMin + s.xMax) / 2).toBeCloseTo(22, 3);
    const near = visibleSlice(playCamera(10, 1), -22, GROUND_EDGE)!, far = visibleSlice(playCamera(22, 1), -22, GROUND_EDGE)!;
    expect(far.xMax - far.xMin).toBeGreaterThan(near.xMax - near.xMin);
    // the span at the corners equals the horizontal field of view over the distance along the view axis, give or take pitch: check the order of magnitude
    const hfov = 2 * Math.atan(Math.tan((18 * Math.PI) / 180) * 2.0);
    expect(wide.xMax - wide.xMin).toBeGreaterThan(2 * Math.tan(hfov / 2) * (10 + 22) * 0.9);
  });
  it("follows a view offset (the title screen's showcase camera shifts the picture down) without losing the ground line", () => {
    const plain = playCamera(10, 0.6);
    const shifted = playCamera(10, 0.6);
    shifted.setViewOffset(400, 800, 0, 216, 400, 800); // as world.ts does for the showcase: the view window moves
    shifted.updateMatrixWorld();
    const a = visibleSlice(plain, -22, GROUND_EDGE)!, b = visibleSlice(shifted, -22, GROUND_EDGE)!;
    expect(b.top).not.toBeCloseTo(a.top, 1);
    expect(b.ground).toBeCloseTo(a.ground, 6); // the ground line comes from the camera's position, not from the screen
  });
  it("gives up cleanly (null) for a camera that cannot see the plane", () => {
    const away = new THREE.PerspectiveCamera(36, 1, 0.1, 500);
    away.position.set(22, 5, -60); // behind the plane, looking down -z
    away.lookAt(22, 1, -100);
    away.updateMatrixWorld();
    expect(visibleSlice(away, -22, GROUND_EDGE)).toBeNull();
    const atEdge = playCamera(10, 1);
    atEdge.position.z = GROUND_EDGE; // no run to the ground edge
    atEdge.updateMatrixWorld();
    expect(visibleSlice(atEdge, -22, GROUND_EDGE)).toBeNull();
  });
});

describe("laying a layer out: uniform scale, base on the ground line, whole art fitted to the slice", () => {
  const slice = visibleSlice(playCamera(10, 1.9), -22, GROUND_EDGE)!;
  const art = { w: 1831, h: 370 };
  const L = layoutLayer(slice, art, { fitFrac: 0.86, f: 0.65, laneSpan: 38 });

  it("sits on the ground line: the base is exactly TUCK below it, so no hairline can show", () => {
    expect(L.centreY - L.height / 2).toBeCloseTo(slice.ground - TUCK, 9);
  });
  it("fits the art's whole height to fitFrac of the slice", () => {
    expect(L.height - TUCK).toBeCloseTo((slice.top - slice.ground) * 0.86, 9);
  });
  it("never stretches: the art's own width keeps the art's own aspect, and the plane only gets wider by mirroring", () => {
    expect(L.artWidth / L.height).toBeCloseTo(art.w / art.h, 9);
    expect(L.width).toBeGreaterThanOrEqual(L.artWidth);
    expect(L.repeatX).toBeCloseTo(L.width / L.artWidth, 9);
    expect(L.offsetX).toBeCloseTo((1 - L.repeatX) / 2, 9);
  });
  it("is wide enough for the window plus the share of the camera's travel it does not follow", () => {
    const window = (slice.xMax - slice.xMin) * 1.1;
    expect(L.width).toBeGreaterThanOrEqual(window + 0.35 * 38 - 1e-9);
    // a layer pinned to the camera (f = 1) needs only the window; one fixed in the world (f = 0) needs the whole lane too
    expect(layoutLayer(slice, { w: 100, h: 100 }, { fitFrac: 1, f: 1, laneSpan: 38 }).width).toBeLessThan(layoutLayer(slice, { w: 100, h: 100 }, { fitFrac: 1, f: 0, laneSpan: 38 }).width);
  });
  it("a narrow phone window needs no mirroring, a wide desktop window does (so the second-house problem is a desktop one)", () => {
    const phone = layoutLayer(visibleSlice(playCamera(22, 0.46), -22, GROUND_EDGE)!, art, { fitFrac: 0.86, f: 0.65, laneSpan: 38 });
    const desktop = layoutLayer(visibleSlice(playCamera(10, 2.2), -22, GROUND_EDGE)!, art, { fitFrac: 0.86, f: 0.65, laneSpan: 38 });
    expect(desktop.repeatX).toBeGreaterThan(1);
    expect(phone.repeatX).toBeLessThanOrEqual(desktop.repeatX);
  });
  it("survives a degenerate slice (no height) with a minimum band instead of a zero-size or negative plane", () => {
    const flat = layoutLayer({ top: 1, ground: 1, xMin: 0, xMax: 10 }, art, { fitFrac: 0.86, f: 0.65, laneSpan: 38 });
    expect(flat.height).toBeGreaterThan(0);
    expect(Number.isFinite(flat.width) && Number.isFinite(flat.centreY)).toBe(true);
  });
});

describe("parallax: layers follow the camera by their scroll factor", () => {
  it("f = 1 is pinned to the camera, f = 0 is fixed in the world, and the lane's middle is the pivot", () => {
    expect(layerX(1, 10, 3, 41)).toBe(10);
    expect(layerX(0, 10, 3, 41)).toBe(22);
    expect(layerX(0.65, 22, 3, 41)).toBe(22);
    expect(layerX(0.65, 41, 3, 41)).toBeCloseTo(22 + 0.65 * 19, 9);
  });
  it("on screen the far layer moves least, then the mid layer, then the lane (the shift is (1 - f) of the camera's)", () => {
    const [far, mid] = GARDEN_BACKDROP.layers;
    const shift = (f: number) => (layerX(f, 34, 3, 41) - 34) - (layerX(f, 10, 3, 41) - 10); // layer minus camera, across a 24 unit camera move
    expect(Math.abs(shift(far!.f))).toBeLessThan(Math.abs(shift(mid!.f)));
    expect(Math.abs(shift(mid!.f))).toBeLessThan(24);
    expect(far!.f).toBeGreaterThan(mid!.f); // the spec: far .85, mid .65
  });
});

describe("the Garden backdrop is configured as approved (at night)", () => {
  it("has the far band at z -34 and the mid cut-out at z -22, both behind the lane props (z >= -6), far opaque and mid a cut-out", () => {
    const [far, mid] = GARDEN_BACKDROP.layers;
    expect([far!.id, mid!.id]).toEqual(["far", "mid"]);
    expect(far!.z).toBe(-34);
    expect(mid!.z).toBe(-22);
    expect(far!.alpha).toBe(false);
    expect(mid!.alpha).toBe(true);
    for (const l of GARDEN_BACKDROP.layers) expect(l.z).toBeLessThan(-6);
    expect(GARDEN_BACKDROP.groundEdgeZ).toBe(-10);
    expect([GARDEN_BACKDROP.laneLo, GARDEN_BACKDROP.laneHi]).toEqual([3, 41]);
  });
  it("is the Garden's night backdrop, unchanged: the day one is new", () => {
    expect(BACKDROPS.garden!.night).toBe(GARDEN_BACKDROP);
    expect(BACKDROPS.garden!.day).not.toBe(GARDEN_BACKDROP);
  });
});

/** Width and height of a WebP file from its header (lossy, lossless or extended), or null. */
function webpSize(file: string): { w: number; h: number; alpha: boolean } | null {
  const b = readFileSync(file);
  if (b.length < 30 || b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WEBP") return null;
  const kind = b.toString("ascii", 12, 16);
  if (kind === "VP8X") return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3), alpha: (b[20]! & 0x10) !== 0 };
  if (kind === "VP8 ") return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff, alpha: false };
  if (kind === "VP8L") { const v = b.readUInt32LE(21); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1, alpha: true }; }
  return null;
}
const ROOT = process.cwd();
/** The file behind an imported `?url` (vitest gives the path inside the project). */
const fileOf = (url: string) => join(ROOT, url.replace(/^\/@fs/, "").replace(/\?.*$/, "").replace(/^\//, ""));

describe("every outdoor world has a day and a night backdrop (docs/specs/environment-spec.md)", () => {
  const WORLDS = ["garden", "sky", "beach", "snow", "junk"];
  it("exactly the five outdoor worlds have one, each in both looks (the Toy Room keeps its flat wall and its 3D props, as decided in the mockup review)", () => {
    expect(Object.keys(BACKDROPS).sort()).toEqual([...WORLDS].sort());
    for (const w of WORLDS) expect(Object.keys(BACKDROPS[w]!).sort(), w).toEqual(["day", "night"]);
    expect(BACKDROPS.room).toBeUndefined();
  });
  it("is laid out like the approved Garden everywhere: far band and mid cut-out behind the lane, far opaque and mid a cut-out, the same lane and ground line", () => {
    for (const w of WORLDS) for (const look of ["day", "night"] as const) {
      const b = BACKDROPS[w]![look];
      expect(b.layers.map((l) => l.id), `${w} ${look}`).toEqual(["far", "mid"]);
      const [far, mid] = b.layers;
      expect(far!.z).toBe(-34); expect(mid!.z).toBe(-22);
      expect(far!.f).toBe(0.85); expect(mid!.f).toBe(0.65);
      expect(far!.alpha).toBe(false); expect(mid!.alpha).toBe(true);
      expect(far!.fitFrac).toBe(1);
      expect(mid!.fitFrac).toBeGreaterThan(0.3); expect(mid!.fitFrac).toBeLessThanOrEqual(1);
      expect([b.laneLo, b.laneHi, b.groundEdgeZ]).toEqual([3, 41, -10]);
    }
  });
  it("a world's day and night differ in the far band (a different picture), and share one mid cut-out lit differently: white by day, cooler by night", () => {
    for (const w of WORLDS) {
      const { day, night } = BACKDROPS[w]!;
      expect(day.layers[0]!.url, `${w} far`).not.toBe(night.layers[0]!.url);
      expect(day.layers[1]!.url, `${w} mid`).toBe(night.layers[1]!.url);
      expect(day.layers[1]!.tint, `${w} day tint`).toBe(0xffffff);
      const t = night.layers[1]!.tint;
      expect(t, `${w} night tint`).not.toBe(0xffffff);
      expect(t & 255, `${w} night tint: blue stays high`).toBeGreaterThan((t >> 16) & 255);        // cooler: more blue than red
    }
    expect(BACKDROPS.garden!.night.layers[1]!.tint).toBe(0xbfc8ff);                              // the approved Garden mid, as it was
    expect(BACKDROPS.garden!.day.layers[1]!.url).toBe(BACKDROPS.garden!.night.layers[1]!.url);
  });
  it("no two worlds share a far picture", () => {
    const urls = WORLDS.flatMap((w) => ["day", "night"].map((l) => BACKDROPS[w]![l as "day"]!.layers[0]!.url));
    expect(new Set(urls).size).toBe(urls.length);
  });
  it("every picture exists, the far bands are 8:1 and at most 4096 wide (the widest texture every phone GPU takes), and the mids are real cut-outs with an alpha channel", () => {
    for (const w of WORLDS) for (const look of ["day", "night"] as const) {
      const [far, mid] = BACKDROPS[w]![look].layers;
      const ff = fileOf(far!.url), mf = fileOf(mid!.url);
      expect(existsSync(ff), `${w} ${look} far: ${ff}`).toBe(true);
      expect(existsSync(mf), `${w} mid: ${mf}`).toBe(true);
      const fs = webpSize(ff)!, ms = webpSize(mf)!;
      expect(fs.w, `${w} ${look} far width`).toBeLessThanOrEqual(4096);
      expect(fs.w / fs.h, `${w} ${look} far shape`).toBeGreaterThan(7);
      expect(fs.w / fs.h).toBeLessThan(8.5);
      expect(ms.alpha, `${w} mid alpha`).toBe(true);
      expect(ms.w, `${w} mid width`).toBeLessThanOrEqual(4096 + 512);
      expect(ms.w / ms.h, `${w} mid shape`).toBeGreaterThan(3);
    }
  });
  it("backdropFor gives the world's backdrop in the look asked for, and nothing for the Toy Room, an unknown world or a world with no look", () => {
    for (const w of WORLDS) { expect(backdropFor(w, "day")).toBe(BACKDROPS[w]!.day); expect(backdropFor(w, "night")).toBe(BACKDROPS[w]!.night); }
    for (const [t, l] of [["room", "day"], ["room", "night"], ["volcano", "day"], ["garden", ""], ["garden", "dusk"], ["garden", "DAY"], ["", "day"], ["toString", "day"], ["__proto__", "night"]] as const) expect(backdropFor(t, l), `${t}/${l}`).toBeNull();
  });
});

// ---- the THREE objects ----------------------------------------------------------------------------------------------------------
const art = (w: number, h: number) => ({ texture: new THREE.Texture(), width: w, height: h });
const sizes: Record<string, [number, number]> = { far: [4096, 542], mid: [1831, 370] };
const okLoader = (): ArtLoader => async (url) => { const k = url.includes("mid") ? "mid" : "far"; return art(...sizes[k]!); };
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("createBackdrop: nothing is added until every image is in, and it can always be let go", () => {
  it("adds nothing while loading, then both planes and one onReady", async () => {
    const parent = new THREE.Group();
    const onReady = vi.fn();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const b = createBackdrop({ spec: GARDEN_BACKDROP, parent, onReady, load: async (u) => { await gate; return okLoader()(u); } });
    await tick();
    expect(b.ready).toBe(false);
    expect(parent.children).toHaveLength(0);
    expect(onReady).not.toHaveBeenCalled();
    release();
    await tick(); await tick();
    expect(b.ready).toBe(true);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(parent.children).toHaveLength(1);
    expect(b.layers.map((l) => l.id)).toEqual(["far", "mid"]);
  });
  it("builds the planes the way the spec says: no fog, no shadows, far opaque and writing depth, mid a cut-out that does not, a tap never lands on them", async () => {
    const parent = new THREE.Group();
    const b = createBackdrop({ spec: GARDEN_BACKDROP, parent, load: okLoader() });
    await tick(); await tick();
    const [far, mid] = b.layers.map((l) => l.mesh);
    for (const m of [far!, mid!]) {
      const mat = m.material as THREE.MeshBasicMaterial;
      expect(mat.fog).toBe(false);
      expect(mat.toneMapped).toBe(false);
      expect(m.castShadow || m.receiveShadow).toBe(false);
      expect(m.frustumCulled).toBe(false);
      expect(mat.map!.colorSpace).toBe(THREE.SRGBColorSpace);
      expect(mat.map!.wrapS).toBe(THREE.MirroredRepeatWrapping);
      expect(mat.map!.anisotropy).toBeLessThanOrEqual(4);
      const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, 10), new THREE.Vector3(0, 0, -1));
      m.position.set(0, 0, -5); m.updateMatrixWorld(); m.scale.set(100, 100, 1); m.updateMatrixWorld();
      expect(ray.intersectObject(m, false)).toHaveLength(0);
      expect(m.userData.noPick).toBe(true);
    }
    expect((far!.material as THREE.MeshBasicMaterial).transparent).toBe(false);
    expect((far!.material as THREE.MeshBasicMaterial).depthWrite).toBe(true);
    expect((mid!.material as THREE.MeshBasicMaterial).transparent).toBe(true);
    expect((mid!.material as THREE.MeshBasicMaterial).depthWrite).toBe(false);
  });
  it("lays each plane out from the camera: the base on the ground line, uniform scale, following the camera by f", async () => {
    const parent = new THREE.Group();
    const b = createBackdrop({ spec: GARDEN_BACKDROP, parent, load: okLoader() });
    await tick(); await tick();
    for (const cam of [playCamera(10, 1.9, 8), playCamera(22, 0.46, 30), playCamera(46, 1.9, 22)]) {
      b.update(cam);
      for (const { id, mesh } of b.layers) {
        const spec = GARDEN_BACKDROP.layers.find((l) => l.id === id)!;
        const s = visibleSlice(cam, spec.z, GROUND_EDGE)!;
        expect(mesh.visible).toBe(true);
        expect(mesh.position.y - mesh.scale.y / 2, `${id} base`).toBeCloseTo(s.ground - TUCK, 6);
        expect(mesh.position.z).toBe(spec.z);
        expect(mesh.position.x).toBeCloseTo(layerX(spec.f, cam.position.x, 3, 41), 9);
        const map = (mesh.material as THREE.MeshBasicMaterial).map!;
        const [w, h] = sizes[id]!;
        expect((mesh.scale.x / map.repeat.x) / mesh.scale.y, `${id} aspect`).toBeCloseTo(w / h, 6); // art never stretched, however wide the plane
      }
    }
  });
  it("one image failing means nothing is added and onFail runs once (the world keeps its old hills)", async () => {
    const parent = new THREE.Group();
    const onFail = vi.fn(), onReady = vi.fn();
    const b = createBackdrop({ spec: GARDEN_BACKDROP, parent, onFail, onReady, load: async (u) => { if (u.includes("mid")) throw new Error("404"); return okLoader()(u); } });
    await tick(); await tick();
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(onReady).not.toHaveBeenCalled();
    expect(b.ready).toBe(false);
    expect(parent.children).toHaveLength(0);
    b.update(playCamera(10, 1.9)); // a failed backdrop is inert
    expect(b.layers).toHaveLength(0);
  });
  it("disposing while loading adds nothing later and frees what arrived; disposing twice is fine", async () => {
    const parent = new THREE.Group();
    const onReady = vi.fn(), onFail = vi.fn();
    const arrived: THREE.Texture[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const b = createBackdrop({ spec: GARDEN_BACKDROP, parent, onReady, onFail, load: async (u) => { await gate; const a = await okLoader()(u); arrived.push(a.texture); return a; } });
    b.dispose(); b.dispose();
    release();
    await tick(); await tick();
    expect(parent.children).toHaveLength(0);
    expect(onReady).not.toHaveBeenCalled();
    expect(onFail).not.toHaveBeenCalled();
    expect(arrived).toHaveLength(2);
    // freed: THREE marks a disposed texture by dispatching "dispose"; calling it again must be harmless
    expect(() => arrived.forEach((t) => t.dispose())).not.toThrow();
  });
  it("disposing after it is built takes the planes out of the scene and frees every texture, geometry and material", async () => {
    const parent = new THREE.Group();
    const b = createBackdrop({ spec: GARDEN_BACKDROP, parent, load: okLoader() });
    await tick(); await tick();
    const meshes = b.layers.map((l) => l.mesh);
    const spies = meshes.flatMap((m) => [vi.spyOn((m.material as THREE.MeshBasicMaterial).map!, "dispose"), vi.spyOn(m.geometry, "dispose"), vi.spyOn(m.material as THREE.Material, "dispose")]);
    b.dispose();
    expect(parent.children).toHaveLength(0);
    for (const s of spies) expect(s).toHaveBeenCalledTimes(1);
    b.dispose();
    for (const s of spies) expect(s).toHaveBeenCalledTimes(1);
    b.update(playCamera(10, 1.9)); // inert after dispose
  });
  it("hides a plane for a frame in which the camera cannot see it, instead of showing it in the wrong place", async () => {
    const parent = new THREE.Group();
    const b = createBackdrop({ spec: GARDEN_BACKDROP, parent, load: okLoader() });
    await tick(); await tick();
    const away = new THREE.PerspectiveCamera(36, 1, 0.1, 500);
    away.position.set(22, 5, -60); away.lookAt(22, 1, -100); away.updateMatrixWorld();
    b.update(away);
    for (const l of b.layers) expect(l.mesh.visible).toBe(false);
  });
});

describe("a rebuilt world must not flash the old hills: loaded art is kept, and the planes are placed the moment they are ready", () => {
  const micro = async (n = 8) => { for (let i = 0; i < n; i++) await Promise.resolve(); };
  it("loads each image once per runtime, however many times the world is rebuilt", async () => {
    const cache: ArtCache = new Map();
    const calls: string[] = [];
    const load: ArtLoader = async (u) => { calls.push(u); return okLoader()(u); };
    const a = createBackdrop({ spec: GARDEN_BACKDROP, parent: new THREE.Group(), load, cache });
    await tick();
    a.dispose();
    const b = createBackdrop({ spec: GARDEN_BACKDROP, parent: new THREE.Group(), load, cache });
    await tick();
    expect(b.ready).toBe(true);
    expect(calls).toHaveLength(2);
  });
  it("a rebuild is ready within the same tick (microtasks only, before any frame), so the old hills never show", async () => {
    const cache: ArtCache = new Map();
    const first = createBackdrop({ spec: GARDEN_BACKDROP, parent: new THREE.Group(), load: okLoader(), cache });
    await tick();
    first.dispose();
    const parent = new THREE.Group();
    const second = createBackdrop({ spec: GARDEN_BACKDROP, parent, load: okLoader(), cache });
    await micro(); // no setTimeout, no frame: only promise jobs
    expect(second.ready).toBe(true);
    expect(parent.children).toHaveLength(1);
  });
  it("does not keep a failed load, so the next build tries again", async () => {
    const cache: ArtCache = new Map();
    let fail = true;
    const calls: string[] = [];
    const load: ArtLoader = async (u) => { calls.push(u); if (fail && u.includes("mid")) throw new Error("offline"); return okLoader()(u); };
    const a = createBackdrop({ spec: GARDEN_BACKDROP, parent: new THREE.Group(), load, cache, onFail: () => {} });
    await tick(); await tick();
    expect(a.ready).toBe(false);
    fail = false;
    const b = createBackdrop({ spec: GARDEN_BACKDROP, parent: new THREE.Group(), load, cache });
    await tick(); await tick();
    expect(b.ready).toBe(true);
    expect(calls.filter((u) => u.includes("mid"))).toHaveLength(2); // asked again
    expect(calls.filter((u) => !u.includes("mid"))).toHaveLength(1); // the good one was kept
  });
  it("a cached texture outlives the backdrop that used it, and is freed only with the cache", async () => {
    const cache: ArtCache = new Map();
    const b = createBackdrop({ spec: GARDEN_BACKDROP, parent: new THREE.Group(), load: okLoader(), cache });
    await tick();
    const maps = b.layers.map((l) => (l.mesh.material as THREE.MeshBasicMaterial).map!);
    const spies = maps.map((m) => vi.spyOn(m, "dispose"));
    b.dispose();
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    disposeArtCache(cache);
    await tick();
    for (const s of spies) expect(s).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(0);
  });
  it("sets a texture up once: a rebuild does not make the GPU upload it again", async () => {
    const cache: ArtCache = new Map();
    const a = createBackdrop({ spec: GARDEN_BACKDROP, parent: new THREE.Group(), load: okLoader(), cache });
    await tick();
    const tex = (a.layers[0]!.mesh.material as THREE.MeshBasicMaterial).map!;
    const v = tex.version;
    a.dispose();
    const b = createBackdrop({ spec: GARDEN_BACKDROP, parent: new THREE.Group(), load: okLoader(), cache });
    await tick();
    expect((b.layers[0]!.mesh.material as THREE.MeshBasicMaterial).map).toBe(tex);
    expect(tex.version).toBe(v);
  });
  it("with a camera it lays the planes out BEFORE it says ready, so the caller hides the old scenery only when the new is already in place", async () => {
    const parent = new THREE.Group();
    const cam = playCamera(10, 1.9, 22);
    const seen: Array<{ visible: boolean; base: number; ground: number }[]> = [];
    const b = createBackdrop({
      spec: GARDEN_BACKDROP, parent, load: okLoader(), camera: cam,
      onReady: () => seen.push(b.layers.map(({ id, mesh }) => ({ visible: mesh.visible, base: mesh.position.y - mesh.scale.y / 2, ground: visibleSlice(cam, GARDEN_BACKDROP.layers.find((l) => l.id === id)!.z, GROUND_EDGE)!.ground - TUCK }))),
    });
    await tick(); await tick();
    expect(seen).toHaveLength(1);
    for (const l of seen[0]!) { expect(l.visible).toBe(true); expect(l.base).toBeCloseTo(l.ground, 6); }
  });
  it("without a camera it still works (the first frame's update places it)", async () => {
    const parent = new THREE.Group();
    const b = createBackdrop({ spec: GARDEN_BACKDROP, parent, load: okLoader() });
    await tick(); await tick();
    expect(b.layers.every((l) => !l.mesh.visible)).toBe(true);
    b.update(playCamera(10, 1.9));
    expect(b.layers.every((l) => l.mesh.visible)).toBe(true);
  });
});

describe("the baked art is within budget", () => {
  /** Width and height of a WebP, and whether it carries alpha, read from the file header (RIFF/WEBP with a VP8 or VP8X chunk). */
  function webp(path: string) {
    const b = readFileSync(join(root, path));
    expect(b.toString("ascii", 0, 4)).toBe("RIFF");
    expect(b.toString("ascii", 8, 12)).toBe("WEBP");
    const kind = b.toString("ascii", 12, 16);
    if (kind === "VP8X") return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3), alpha: (b[20]! & 0x10) !== 0 };
    if (kind === "VP8 ") return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff, alpha: false };
    throw new Error(`unexpected WebP chunk ${kind}`);
  }
  const A = "src/features/game/world/runtime/assets/";
  it("the far band is an opaque 4096 px wide ultra-wide strip (4096 is the widest texture every phone GPU takes)", () => {
    const f = webp(A + "garden-far-night.webp");
    expect(f.w).toBeLessThanOrEqual(4096);
    expect(f.w / f.h).toBeGreaterThan(7);
    expect(f.alpha).toBe(false);
  });
  it("the mid band is a real cut-out (an alpha channel, not a black surround keyed at load) under 2048 px wide", () => {
    const m = webp(A + "garden-mid.webp");
    expect(m.alpha).toBe(true);
    expect(m.w).toBeLessThanOrEqual(2048);
    expect(m.w / m.h).toBeGreaterThan(4);
  });
  it("both together are well under the spec's budget (about 12 MB for six themes of three layers)", () => {
    const bytes = ["garden-far-night.webp", "garden-mid.webp"].reduce((n, f) => n + statSync(join(root, A + f)).size, 0);
    expect(bytes).toBeLessThan(1_000_000);
  });
});

describe("world.ts wiring (the outdoor worlds in the look they are built in, with the old hills as the fallback)", () => {
  const world = read("src/features/game/world/runtime/world.ts");
  it("shares one art cache per runtime, hands the live camera in for an immediate layout, and frees the cache with the runtime", () => {
    expect(world).toMatch(/var bdArt: ArtCache=new Map\(\)/);
    expect(world).toMatch(/cache:bdArt,camera:camera/);
    expect(world).toMatch(/disposeArtCache\(bdArt\)/);
  });
  it("builds a backdrop for a world that has one, and keeps the old hills until the images are in", () => {
    expect(world).toMatch(/from "\.\/backdrop"/);
    expect(world).toContain('var bd=backdropFor(R.theme||id,R.look||"");if(bd){');
    expect(world).not.toMatch(/BACKDROPS\[/);
    expect(world).toMatch(/createBackdrop\(/);
    expect(world).toMatch(/onReady/);
  });
  it("lays the backdrop out every frame from the live camera, and lets go of it when the world is rebuilt", () => {
    expect(world).toMatch(/W\.backdrop\.update\(camera\)/);
    expect(world).toMatch(/W\.backdrop\.dispose\(\)/);
  });
});
