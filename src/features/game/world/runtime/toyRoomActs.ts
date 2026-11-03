// The Toy Room things Kip does with its toys (docs/specs/playful-interactions-spec.md section 6): tap the TEDDY and Kip walks over and gives it a hug (hearts float up), tap the CUSHIONS and Kip hops
// up onto the pile, bounces on it with a cheer and hops down, tap the BALL and Kip walks to it and kicks it across the room, tap a BOOK and Kip reads three names aloud, tap the GUITAR and Kip picks it up and
// strums a tune (notes float up), tap the BUBBLE set and Kip blows bubbles (which can be popped), tap the DOG and Kip pets it (it wags and the hearts float up). Each is a `Visit` (visitRoutine.ts: walk over, then act) built here from the prop that was
// tapped; this file also draws the floating hearts. world.ts supplies the facts and the toy's little effects through `ActsWorld`; only a character does these (a vehicle just lets the prop react as it always did).
import * as THREE from "three";
import { BALL_BOUNDS } from "./ballKick";
import type { EaterKind } from "./fruitAppetite";
import { BLOW_PUFFS_S, HUG_SQUEEZE_S, KICK_CONTACT_S, PET_STROKES_S, READ_PAGES_S, STRUM_COUNT, STRUM_EVERY_S } from "./proceduralClips";
import type { PropInst } from "./propReactions";
import type { P3 } from "./sleepRoutine";
import { createVisitor, type Visit, type VisitAdapter, type VisitPhase } from "./visitRoutine";

export type ActKind = "hug" | "kick" | "jump" | "read" | "play" | "blow" | "pet";
/** Which prop type starts which act. */
export const ACT_FOR_PROP: Readonly<Record<string, ActKind>> = { teddy: "hug", ball: "kick", cushions: "jump", books: "read", guitar: "play", bubbles: "blow", dog: "pet" };

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
export const READ_STAND = 1.4;
export const PLAY_STAND = 1.25;
export const BLOW_STAND = 1.15;
export const PET_STAND = 1.9;
export const READ_S = 6.6;
export const PLAY_S = 4.4;
export const BLOW_S = 3.6;
export const PET_S = 2.6;
/** When the dog is told it is being petted (it has just barked from the tap: let the woofs finish before the happy wagging takes over). */
export const PET_CUE_S = 0.6;
/** How many names Kip reads from the book: the nearest named props, one on each page. */
export const READ_NAMES = 3;
/** How many bubbles come out on each puff. */
export const BUBBLES_PER_PUFF = 4;
/** The tune Kip strums: the pitch of each of the STRUM_COUNT strums (C major pentatonic). An even strum is a downstroke (a three-note chord), an odd one an upstroke (one high note). */
export const RIFF: readonly number[] = [392, 330, 392, 523, 440, 392, 330, 262, 330, 392, 440, 392, 330, 262];
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
  clip(action: "hug" | "kick" | "cheer" | "read" | "strum" | "blow" | "pet"): boolean;
  /** Put something in Kip's hands (a book, the guitar, the bubble wand) and take it away again (safe to call when it holds nothing). */
  hold(item: "book" | "guitar" | "wand"): void;
  release(): void;
  /** Where Kip's mouth is while it faces `dir`. */
  mouth(dir: 1 | -1): P3;
  bubbles: { blow(from: P3, dir: 1 | -1, n: number): void };
  /** Place the toy (during the cushion jump). */
  setPosition(x: number, y: number, z: number): void;
  tone(freq: number, delay: number, dur: number, type: OscillatorType, vol: number, slideTo?: number): void;
  /** The phase changed (the world marks the toy busy while it acts). */
  phase(phase: VisitPhase, previous: VisitPhase): void;
  fx: {
    squish(inst: PropInst): void;
    kickBall(inst: PropInst, vx: number, vy: number): boolean;
    /** Flutter a book's pages. */
    flutter(inst: PropInst): void;
    /** Say a prop's name (caption and voice). */
    say(inst: PropInst): void;
    setVisible(inst: PropInst, visible: boolean): void;
    /** Tell a self-animating prop (the dog) something happened. */
    cue(inst: PropInst, name: string): void;
    /** The named props nearest to x, except these types. */
    nearby(x: number, n: number, exclude?: ReadonlyArray<string>): PropInst[];
  };
}

type Glyph = "heart" | "note";
const GLYPH: Record<Glyph, { ch: string; fill: string; glow: string; color: number }> = {
  heart: { ch: "\u2665", fill: "#ff6f9c", glow: "rgba(255,120,170,0.9)", color: 0xff7aa8 },
  note: { ch: "\u266A", fill: "#ffe27a", glow: "rgba(255,210,90,0.9)", color: 0xffd24d },
};
const glyphMaterial = (() => {
  const cache = new Map<Glyph, THREE.SpriteMaterial>();
  return (glyph: Glyph): THREE.SpriteMaterial => {
    const have = cache.get(glyph);
    if (have) return have;
    const spec = GLYPH[glyph];
    const opts: THREE.SpriteMaterialParameters = { color: spec.color, transparent: true, depthWrite: false, fog: false };
    if (typeof document !== "undefined") {
      const c = document.createElement("canvas");
      c.width = c.height = 96;
      const g = c.getContext("2d");
      if (g) {
        g.font = "bold 76px system-ui, sans-serif";
        g.textAlign = "center"; g.textBaseline = "middle";
        g.shadowColor = spec.glow; g.shadowBlur = 12;
        g.fillStyle = spec.fill;
        g.fillText(spec.ch, 48, 50);
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        opts.map = tex; opts.color = 0xffffff;
      }
    }
    const mat = new THREE.SpriteMaterial(opts);
    cache.set(glyph, mat);
    return mat;
  };
})();

