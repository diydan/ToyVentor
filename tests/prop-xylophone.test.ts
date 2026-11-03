// The xylophone in the prop fx: tapping a bar rings that bar's note and nothing else; tapping the frame is a tap on the prop; `strike` rings a bar from the outside (Kip's mallet).
import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tones: Array<[number, number, number, string]> = [];
vi.mock("../src/features/game/world/runtime/audio", () => ({
  sfx: new Proxy({}, { get: () => () => {} }),
  sound: false,
  tone: (f: number, delay: number, dur: number, type: string) => { tones.push([f, delay, dur, type]); },
}));

import { PROP_SPECS, createPropFx } from "../src/features/game/world/runtime/propReactions";
import { BAR_COUNT, XYLO_NOTES, barIndexOf, buildXylophone } from "../src/features/game/world/runtime/xylophone";
import { PROP_LANG_KEY } from "../src/lib/propSpeech";
import { resetVoiceBackoff } from "../src/lib/propVoice";

beforeEach(() => {
  tones.length = 0;
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, String(v)), removeItem: (k: string) => void map.delete(k), clear: () => map.clear(), key: () => null, length: 0 });
  localStorage.setItem(PROP_LANG_KEY, "en");
  resetVoiceBackoff();
});

function room(onTap?: (i: unknown) => void) {
  const world = new THREE.Group();
  const toast = vi.fn();
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400 }) } as unknown as HTMLElement;
  const fx = createPropFx({ root: () => world, camera: () => new THREE.PerspectiveCamera(), canvas, toast, boostWindmill: () => {}, reduced: () => false, canSpeak: () => false, onTap: onTap as never });
  const g = buildXylophone(5, -2);
  world.add(g);
  const inst = fx.register("xylophone", [g])!;
  g.updateMatrixWorld(true);
  return { fx, toast, inst, g };
}
/** A ray from the front at the world position of a mesh. */
const rayAt = (m: THREE.Object3D) => {
  m.updateWorldMatrix(true, false);
  const p = m.getWorldPosition(new THREE.Vector3());
  const up = new THREE.Vector3(0, 1, 0).transformDirection(m.matrixWorld);          // straight down onto the face the mesh shows the camera (a bar's top; a rail's top)
  return new THREE.Raycaster(p.clone().addScaledVector(up, 10), up.clone().negate());
};
const barMesh = (g: THREE.Group, i: number) => (g.userData.bars[i] as THREE.Group).children[0]!;
const frameMesh = (g: THREE.Group) => { let f: THREE.Object3D | null = null; g.traverse((o) => { if (!f && (o as THREE.Mesh).isMesh && barIndexOf(o) === null && (o as THREE.Mesh).geometry.type === "ExtrudeGeometry") f = o; }); return f!; };

describe("the xylophone prop", () => {
  it("is a real prop with a name, a colour and a chime", () => {
    expect(PROP_SPECS.xylophone).toMatchObject({ noun: "xylophone", color: "colorful", use: "chime" });
  });

  it("a tap on a bar rings that bar's note (and a bright overtone), and does not name the prop or count as a tap on it", () => {
    const onTap = vi.fn();
    const c = room(onTap);
    for (const i of [0, 3, 7]) {
      tones.length = 0;
      expect(c.fx.tap(rayAt(barMesh(c.g, i)))).toBe(true);
      expect(tones.map((t) => t[0]), `bar ${i}`).toEqual([XYLO_NOTES[i], XYLO_NOTES[i]! * 3]);
      expect(tones[0]![3]).toBe("sine");
    }
    expect(c.toast).not.toHaveBeenCalled();
    expect(c.inst.taps).toBe(0);
    expect(onTap).not.toHaveBeenCalled();                                  // Kip is not sent over by a bar tap
  });

  it("the tapped bar dips (its own animation runs), and only that bar", () => {
    const c = room();
    c.fx.tap(rayAt(barMesh(c.g, 4)));
    let t = 0, moved4 = 0, moved2 = 0;
    for (let i = 0; i < 40; i++) { t += 1 / 60; c.fx.update(1 / 60, t); moved4 = Math.max(moved4, Math.abs((c.g.userData.bars[4] as THREE.Group).position.y - 0.04)); moved2 = Math.max(moved2, Math.abs((c.g.userData.bars[2] as THREE.Group).position.y - 0.04)); }
    expect(moved4).toBeGreaterThan(0.02);
    expect(moved2).toBe(0);
  });

  it("a tap on the frame is a tap on the prop: it names itself, chimes, counts and tells the world", () => {
    const onTap = vi.fn();
    const c = room(onTap);
    expect(c.fx.tap(rayAt(frameMesh(c.g)))).toBe(true);
    expect(c.toast).toHaveBeenCalledWith("Colorful xylophone");
    expect(c.inst.taps).toBe(1);
    expect(onTap).toHaveBeenCalledTimes(1);
    const chime = tones.filter((t) => t[3] === "sine");
    expect(chime.map((t) => t[0])).toEqual([262, 330, 392, 523]);                                       // the chime: a rising arpeggio
    expect(chime.map((t) => +t[1].toFixed(2))).toEqual([0, 0.09, 0.18, 0.27]);                          // one note after another
  });

  it("strike rings a bar from outside with its note and returns the pitch; a bar that is not there does nothing", () => {
    const c = room();
    expect(c.fx.strike(c.inst, 6)).toBe(XYLO_NOTES[6]);
    expect(tones.map((t) => t[0])).toEqual([XYLO_NOTES[6], XYLO_NOTES[6]! * 3]);
    tones.length = 0;
    for (const i of [-1, BAR_COUNT, 2.5]) expect(c.fx.strike(c.inst, i)).toBeNull();
    expect(tones).toHaveLength(0);
  });

  it("strike on a prop without bars does nothing", () => {
    const c = room();
    const other = new THREE.Group();
    other.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
    const lamp = c.fx.register("cushions", [other])!;
    expect(c.fx.strike(lamp, 0)).toBeNull();
    expect(tones).toHaveLength(0);
  });
});

