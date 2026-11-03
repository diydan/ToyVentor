// The Toy Room things Kip does with its toys (docs/specs/playful-interactions-spec.md section 6): tap the TEDDY and Kip walks over and gives it a hug (hearts float up), tap the CUSHIONS and Kip hops
// up onto the pile, bounces on it with a cheer and hops down, tap the BALL and Kip walks to it and kicks it across the room. Each is a `Visit` (visitRoutine.ts: walk over, then act) built here from the prop that was
// tapped; this file also draws the floating hearts. world.ts supplies the facts and the toy's little effects through `ActsWorld`; only a character does these (a vehicle just lets the prop react as it always did).
import * as THREE from "three";
import { BALL_BOUNDS } from "./ballKick";
import type { EaterKind } from "./fruitAppetite";
import { HUG_SQUEEZE_S, KICK_CONTACT_S } from "./proceduralClips";
import type { PropInst } from "./propReactions";
import type { P3 } from "./sleepRoutine";
import { createVisitor, type Visit, type VisitAdapter, type VisitPhase } from "./visitRoutine";

export type ActKind = "hug" | "kick" | "jump";
/** Which prop type starts which act. */
export const ACT_FOR_PROP: Readonly<Record<string, ActKind>> = { teddy: "hug", ball: "kick", cushions: "jump" };

/** How far from the prop's centre the toy stands, in x. */
export const HUG_STAND = 1.05;
export const KICK_STAND = 1.15;
/** How much room a kick needs in front of the ball (a little more than it travels). */
export const KICK_ROOM = 5;
/** After a kick, once the ball has stopped, Kip trots after it and stops this far behind it (so the ball is back on screen and can be kicked again). Not if it is already this close. */
export const FOLLOW_STAND = 1.6;
export const JUMP_STAND = 1.7;
export const KICK_VX = 3.3;
export const KICK_VY = 2.7;
/** The top of the cushion pile (the top cushion's upper face) above the floor. */
export const CUSHION_TOP = 0.8;
/** Seconds of the hug and of the second squeeze in it. */
export const HUG_S = 2.0;
export const HUG_SECOND_SQUEEZE_S = 1.3;
export const KICK_S = 1.0;
/** The jump: up onto the pile, three shrinking bounces, down again. Each entry is when it ends (seconds from the start). */
export const JUMP_UP_S = 0.55;
export const JUMP_BOUNCES: ReadonlyArray<{ end: number; height: number }> = [{ end: 1.0, height: 0.95 }, { end: 1.4, height: 0.55 }, { end: 1.75, height: 0.25 }];
export const JUMP_DOWN_S = 2.35;
export const JUMP_UP_HEIGHT = 1.1;
export const JUMP_DOWN_HEIGHT = 0.8;
export const HEART_RISE_S = 1.6;
export const HEART_RISE = 1.3;

const ease = (u: number) => u * u * (3 - 2 * u);
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

export interface JumpPlan { standX: number; cushX: number; topY: number; z0: number; zTop: number }
/**
 * Where Kip is `t` seconds into the cushion jump: eased up onto the pile in an arc, three bounces on it that get smaller, an arc down to where it stood. At t = 0 and at the end it is exactly on the floor
 * at `standX`, and each landing (JUMP_UP_S and each bounce's `end`) is exactly at `topY` on the pile.
 */
export function jumpPath(t: number, p: JumpPlan): P3 {
  if (!(t > 0)) return { x: p.standX, y: 0, z: p.z0 };
  if (t >= JUMP_DOWN_S) return { x: p.standX, y: 0, z: p.z0 };
  if (t < JUMP_UP_S) {
    const u = t / JUMP_UP_S, e = ease(u);
    return { x: lerp(p.standX, p.cushX, e), y: p.topY * e + JUMP_UP_HEIGHT * Math.sin(Math.PI * u), z: lerp(p.z0, p.zTop, e) };
  }
  let from = JUMP_UP_S;
  for (const b of JUMP_BOUNCES) {
    if (t < b.end) return { x: p.cushX, y: p.topY + b.height * Math.sin((Math.PI * (t - from)) / (b.end - from)), z: p.zTop };
    from = b.end;
  }
  const u = (t - from) / (JUMP_DOWN_S - from), e = ease(u);
  return { x: lerp(p.cushX, p.standX, e), y: p.topY * (1 - e) + JUMP_DOWN_HEIGHT * Math.sin(Math.PI * u), z: lerp(p.zTop, p.z0, e) };
}

