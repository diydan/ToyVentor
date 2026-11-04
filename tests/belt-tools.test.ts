// The tool belt shows what it holds and keeps toys (Dan, 2026-11-04 night: "tools is great but should it show a prop of that tool, and can we add a secondary row of tools like guitar,
// bubble blower once we find them"). The four tools are things Kip holds (toolMeshes.ts, heldItems.ts), the belt's pick is the hand's second choice (pickupHeld.ts `take`), and the Toys row
// plays the guitar and the bubble wand where Kip stands (toyRoomActs.ts `toy`), once they have been found at their props.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { HELD, TOOL_TURN, createHeld, placeHeldMesh } from "../src/features/game/world/runtime/heldItems";
import { createPickupHeld, parsePickup } from "../src/features/game/world/runtime/pickupHeld";
import { TOOL_GRIP, buildDrillMesh, buildHammerMesh, buildScrewdriverMesh, buildSpannerMesh } from "../src/features/game/world/runtime/toolMeshes";
import { BELT_TOYS, BLOW_S, PLAY_S, createActs } from "../src/features/game/world/runtime/toyRoomActs";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8");
const TOOLS = { screwdriver: buildScrewdriverMesh, spanner: buildSpannerMesh, hammer: buildHammerMesh, drill: buildDrillMesh } as const;

describe("the four tools as things Kip holds", () => {
  for (const [name, build] of Object.entries(TOOLS)) {
    it(`${name}: a tool-sized mesh with its handle at the origin and the fist closing inside it`, () => {
      const g = build();
      const box = new THREE.Box3().setFromObject(g);
      const size = box.getSize(new THREE.Vector3());
      expect(size.y).toBeGreaterThan(0.75);
      expect(size.y).toBeLessThan(1.1);
      expect(box.min.y).toBeGreaterThan(-0.3);                                // nothing hangs far below the handle's foot
      expect(Math.max(size.x, size.z)).toBeLessThan(0.7);                      // chunky, not a plank
      const [gx, gy, gz] = TOOL_GRIP[name as keyof typeof TOOL_GRIP];
      expect(gx).toBeGreaterThan(box.min.x); expect(gx).toBeLessThan(box.max.x);
      expect(gy).toBeGreaterThan(box.min.y); expect(gy).toBeLessThan(box.max.y);
      expect(gz).toBeGreaterThanOrEqual(box.min.z); expect(gz).toBeLessThanOrEqual(box.max.z);
      let meshes = 0; g.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes++; });
      expect(meshes).toBeGreaterThanOrEqual(4);
    });
    it(`${name}: is held in the right fist by its grip, pointing forward and a little up`, () => {
      const spec = HELD[name as keyof typeof HELD];
      expect(spec.parent).toBe("armR");
      expect(spec.at).toEqual(TOOL_GRIP[name as keyof typeof TOOL_GRIP]);
      expect(spec.rotation[2]).toBeCloseTo(TOOL_TURN, 9);
      const tip = new THREE.Vector3(0, 1, 0).applyEuler(new THREE.Euler(...spec.rotation));   // the tool's own "up" in the fist's frame (+x forward; the arm points down its own -y)
      expect(tip.x).toBeGreaterThan(0.85);
      expect(tip.y).toBeGreaterThan(0);                                                       // up from the fist, not down the arm
      // placed in a fist, its grip point is where the origin of the item would be
      const arm = new THREE.Group(); arm.userData.grip = true;
      const mesh = spec.build();
      placeHeldMesh(mesh, spec, arm);
      const grip = new THREE.Vector3(...TOOL_GRIP[name as keyof typeof TOOL_GRIP]).multiplyScalar(spec.scale).applyEuler(mesh.rotation).add(mesh.position);
      expect(grip.length()).toBeLessThan(1e-9);
    });
  }
});

const rig = () => { const model = new THREE.Group(); const armR = new THREE.Group(); const armL = new THREE.Group(); model.add(armR, armL); return { model, armR, armL }; };
const info = (id: string, label = "thing") => parsePickup({ word: label, kind: "workshop", id, label, coloured: false, colours: [], cutout: null })!;

