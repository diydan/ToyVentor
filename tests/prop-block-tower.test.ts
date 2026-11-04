// The blocks prop in the prop fx: every tap adds a block to the tower (with its thud and its note), the tap on a full tower brings it down, and nothing happens while it falls.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tones: Array<[number, number, number, string]> = [];
vi.mock("../src/features/game/world/runtime/audio", () => ({
  sfx: new Proxy({}, { get: () => () => {} }),
  sound: false,
  tone: (f: number, delay: number, dur: number, type: string) => { tones.push([f, delay, dur, type]); },
}));

import { PROP_SPECS, createPropFx } from "../src/features/game/world/runtime/propReactions";
import { DROP_LAND_S, MAX_LAYERS, START_LAYERS, TOWER_NOTES, buildBlockTower, slotOf, type Tower } from "../src/features/game/world/runtime/blockTower";
import { PROP_LANG_KEY } from "../src/lib/propSpeech";
import { resetVoiceBackoff } from "../src/lib/propVoice";

const root = new URL("..", import.meta.url).pathname;

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
  const g = buildBlockTower(5, -2, () => new THREE.MeshBasicMaterial());
  world.add(g);
  const inst = fx.register("blocks", [g])!;
  g.updateMatrixWorld(true);
  const tower = g.userData.tower as Tower;
  /** A tap from the front at the block `i`. */
  const tapBlock = (i = 0) => {
    g.updateMatrixWorld(true);
    const p = (g.userData.blocks as THREE.Mesh[])[i]!.getWorldPosition(new THREE.Vector3());
    const from = p.clone().add(new THREE.Vector3(0, 1, 10));
    return fx.tap(new THREE.Raycaster(from, p.clone().sub(from).normalize()));
  };
  const frames = (seconds: number) => { for (let k = 0; k < seconds * 60; k++) fx.update(1 / 60, k / 60); };
  return { fx, toast, inst, g, tower, tapBlock, frames };
}

