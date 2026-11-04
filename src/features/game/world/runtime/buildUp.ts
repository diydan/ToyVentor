// Toys that are built up one piece at a time and then knocked down (docs/specs/playful-interactions-spec.md section 6: the sandcastle and the snowman).
//
// The prop starts as just its first stage (the sandcastle's mound, the snowman's big bottom ball). Each tap pops the next stage in (its pieces one after another, from a little above, with a
// bounce), a note climbs a scale, and on the last stage the next tap brings it down (the sandcastle crumbles, the snowman squashes into a heap), the heap rests a moment, and it starts again.
// It talks to propReactions.ts the same way the block tower does: `holder.userData.stack()` is a tap, `holder.userData.tick(t, dt)` runs every frame.
//
// `createBuildUp` is pure numbers (no three.js) so a test can run the whole thing; `makeBuildUp` is the thin wrapper that drives an existing group's children, which an existing builder
// has already drawn. Each child is given a stage by position in `stageOf` (the builders' drawing order is pinned by the test that reads the builders' child counts).
import * as THREE from "three";

export type BuildSfx = "soft" | "crumble" | "poof";
export type BuildResult =
  | { kind: "added"; layers: number; note: number; landsIn: number; sfx: BuildSfx }
  | { kind: "crash"; sfx: BuildSfx }
  | { kind: "busy" };

/** A piece pops in over this long, and the pieces of one stage follow each other by the gap. */
export const POP_S = 0.45;
export const PIECE_GAP_S = 0.07;
/** How long the collapse takes, and how long the heap rests before it starts again. */
export const COLLAPSE_S = 0.85;
export const HEAP_HOLD_S = 0.7;
/** How far above its place a piece starts to fall in. */
export const POP_DROP = 0.55;

export interface PiecePose { visible: boolean; scale: number; squash: number; dy: number; dx: number; tilt: number }

const clamp01 = (k: number) => (k < 0 ? 0 : k > 1 ? 1 : k);
const easeOutBack = (k: number) => { const c1 = 1.9, c3 = c1 + 1; const x = k - 1; return 1 + c3 * x * x * x + c1 * x * x; };
const easeOutQuad = (k: number) => 1 - (1 - k) * (1 - k);
const easeIn = (k: number) => k * k;

/** The scale and the height a piece has `age` seconds after its tap: it falls in from above and settles with a small overshoot. */
export function popPose(age: number): { scale: number; dy: number } {
  if (!(age >= 0)) return { scale: 0, dy: POP_DROP };
  const k = clamp01(age / POP_S);
  return { scale: Math.max(0, easeOutBack(k)), dy: (1 - easeOutQuad(k)) * POP_DROP };
}

/** Stages as they are named by the pieces: `stageOf[i]` is the stage piece i belongs to (0 = what stands at the start). */
export function createBuildUp(stageOf: readonly number[], notes: readonly number[], sfx: { added: BuildSfx; crash: BuildSfx }) {
  const stages = Math.max(0, ...stageOf) + 1;
  // the position of each piece within its own stage, for the stagger
  const within: number[] = [];
  const counts: number[] = Array(stages).fill(0);
  for (const s of stageOf) { within.push(counts[s]!); counts[s]!++; }
  let step = 0;
  let phase: "standing" | "crashing" | "resting" = "standing";
  let phaseAge = 0;
  const popAge: number[] = stageOf.map(() => Infinity);        // seconds since the piece's stage was tapped in; Infinity = settled
  const out: PiecePose[] = stageOf.map(() => ({ visible: true, scale: 1, squash: 1, dy: 0, dx: 0, tilt: 0 }));

  function compose() {
    for (let i = 0; i < stageOf.length; i++) {
      const o = out[i]!, s = stageOf[i]!;
      o.scale = 1; o.squash = 1; o.dy = 0; o.dx = 0; o.tilt = 0; o.visible = true;
      if (phase === "standing") {
        if (s > step) { o.visible = false; continue; }
        const age = popAge[i]! - within[i]! * PIECE_GAP_S;
        if (Number.isFinite(popAge[i]!) && age < POP_S) {
          const p = popPose(age);
          o.scale = p.scale; o.dy = p.dy; o.visible = age > -1e-9 && p.scale > 0.001;
          // a piece that has not started yet is still hidden (its stagger delay): keep it out
          if (age < 0) o.visible = false;
        }
      } else if (phase === "crashing") {
        const delay = (stages - 1 - s) * 0.08 + (counts[s]! - 1 - within[i]!) * 0.015;
        const k = clamp01((phaseAge - delay) / (COLLAPSE_S - 0.45));
        if (s === 0) { o.squash = 1 - 0.28 * Math.sin(Math.PI * clamp01(phaseAge / COLLAPSE_S)); continue; }
        const dir = i % 2 ? 1 : -1;
        o.scale = Math.max(0, 1 - easeIn(k));
        o.dy = -0.5 * k; o.dx = dir * 0.35 * k; o.tilt = dir * 0.9 * k;
        o.visible = o.scale > 0.001;
      } else {
        if (s > 0) o.visible = false;
        else o.squash = 1 + 0.12 * Math.sin(Math.PI * clamp01(phaseAge / HEAP_HOLD_S)) * Math.exp(-phaseAge * 3);
      }
    }
  }
  compose();

  return {
    get stages(): number { return stages; },
    get step(): number { return step; },
    get phase(): "standing" | "crashing" | "resting" { return phase; },
    get poses(): readonly PiecePose[] { return out; },
    /** A tap: the next stage pops in, or on the last stage the whole thing comes down. Nothing while it is already coming down or resting as a heap. */
    tap(): BuildResult {
      if (phase !== "standing") return { kind: "busy" };
      if (step >= stages - 1) {
        phase = "crashing"; phaseAge = 0;
        compose();
        return { kind: "crash", sfx: sfx.crash };
      }
      step++;
      for (let i = 0; i < stageOf.length; i++) if (stageOf[i] === step) popAge[i] = 0;
      compose();
      const lastInStage = (counts[step]! - 1) * PIECE_GAP_S;
      return { kind: "added", layers: step + 1, note: notes[Math.min(step - 1, notes.length - 1)] ?? 440, landsIn: Math.min(0.35, lastInStage + 0.25), sfx: sfx.added };
    },
    update(dt: number): void {
      const d = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0;
      if (phase === "standing") {
        for (let i = 0; i < popAge.length; i++) if (Number.isFinite(popAge[i]!)) { popAge[i] = popAge[i]! + d; if (popAge[i]! - within[i]! * PIECE_GAP_S > POP_S + 0.01) popAge[i] = Infinity; }
      } else if (phase === "crashing") {
        phaseAge += d;
        if (phaseAge >= COLLAPSE_S) { phase = "resting"; phaseAge = 0; }
      } else {
        phaseAge += d;
        if (phaseAge >= HEAP_HOLD_S) { phase = "standing"; step = 0; phaseAge = 0; popAge.fill(Infinity); }
      }
      compose();
    },
  };
}
export type BuildUp = ReturnType<typeof createBuildUp>;

