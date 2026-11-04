// The four tools on the belt as things Kip holds (Dan, 2026-11-04 night: "tools is great but should it show a prop of that tool"): the screwdriver, spanner, claw hammer and drill, chunky
// rounded-plastic toys in the same language as the other held props (bubbleWand.ts, mop.ts). Each stands upright in its own frame with the bottom of its handle at y = 0 and its working end
// up; heldItems.ts turns it so it points forward and a little up from the fist, and `TOOL_GRIP` says where in it the fist closes (the middle of the handle).
import { T, M, rbox, plastic, metal } from "./worldScene";
import type * as THREE from "three";

/** Where the fist closes on each tool, in the tool's own frame (the middle of its handle). */
export const TOOL_GRIP: Readonly<Record<"screwdriver" | "spanner" | "hammer" | "drill", readonly [number, number, number]>> = {
  screwdriver: [0, 0.2, 0],
  spanner: [0, 0.2, 0],
  hammer: [0, 0.22, 0],
  drill: [-0.07, 0.04, 0],
};

const steel = () => metal("#c9d3e6");

/** A flat-blade screwdriver: a fat orange handle, a steel collar and shaft, and a flat tip. About 0.9 long. */
export function buildScrewdriverMesh(): THREE.Group {
  const g = new T.Group();
  const grip = plastic("#ff6b4a", { roughness: 0.45 });
  g.add(M(new T.CylinderGeometry(0.1, 0.085, 0.42, 14), grip, 0, 0.21, 0));
  g.add(M(new T.CylinderGeometry(0.108, 0.108, 0.05, 14), plastic("#ffd24d", { roughness: 0.4 }), 0, 0.2, 0));      // a yellow band round the handle
  g.add(M(new T.CylinderGeometry(0.05, 0.05, 0.08, 10), steel(), 0, 0.46, 0));                                       // the collar
  g.add(M(new T.CylinderGeometry(0.03, 0.03, 0.4, 10), steel(), 0, 0.7, 0));                                         // the shaft
  g.add(M(rbox(0.07, 0.1, 0.02, 0.006), steel(), 0, 0.94, 0));                                                       // the flat tip
  return g;
}

/** An open-ended spanner: a flat steel bar with an open jaw at the top (a ring with a gap) and a closed ring at the foot. About 0.9 long. */
export function buildSpannerMesh(): THREE.Group {
  const g = new T.Group();
  const s = metal("#aebbd6");
  g.add(M(rbox(0.1, 0.46, 0.05, 0.03), s, 0, 0.33, 0));                                                              // the bar
  const jaw = M(new T.TorusGeometry(0.13, 0.05, 8, 20, Math.PI * 1.55), s, 0, 0.69, 0);                              // the open jaw: a C, its gap towards the top
  jaw.rotation.z = Math.PI / 2 - (Math.PI * 1.55) / 2 + Math.PI / 2;
  g.add(jaw);
  g.add(M(new T.TorusGeometry(0.09, 0.045, 8, 18), s, 0, 0.06, 0));                                                    // the ring end at the foot
  g.add(M(rbox(0.12, 0.13, 0.052, 0.02), plastic("#52b7ff", { roughness: 0.4 }), 0, 0.27, 0));                        // a blue grip sleeve on the bar
  return g;
}

/** A claw hammer: a wooden handle, a steel head across its top with a flat face on one side and a curved claw on the other. About 0.85 long. */
export function buildHammerMesh(): THREE.Group {
  const g = new T.Group();
  g.add(M(rbox(0.1, 0.66, 0.1, 0.04), plastic("#c98b52", { roughness: 0.6 }), 0, 0.33, 0));                          // the handle
  g.add(M(rbox(0.115, 0.16, 0.115, 0.04), plastic("#ff6b4a", { roughness: 0.45 }), 0, 0.14, 0));                     // a red rubber grip at its foot
  const head = steel();
  g.add(M(rbox(0.36, 0.15, 0.15, 0.04), head, 0, 0.73, 0));                                                          // the head
  const face = M(new T.CylinderGeometry(0.085, 0.085, 0.07, 12), head, 0.2, 0.73, 0);                                // the flat striking face (+x)
  face.rotation.z = Math.PI / 2;
  g.add(face);
  const claw = M(rbox(0.2, 0.09, 0.12, 0.03), head, -0.26, 0.76, 0);                                                 // the claw (-x): a wedge that curls down
  claw.rotation.z = 0.5;
  g.add(claw);
  return g;
}

/** A cordless drill: a yellow barrel with a dark band and a chuck and bit pointing along +y, and a pistol grip tilted back under it where the fist closes. About 1 long. */
export function buildDrillMesh(): THREE.Group {
  const g = new T.Group();
  const body = plastic("#ffd24d", { roughness: 0.4 });
  const dark = plastic("#2a3350", { roughness: 0.5 });
  g.add(M(new T.CylinderGeometry(0.115, 0.125, 0.4, 16), body, 0, 0.34, 0));                                        // the barrel
  g.add(M(new T.CylinderGeometry(0.128, 0.128, 0.08, 16), dark, 0, 0.46, 0));                                         // a dark band
  g.add(M(new T.CylinderGeometry(0.075, 0.09, 0.1, 12), steel(), 0, 0.59, 0));                                      // the chuck
  g.add(M(new T.CylinderGeometry(0.022, 0.022, 0.26, 8), steel(), 0, 0.77, 0));                                       // the bit
  const handle = M(rbox(0.13, 0.3, 0.12, 0.05), dark, -0.06, 0.0, 0);                                              // the pistol grip, tilted back
  handle.rotation.z = 0.28;
  g.add(handle);
  g.add(M(rbox(0.1, 0.08, 0.1, 0.03), plastic("#ff6b4a", { roughness: 0.4 }), -0.15, -0.13, 0));                     // the battery foot
  return g;
}

export type ToolKind = "screwdriver" | "spanner" | "hammer" | "drill";
export const TOOL_BUILDERS: Readonly<Record<ToolKind, () => THREE.Group>> = {
  screwdriver: buildScrewdriverMesh,
  spanner: buildSpannerMesh,
  hammer: buildHammerMesh,
  drill: buildDrillMesh,
};
/** How far from its origin (the handle's foot) the working end is, along the tool's own +y: the tip, the open jaw, the face of the hammer, the bit. */
export const TOOL_TIP: Readonly<Record<ToolKind, number>> = { screwdriver: 0.98, spanner: 0.86, hammer: 0.82, drill: 0.9 };