export interface ActsWorld extends Omit<VisitAdapter, "onPhase"> {
  /** Where the hearts live (the world root, so a world change takes them away). */
  root(): THREE.Object3D;
  eater(): EaterKind;
  /** False while an act must not start (paused, a showcase, a mission cinematic, the editor, asleep, an ability running). */
  allowed(): boolean;
  /** Play a character clip; false if it cannot (reduced motion, not loaded). */
  clip(action: "hug" | "kick" | "cheer"): boolean;
  /** Place the toy (during the cushion jump). */
  setPosition(x: number, y: number, z: number): void;
  tone(freq: number, delay: number, dur: number, type: OscillatorType, vol: number, slideTo?: number): void;
  /** The phase changed (the world marks the toy busy while it acts). */
  phase(phase: VisitPhase, previous: VisitPhase): void;
  fx: { squish(inst: PropInst): void; kickBall(inst: PropInst, vx: number, vy: number): boolean };
}

const heartMaterial = (() => {
  let mat: THREE.SpriteMaterial | null = null;
  return (): THREE.SpriteMaterial => {
    if (mat) return mat;
    const opts: THREE.SpriteMaterialParameters = { color: 0xff7aa8, transparent: true, depthWrite: false, fog: false };
    if (typeof document !== "undefined") {
      const c = document.createElement("canvas");
      c.width = c.height = 96;
      const g = c.getContext("2d");
      if (g) {
        g.font = "bold 76px system-ui, sans-serif";
        g.textAlign = "center"; g.textBaseline = "middle";
        g.shadowColor = "rgba(255,120,170,0.9)"; g.shadowBlur = 12;
        g.fillStyle = "#ff6f9c";
        g.fillText("♥", 48, 50);
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        opts.map = tex; opts.color = 0xffffff;
      }
    }
    mat = new THREE.SpriteMaterial(opts);
    return mat;
  };
})();

interface Heart { sprite: THREE.Sprite; t: number; from: THREE.Vector3; size: number; sway: number }