describe("the blocks prop", () => {
  it("stacks on a tap and does not wiggle as a whole (the tower does its own wobble)", () => {
    expect(PROP_SPECS.blocks).toMatchObject({ noun: "blocks", color: "colorful", use: "stack", poke: "none" });
  });

  it("a tap adds a block: it names the pile, counts the tap, tells the world and the tower grows", () => {
    const onTap = vi.fn();
    const c = room(onTap);
    expect(c.tower.layers).toBe(START_LAYERS);
    expect(c.tapBlock(0)).toBe(true);
    expect(c.tower.layers).toBe(START_LAYERS + 1);
    expect(c.inst.taps).toBe(1);
    expect(c.toast).toHaveBeenCalledWith("Colorful blocks");
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it("the landing is heard when the block lands: a thud and its note (and a bright overtone) exactly then", () => {
    const c = room();
    c.tapBlock(0);
    const note = TOWER_NOTES[START_LAYERS]!;
    const heard = tones.filter((t) => t[1] > 0);
    expect(heard.map((t) => t[0]).sort((a, b) => a - b)).toEqual([150, note, note * 2].sort((a, b) => a - b));
    for (const t of heard) expect(t[1]).toBeCloseTo(DROP_LAND_S, 9);
    expect(heard.find((t) => t[0] === 150)![3]).toBe("square");
    expect(heard.find((t) => t[0] === note)![3]).toBe("triangle");
  });

  it("each block is a higher note than the last", () => {
    const c = room();
    const notes: number[] = [];
    for (let i = START_LAYERS; i < MAX_LAYERS; i++) {
      tones.length = 0;
      c.tapBlock(0);
      notes.push(tones.filter((t) => t[1] > 0 && t[3] === "triangle")[0]![0]);       // (the delay-0 tone is the generic tap chirp every prop makes)
      c.frames(0.8);
    }
    expect(notes).toEqual(TOWER_NOTES.slice(START_LAYERS, MAX_LAYERS));
    for (let i = 1; i < notes.length; i++) expect(notes[i]!).toBeGreaterThan(notes[i - 1]!);
  });

  it("the tap on a full tower is a crash: no new block, a clatter of low notes, and the tower is falling", () => {
    const c = room();
    for (let i = START_LAYERS; i < MAX_LAYERS; i++) { c.tapBlock(0); c.frames(0.8); }
    expect(c.tower.layers).toBe(MAX_LAYERS);
    tones.length = 0;
    c.tapBlock(0);
    expect(c.tower.phase).toBe("crashing");
    const clatter = tones.filter((t) => t[1] > 0);
    expect(clatter.length).toBeGreaterThanOrEqual(7);
    expect(clatter.every((t) => t[0] < 200)).toBe(true);                  // a clatter, not a tune
    expect(clatter.some((t) => t[3] === "sawtooth")).toBe(true);
    expect(Math.max(...clatter.map((t) => t[1]))).toBeGreaterThan(0.5);   // it goes on for a while
  });

  it("while it falls, and while it is put back together, a tap still names it but adds nothing and makes no block noise", () => {
    const c = room();
    for (let i = START_LAYERS; i < MAX_LAYERS; i++) { c.tapBlock(0); c.frames(0.8); }
    c.tapBlock(0);
    c.frames(0.5);
    tones.length = 0;
    const taps = c.inst.taps;
    c.tapBlock(0);
    expect(c.inst.taps).toBe(taps + 1);
    expect(c.tower.phase).toBe("crashing");
    expect(tones.filter((t) => t[1] > 0)).toHaveLength(0);               // (only the generic tap chirp, at once)
  });

  it("then it is built again: after the crash and the rebuild a tap adds the first block of a new tower", () => {
    const c = room();
    for (let i = START_LAYERS; i < MAX_LAYERS; i++) { c.tapBlock(0); c.frames(0.8); }
    c.tapBlock(0);
    c.frames(15);
    expect(c.tower.phase).toBe("standing");
    expect(c.tower.layers).toBe(START_LAYERS);
    c.tapBlock(0);
    expect(c.tower.layers).toBe(START_LAYERS + 1);
  });

  it("the frame's tick moves the blocks (the new one falls into place)", () => {
    const c = room();
    const blocks = c.g.userData.blocks as THREE.Mesh[];
    c.tapBlock(0);
    const y0 = blocks[START_LAYERS + 1]!.position.y;
    c.frames(0.2);
    expect(blocks[START_LAYERS + 1]!.position.y).toBeLessThan(y0);
    c.frames(1);
    expect(blocks[START_LAYERS + 1]!.position.y).toBeCloseTo(slotOf(START_LAYERS + 1).y, 6);
  });

  it("a block high on a tall tower, above where the pile was, is tapped like any other: the ray hits it directly", () => {
    const c = room();
    for (let i = START_LAYERS; i < MAX_LAYERS - 1; i++) { c.tapBlock(0); c.frames(0.8); }
    const top = c.tower.layers;
    expect(c.tower.layers).toBe(MAX_LAYERS - 1);
    const taps = c.inst.taps;
    expect(c.tapBlock(top)).toBe(true);
    expect(c.inst.taps).toBe(taps + 1);
    expect(c.tower.layers).toBe(MAX_LAYERS);
  });

  it("a blocks prop built some other way, with no tower, still topples its top block on a tap", () => {
    const c = room();
    const other = new THREE.Group();
    const a = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()); a.position.y = 0.5;
    const b = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()); b.position.y = 1.5;
    other.add(a, b);
    c.g.parent!.add(other);
    const inst = c.fx.register("blocks", [other])!;
    c.fx.activate(inst);
    c.fx.update(0.3, 0.3);
    c.fx.update(0.3, 0.6);
    expect(Math.abs(b.position.x) + Math.abs(b.rotation.z)).toBeGreaterThan(0.1);
  });
});

describe("the wiring in the world", () => {
  const world = readFileSync(join(root, "src/features/game/world/runtime/world.ts"), "utf8");
  it("the blocks prop is built by buildBlockTower with the lettered block material, and the old fixed pile is gone", () => {
    expect(world).toContain('import { BLOCK_CHEER_AT, buildBlockTower } from "./blockTower";');
    expect(world).toContain("blocks:function(x,z){return add(buildBlockTower(x,z,blockMat))}");
    expect(world).not.toContain("function toyBlocks(");
    expect(world).not.toContain("blocks:toyBlocks");
  });
});