/**
 * What a child's finger finds on the xylophone: sweep a fine grid of screen positions across its whole footprint (the box around it, as the camera sees it), tap each through the real
 * prop code, and count what answered: a bar rang (a note), the frame answered (the prop was tapped: it names itself and Kip plays), or nothing (the finger was beside it).
 */
function sweep(camera: THREE.PerspectiveCamera) {
  const c = room();
  camera.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(c.g);
  const ndc = Array.from({ length: 8 }, (_, k) => new THREE.Vector3(k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z).project(camera));
  const x0 = Math.min(...ndc.map((v) => v.x)), x1 = Math.max(...ndc.map((v) => v.x)), y0 = Math.min(...ndc.map((v) => v.y)), y1 = Math.max(...ndc.map((v) => v.y));
  const N = 90;
  let bar = 0, frame = 0, none = 0, seenBar = 0, seenFrame = 0;
  const ray = new THREE.Raycaster();
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    ray.setFromCamera(new THREE.Vector2(x0 + ((i + 0.5) / N) * (x1 - x0), y0 + ((j + 0.5) / N) * (y1 - y0)), camera);
    const taps = c.inst.taps, notes = tones.length;
    const seen = ray.intersectObject(c.g, true).find((h) => !h.object.userData.hitProxy && (h.object as THREE.Mesh).isMesh);   // what the eye sees under the finger (the invisible box does not count)
    if (seen) { if (barIndexOf(seen.object) !== null) seenBar++; else seenFrame++; }
    c.fx.tap(ray);
    if (tones.length > notes && c.inst.taps === taps) bar++;
    else if (c.inst.taps > taps) frame++;
    else none++;
    tones.length = 0;
  }
  return { bar, frame, none, frameShare: frame / (bar + frame), seenBar, seenFrame, seenFrameShare: seenFrame / (seenBar + seenFrame) };
}
/** The game's view of the Toy Room, near enough: a little above and well back, looking at the middle of the xylophone. */
function gameCamera(g: THREE.Object3D) {
  const cam = new THREE.PerspectiveCamera(38, 390 / 844, 0.1, 200);
  const at = g.getWorldPosition(new THREE.Vector3());
  cam.position.set(at.x - 1.9, 3.6, at.z + 10.5);
  cam.lookAt(at.x - 0.6, 1.1, at.z);
  return cam;
}

describe("how big a target the frame is (the tap that starts Kip's tune)", () => {
  const c = room();
  const s = sweep(gameCamera(c.g));
  it("of what the eye sees on the xylophone, a good half is frame (the base plank, legs and rails) and the rest bars: a tap lands on the frame as often as on a bar", () => {
    expect(s.seenFrameShare).toBeGreaterThan(0.5);                         // before the plank it was 0.22: a child hit a bar almost every time and never started the tune
    expect(s.seenFrameShare).toBeLessThan(0.75);                          // and the bars stay the main thing to play
  });
  it("the bars are still easy to hit: they are a share of the footprint they always were", () => {
    expect(s.bar).toBeGreaterThan(1200);
    expect(s.bar / (s.bar + s.frame + s.none)).toBeGreaterThan(0.12);
  });
  it("every tap that lands on something visible answers: a bar rings or the frame starts the tune, never nothing", () => {
    expect(s.seenBar + s.seenFrame).toBeGreaterThan(2500);
    expect(s.bar + s.frame + s.none).toBe(90 * 90);
    expect(s.bar).toBeGreaterThanOrEqual(s.seenBar);                       // every visible bar pixel rang
    expect(s.frame).toBeGreaterThanOrEqual(s.seenFrame);                   // every visible frame pixel started the tune
  });
  it("the plank itself: a tap on its front edge starts the tune and rings no bar", () => {
    const onTap = vi.fn();
    const r = room(onTap);
    const plank = r.g.getObjectByName("plank")!;
    plank.updateWorldMatrix(true, false);
    const p = plank.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(1.0, 0.2, 0.7));
    tones.length = 0;
    expect(r.fx.tap(new THREE.Raycaster(p, new THREE.Vector3(0, -1, 0)))).toBe(true);
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(r.inst.taps).toBe(1);
    expect(tones.filter((t) => t[3] === "sine").map((t) => t[0])).toEqual([262, 330, 392, 523]);      // the chime, not a bar's note
  });
});