// ---- the stages of the two builders in world.ts ----------------------------------------------------------------------------

/** The Beach's sandcastle, by the order `sandcastle()` in world.ts adds its pieces: 0 the base, 1-8 the four corner towers (a tower and its cone each), 9 the keep, 10-15 the battlements, 16-17 the flagpole and the flag. */
export const SANDCASTLE_STAGES: readonly number[] = [0, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 3, 3];
export const SANDCASTLE_NOTES: readonly number[] = [330, 392, 523];
/** The Snow Peak's snowman: 0 the bottom ball, 1 the middle ball, 2 the head, 3 the nose, eyes, buttons, scarf, hat and arms. */
export const SNOWMAN_STAGES: readonly number[] = [0, 1, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3];
export const SNOWMAN_NOTES: readonly number[] = [330, 392, 523];

// ---- the meshes ------------------------------------------------------------------------------------------------------------

/**
 * Drive the children of `group` as the stages of a build-up. A piece grows from where it stands on the ground (its bottom stays put as it scales), so a tower rises rather than inflating
 * in mid-air. A group that does not have the number of pieces the stages describe (a builder was changed) is left exactly as drawn, with no hooks.
 */
export function makeBuildUp(group: THREE.Group, stageOf: readonly number[], notes: readonly number[], sfx: { added: BuildSfx; crash: BuildSfx }): THREE.Group {
  if (group.children.length !== stageOf.length) return group;
  group.updateMatrixWorld(true);
  const build = createBuildUp(stageOf, notes, sfx);
  const box = new THREE.Box3();
  const base = group.children.map((c) => {
    box.setFromObject(c);
    const bottom = box.min.y - group.position.y - c.position.y;      // the piece's lowest point, relative to its own origin
    return { x: c.position.x, y: c.position.y, z: c.position.z, rz: c.rotation.z, sx: c.scale.x, sy: c.scale.y, sz: c.scale.z, bottom };
  });
  const apply = () => {
    build.poses.forEach((p, i) => {
      const c = group.children[i]!, b = base[i]!;
      c.visible = p.visible;
      const s = Math.max(0.001, p.scale);
      c.scale.set(b.sx * s, b.sy * s * p.squash, b.sz * s);
      // keep the bottom of the piece where it was drawn: its centre moves up by what the shrink took off the part below the centre
      c.position.set(b.x + p.dx, b.y + p.dy - b.bottom * (s * p.squash - 1), b.z);
      c.rotation.z = b.rz + p.tilt;
    });
  };
  apply();
  group.userData.build = build;
  group.userData.stack = (): BuildResult => { const r = build.tap(); apply(); return r; };
  group.userData.tick = (_t: number, dt: number) => { build.update(dt); apply(); };
  return group;
}

export const buildUpSandcastle = (g: THREE.Group) => makeBuildUp(g, SANDCASTLE_STAGES, SANDCASTLE_NOTES, { added: "soft", crash: "crumble" });
export const buildUpSnowman = (g: THREE.Group) => makeBuildUp(g, SNOWMAN_STAGES, SNOWMAN_NOTES, { added: "soft", crash: "poof" });