describe("the belt's pick is in Kip's hand (pickupHeld.take)", () => {
  it("a tool goes in the right fist with no put-away chip, and a tap on Kip does not put it away", () => {
    const held = createHeld(); const r = rig();
    const p = createPickupHeld({ held, rig: () => r, playerRoot: () => r.model });
    p.take("hammer", "Claw hammer");
    expect(p.belt).toBe("hammer");
    expect(r.armR.children).toHaveLength(1);
    expect(r.model.children).toHaveLength(2);                                    // the two arms, nothing on the body
    expect(p.state.chipShowing).toBe(false);
    expect(p.state.wanted).toBeNull();
    const ray = { intersectObject: () => [{}] } as never;
    expect(p.tap(ray)).toBe(false);
    expect(r.armR.children).toHaveLength(1);
    p.dispose();
    expect(r.armR.children).toHaveLength(0);
  });

  it("another tool replaces it, the same one changes nothing, and null puts it away", () => {
    const r = rig();
    const p = createPickupHeld({ held: createHeld(), rig: () => r });
    p.take("hammer"); const first = r.armR.children[0]!;
    p.take("hammer");
    expect(r.armR.children[0]).toBe(first);
    p.take("spanner");
    expect(r.armR.children).toHaveLength(1);
    expect(r.armR.children[0]).not.toBe(first);
    p.take(null);
    expect(r.armR.children).toHaveLength(0);
    expect(p.belt).toBeNull();
    p.dispose();
  });

  it("steps aside while an act has Kip's hands and comes back when it lets go", () => {
    const held = createHeld(); const r = rig();
    const p = createPickupHeld({ held, rig: () => r });
    p.take("drill");
    expect(r.armR.children).toHaveLength(1);
    held.hold("wand", r.model, r.armR, r.armL);                                 // an act blows bubbles
    expect(r.armR.children).toHaveLength(1);                                   // only the wand is in the fist now
    expect(r.armR.children[0]!.children.length).toBeLessThan(6);
    held.release();
    expect(r.armR.children).toHaveLength(1);
    expect(p.belt).toBe("drill");
    expect(p.state.onKip).toBe(true);
    p.dispose();
  });

  it("a camera pick-up takes the hand first and the belt's tool comes back when it is put away", async () => {
    const held = createHeld(); const r = rig();
    const p = createPickupHeld({ held, rig: () => r });
    p.take("screwdriver");
    const tool = r.armR.children[0]!;
    expect(await p.pick(info("guitar", "guitar"))).toBe(true);
    expect(r.armR.children).toHaveLength(0);                                   // the tool went off the arm ...
    expect(r.model.children).toHaveLength(3);                                  // ... for the guitar on the body
    expect(p.state.wanted?.item).toBe("guitar");
    p.putAway();
    expect(r.model.children).toHaveLength(2);
    expect(r.armR.children).toHaveLength(1);                                   // the screwdriver is back (a fresh mesh)
    expect(r.armR.children[0]).not.toBe(tool);
    expect(p.belt).toBe("screwdriver");
    p.dispose();
  });

  it("waits for the rig (and a vehicle's missing arm), and comes on at the next tick", () => {
    const r = rig();
    let live: ReturnType<typeof rig> | null = null;
    const p = createPickupHeld({ held: createHeld(), rig: () => live });
    p.take("spanner");
    expect(p.state.onKip).toBe(false);
    live = r;
    p.tick();
    expect(r.armR.children).toHaveLength(1);
    p.dispose();
  });
});