export function createActs(w: ActsWorld) {
  const hearts: Heart[] = [];
  /** The ball Kip has just kicked and will follow once it stops, and which way it was kicked. */
  let following: { inst: PropInst; dir: 1 | -1 } | null = null;
  const visitor = createVisitor({
    position: () => w.position(),
    targetX: () => w.targetX(),
    walkTo: (x, z) => w.walkTo(x, z),
    stopWalk: () => w.stopWalk(),
    face: (d) => w.face(d),
    onPhase: (p, prev) => w.phase(p, prev),
  });

  function heart(at: THREE.Vector3, size = 0.4) {
    const sprite = new THREE.Sprite(heartMaterial().clone());
    sprite.scale.setScalar(size);
    sprite.position.copy(at);
    sprite.renderOrder = 10;
    w.root().add(sprite);
    hearts.push({ sprite, t: 0, from: at.clone(), size, sway: hearts.length % 2 ? 1 : -1 });
  }
  function clearHearts() {
    for (const h of hearts) { h.sprite.parent?.remove(h.sprite); h.sprite.material.dispose(); }
    hearts.length = 0;
  }

  function hugVisit(inst: PropInst): Visit {
    const x = inst.base.px, z = inst.base.pz, top = inst.size.y;
    const at = () => new THREE.Vector3(x, top * 0.95, z + 0.25);
    const squeeze = (pitch: number) => { w.fx.squish(inst); heart(at()); w.tone(pitch, 0, 0.12, "triangle", 0.06, pitch * 1.4); };
    return {
      standX: x - HUG_STAND, face: 1, seconds: HUG_S,
      begin: () => { w.clip("hug"); },
      cues: [{ at: HUG_SQUEEZE_S, fn: () => squeeze(520) }, { at: HUG_SECOND_SQUEEZE_S, fn: () => squeeze(620) }],
      end: () => {},
    };
  }

  function kickVisit(inst: PropInst): Visit {
    const x = inst.base.px;
    let dir: 1 | -1 = x + KICK_ROOM > BALL_BOUNDS[1] ? -1 : 1;           // kick it to the right (where the camera shows most room), unless the wall is too close
    if (x - dir * KICK_STAND < BALL_BOUNDS[0] || x - dir * KICK_STAND > BALL_BOUNDS[1]) dir = (-dir) as 1 | -1;
    return {
      standX: x - dir * KICK_STAND, face: dir, seconds: KICK_S,
      begin: () => { w.clip("kick"); },
      cues: [{ at: KICK_CONTACT_S, fn: () => { w.fx.kickBall(inst, dir * KICK_VX, KICK_VY); w.tone(160, 0, 0.1, "square", 0.07, 90); } }],
      end: () => { following = { inst, dir }; },                          // (a reset cuts a kick short and clears this again)
    };
  }

  function jumpVisit(inst: PropInst): Visit {
    const plan: JumpPlan = { standX: inst.base.px - JUMP_STAND, cushX: inst.base.px, topY: CUSHION_TOP, z0: 0, zTop: inst.base.pz + 0.35 };
    let landed = 0;
    const boing = (n: number) => { w.fx.squish(inst); w.tone(300 + n * 90, 0, 0.16, "sine", 0.08, 160 + n * 60); };
    const cue = (at: number, n: number) => ({ at, fn: () => boing(n) });
    return {
      standX: plan.standX, face: 1, seconds: JUMP_DOWN_S,
      begin: () => { plan.z0 = w.position().z; landed = 0; w.tone(380, 0, 0.1, "triangle", 0.05, 560); },
      tick: (t) => { const p = jumpPath(t, plan); w.setPosition(p.x, p.y, p.z); },
      cues: [
        { at: JUMP_UP_S, fn: () => { boing(landed++); w.clip("cheer"); } },
        cue(JUMP_BOUNCES[0]!.end, 1), cue(JUMP_BOUNCES[1]!.end, 2), cue(JUMP_BOUNCES[2]!.end, 3),
      ],
      end: () => { w.setPosition(plan.standX, 0, plan.z0); },          // always back on the floor where it started, even if cut short
    };
  }

  return {
    get phase(): VisitPhase { return visitor.phase; },
    get busy(): boolean { return visitor.busy; },
    get heartCount(): number { return hearts.length; },
    /**
     * A prop was tapped. A character at rest goes to hug the teddy, jump on the cushions or kick the ball; returns true if it set off. Anything else (another prop, a vehicle, an act already under
     * way, a world that says no) changes nothing: the prop has already reacted by itself.
     */
    tap(inst: PropInst): boolean {
      const kind = ACT_FOR_PROP[inst.type];
      if (!kind || !w.allowed() || w.eater() !== "character") return false;                // (an act already under way refuses a second start itself)
      following = null;
      return visitor.start(kind === "hug" ? hugVisit(inst) : kind === "kick" ? kickVisit(inst) : jumpVisit(inst));
    },
    /** Call first in the world's pointerdown: true means a tap during the action, which must NOT also walk the toy or tap a prop. A tap while the toy is still walking over drops the visit and returns false. */
    consume(): boolean { return visitor.busy ? visitor.tapElsewhere() : false; },
    update(dt: number): void {
      visitor.update(dt);
      if (following && !visitor.busy) {
        const f = following;
        if (!w.allowed()) following = null;
        else if (!f.inst.kick) {                                              // the ball has stopped: trot after it
          following = null;
          const stand = f.inst.base.px - f.dir * FOLLOW_STAND;
          if (Math.abs(w.position().x - stand) > 0.5) w.walkTo(stand, w.position().z);
        }
      }
      for (let i = hearts.length - 1; i >= 0; i--) {
        const h = hearts[i]!;
        h.t += dt;
        const k = Math.min(1, h.t / HEART_RISE_S);
        h.sprite.position.set(h.from.x + h.sway * 0.25 * Math.sin(k * Math.PI * 2), h.from.y + HEART_RISE * k, h.from.z);
        h.sprite.material.opacity = Math.min(1, k * 6) * (1 - Math.max(0, (k - 0.5) / 0.5));
        h.sprite.scale.setScalar(h.size * (0.8 + 0.5 * k));
        if (k >= 1) { h.sprite.parent?.remove(h.sprite); h.sprite.material.dispose(); hearts.splice(i, 1); }
      }
    },
    /** A world change or a new toy: drop whatever is happening (an action in progress is put right) and remove the hearts. */
    reset(): void { visitor.cancel(); clearHearts(); following = null; },
  };
}

export type ToyRoomActs = ReturnType<typeof createActs>;