interface Floater { sprite: THREE.Sprite; glyph: Glyph; t: number; from: THREE.Vector3; size: number; sway: number }

export function createActs(w: ActsWorld) {
  const hearts: Floater[] = [];                                       // every glyph floating up: hearts and notes
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

  function floater(glyph: Glyph, at: THREE.Vector3, size = 0.4) {
    const sprite = new THREE.Sprite(glyphMaterial(glyph).clone());
    sprite.scale.setScalar(size);
    sprite.position.copy(at);
    sprite.renderOrder = 10;
    w.root().add(sprite);
    hearts.push({ sprite, glyph, t: 0, from: at.clone(), size, sway: hearts.length % 2 ? 1 : -1 });
  }
  const heart = (at: THREE.Vector3, size = 0.4) => floater("heart", at, size);
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

  function readVisit(inst: PropInst): Visit {
    const x = inst.base.px;
    let names: PropInst[] = [];
    return {
      standX: x - READ_STAND, face: 1, seconds: READ_S,
      begin: () => {
        names = w.fx.nearby(x, READ_NAMES, ["books"]);
        if (!names.length) names = [inst];                                // nothing else around: it reads out the book's own name
        w.hold("book");
        w.clip("read");
      },
      cues: READ_PAGES_S.map((at, i) => ({ at, fn: () => { w.fx.flutter(inst); w.fx.say(names[i % names.length]!); w.tone(560, 0, 0.06, "triangle", 0.04, 420); } })),
      end: () => { w.release(); },
    };
  }

  function playVisit(inst: PropInst): Visit {
    const x = inst.base.px, z = inst.base.pz;
    const cues = Array.from({ length: STRUM_COUNT }, (_, i) => {
      const f = RIFF[i % RIFF.length]!;
      return {
        at: 0.2 + (i + 1) * STRUM_EVERY_S,
        fn: () => {
          if (i % 2 === 0) { [f, f * 1.25, f * 1.5].forEach((n, k) => w.tone(n, k * 0.025, 0.4, "triangle", 0.07)); }        // a downstroke: a chord, strummed
          else w.tone(f * 2, 0, 0.3, "triangle", 0.06);                                                                      // an upstroke: one bright note
          if (i % 2 === 0) floater("note", new THREE.Vector3(x - PLAY_STAND + 0.9 + (i % 4) * 0.1, 2.3, z + 0.5), 0.45);
        },
      };
    });
    return {
      standX: x - PLAY_STAND, face: 1, seconds: PLAY_S,
      begin: () => { w.fx.setVisible(inst, false); w.hold("guitar"); w.clip("strum"); },
      cues,
      end: () => { w.release(); w.fx.setVisible(inst, true); },                // the guitar is back on its stand, even if it was cut short
    };
  }

  function blowVisit(inst: PropInst): Visit {
    const x = inst.base.px;
    return {
      standX: x - BLOW_STAND, face: 1, seconds: BLOW_S,
      begin: () => { w.hold("wand"); w.clip("blow"); },
      cues: BLOW_PUFFS_S.map((at) => ({ at, fn: () => w.bubbles.blow(w.mouth(1), 1, BUBBLES_PER_PUFF) })),
      end: () => { w.release(); },
    };
  }

  function petVisit(inst: PropInst): Visit {
    const x = inst.base.px, z = inst.base.pz;
    return {
      standX: x - PET_STAND, face: 1, seconds: PET_S,
      begin: () => { w.clip("pet"); },
      cues: [{ at: PET_CUE_S, fn: () => w.fx.cue(inst, "pet") }, ...PET_STROKES_S.map((at, i) => ({ at, fn: () => { heart(new THREE.Vector3(x - 0.2, inst.size.y + 0.25, z + 0.3), 0.36); if (i % 2 === 1) w.tone(700, 0, 0.1, "triangle", 0.05, 900); } }))],
      end: () => {},
    };
  }

  return {
    get phase(): VisitPhase { return visitor.phase; },
    get busy(): boolean { return visitor.busy; },
    get heartCount(): number { return hearts.filter((h) => h.glyph === "heart").length; },
    get noteCount(): number { return hearts.filter((h) => h.glyph === "note").length; },
    /**
     * A prop was tapped. A character at rest goes to hug the teddy, jump on the cushions or kick the ball; returns true if it set off. Anything else (another prop, a vehicle, an act already under
     * way, a world that says no) changes nothing: the prop has already reacted by itself.
     */
    tap(inst: PropInst): boolean {
      const kind = ACT_FOR_PROP[inst.type];
      if (!kind || !w.allowed() || w.eater() !== "character") return false;                // (an act already under way refuses a second start itself)
      following = null;
      const visit = { hug: hugVisit, kick: kickVisit, jump: jumpVisit, read: readVisit, play: playVisit, blow: blowVisit, pet: petVisit }[kind](inst);
      return visitor.start(visit);
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