describe("the Toys row plays a toy where Kip stands (toyRoomActs.toy)", () => {
  function game(opts: { allowed?: boolean; eater?: "character" | "robot" } = {}) {
    const s = { pos: { x: 12, y: 0, z: 0.4 }, target: null as number | null };
    const log: string[] = [];
    const found: string[] = [];
    const blows: number[] = [];
    const root = new THREE.Group();
    const w = {
      position: () => ({ ...s.pos }), targetX: () => s.target,
      walkTo: (x: number, z: number) => { s.target = x; log.push(`walkTo:${+x.toFixed(2)},${z}`); },
      stopWalk: () => { s.target = null; },
      face: (d: number) => log.push(`face:${d}`),
      root: () => root, eater: () => opts.eater ?? "character", allowed: () => opts.allowed ?? true,
      clip: (a: string) => { log.push(`clip:${a}`); return true; },
      setPosition: (x: number, y: number, z: number) => { s.pos = { x, y, z }; },
      tone: () => {}, phase: () => {},
      hold: (i: string) => log.push(`hold:${i}`), release: () => log.push("release"),
      found: (k: string) => found.push(k),
      mouth: (d: number) => ({ x: s.pos.x + 0.5 * d, y: 1.8, z: s.pos.z }),
      bubbles: { blow: (_f: unknown, _d: number, n: number) => { blows.push(n); } },
      fx: {
        squish: () => {}, strike: () => 262, kickBall: () => true, flutter: () => {}, say: () => {}, setVisible: (_i: unknown, v: boolean) => log.push(`visible:${v}`),
        cue: () => {}, nearby: () => [],
      },
    };
    const acts = createActs(w as never);
    const run = (seconds: number, dt = 1 / 30) => { for (let t = 0; t < seconds - 1e-9; t += dt) { acts.update(dt); if (s.target !== null) { s.pos.x = s.target; s.target = null; } } };
    return { acts, log, found, blows, run, s };
  }

  it("the belt has the two toys that need no prop to stand at", () => {
    expect([...BELT_TOYS]).toEqual(["guitar", "wand"]);
  });

  it("the guitar: Kip stays where he is, holds it, strums, and lets it go; no prop is hidden", () => {
    const g = game();
    expect(g.acts.toy("guitar")).toBe(true);
    g.run(0.3);
    expect(g.log).toContain("hold:guitar");
    expect(g.log).toContain("clip:strum");
    expect(g.log.filter((l) => l.startsWith("walkTo")).every((l) => l.startsWith("walkTo:12,")), g.log.join(" ")).toBe(true);   // he did not walk anywhere (at most a step on the spot)
    expect(g.log.some((l) => l.startsWith("visible:"))).toBe(false);            // there is no guitar on a stand to hide
    expect(g.found).toEqual(["guitar"]);
    expect(g.acts.busy).toBe(true);
    g.run(PLAY_S + 1);
    expect(g.log).toContain("release");
    expect(g.acts.busy).toBe(false);
    expect(g.s.pos.x).toBe(12);
  });

  it("the bubble wand: holds it, blows puffs from his mouth, and lets it go", () => {
    const g = game();
    expect(g.acts.toy("wand")).toBe(true);
    g.run(BLOW_S + 1);
    expect(g.log).toContain("hold:wand");
    expect(g.log).toContain("clip:blow");
    expect(g.blows.length).toBeGreaterThan(0);
    expect(g.found).toEqual(["wand"]);
    expect(g.log).toContain("release");
    expect(g.acts.busy).toBe(false);
  });

  it("refuses when an act is not allowed, when the toy is not a character, and while another act is under way", () => {
    expect(game({ allowed: false }).acts.toy("guitar")).toBe(false);
    expect(game({ eater: "robot" }).acts.toy("wand")).toBe(false);
    const g = game();
    expect(g.acts.toy("guitar")).toBe(true);
    g.run(0.2);
    expect(g.acts.toy("wand")).toBe(false);
  });
});

describe("the page wiring (text pins)", () => {
  const world = read("src/features/game/world/runtime/world.ts");
  const dom = read("src/features/game/world/runtime/stageDom.ts");
  it("choosing a tool puts it in Kip's hand", () => {
    expect(world).toMatch(/function beltIcon\(\)\{[^\n]*PICK\.take\(\(S\.tool&&TK\[S\.tool\]\)\?S\.tool:null/);
  });
  it("the belt has a tools row and a Toys row that stays hidden until a toy is found, and finds are kept in the saved state", () => {
    expect(world).toContain('<div class="belt-row" id="belt-tools">');
    expect(world).toContain('id="belt-toys" role="group" aria-label="Toys you found" hidden');
    expect(world).toMatch(/function beltFound\(k: string\)\{[^\n]*S\.toys\[k\]=1;save\(\);beltToys\(\)/);
    expect(world).toMatch(/row\.hidden=!got\.length/);
    expect(world).toContain("found:function(k: any){beltFound(k)}");              // the acts say when a toy was played at its prop
    expect(world).toMatch(/ACTS\.toy\(b\.dataset\.toy as any\)/);
    expect(dom).toContain(".belt-toys {");
    expect(dom).toContain(".belt-toys[hidden] {display:none}");
  });
});

describe("the belt's tool steps out of the hand while its twin works (pickupHeld.beltVisible)", () => {
  it("hides the tool in the fist and shows it again; a tool put on while hidden stays hidden until shown", () => {
    const r = rig();
    const p = createPickupHeld({ held: createHeld(), rig: () => r });
    p.take("hammer");
    const mesh = r.armR.children[0]!;
    expect(mesh.visible).toBe(true);
    p.beltVisible(false);
    expect(mesh.visible).toBe(false);
    p.take("spanner");                                                            // a new tool while the old one's twin is out: it is not drawn either
    expect(r.armR.children[0]!.visible).toBe(false);
    p.beltVisible(true);
    expect(r.armR.children[0]!.visible).toBe(true);
    p.dispose();
  });
  it("does nothing to a camera pick-up in the hand", async () => {
    const r = rig();
    const p = createPickupHeld({ held: createHeld(), rig: () => r });
    p.take("drill");
    await p.pick(info("guitar", "guitar"));
    p.beltVisible(false);
    expect(r.model.children[2]!.visible).toBe(true);                              // the guitar
    p.beltVisible(true);
    p.dispose();
  });
});
