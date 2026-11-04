// The Toy Room's two mess mini-interactions (docs/specs/playful-interactions-spec.md, "Spill and clean up" and "Make a mess, clean it up"; Dan, 2026-11-03: "spilling a drink can be mopped up",
// "make mess level ... the pile ... Oh no, oh no ... Followed by clean? Clean"):
//
//   Tap the juice cup  ->  Kip walks over, the cup tips, a puddle spreads, "Oh no, oh no!", "Clean?" + a Clean button  ->  Kip fetches a mop and mops the puddle away in six strokes, the cup stands
//                         up again, Kip cheers: "All clean! Hooray!".
//   Tap the toy box    ->  Kip walks over and tips it, six toys tumble out into a heap, "Oh no, oh no!", "Clean?" + a Clean button  ->  the box rights itself and the toys fly back in, one by one, each with a
//                         rising note and a count ("1 toy home!" ... "All 6 toys home!"), then a cheer.
//
// Nothing here can go wrong for the child: there is no timer, no score, no wrong tool and no failure. A mess waits for as long as it takes to say "Clean"; one mess at a time; a world change or a
// new toy puts everything right. This file is the state machine and the meshes' per-frame placement; the numbers are messModel.ts, the meshes messScene.ts, the card messPrompt.ts, and
// toyRoomActs.ts runs the visits (walk over, then act) through `ActsWorld.mess`.
//
// Every picture has a still alternative for `reduced()` (prefers-reduced-motion): the mess appears finished, the mop and the toys change in steps instead of moving. Every line Kip says is also
// shown as text (a toast, or the card), so a muted game loses nothing.
import type * as THREE from "three";
import { ALL_CLEAN, CLEAN_Q, OH_NO, countCaption } from "./messLines";
import {
  BOX_STAND, BOX_STAND_Z, BOX_TILT, CUP_LIE, DUMP_OHNO_AT_S, DUMP_PROMPT_AT_S, DUMP_S, DUMP_TIP_AT_S, IN_BOX, IN_PILE, MOP_CHEER_AT_S, MOP_END_S, MOP_EVERY_S, MOP_S, MOP_STAND, MOP_START_S, MOP_STROKES,
  PILE_TOYS, PUDDLE_DX, PUDDLE_DEPTH, PUDDLE_DZ, PUDDLE_R, SPILL_DONE_S, SPILL_OHNO_AT_S, SPILL_PROMPT_AT_S, SPILL_S, SPILL_STAND, SPILL_STAND_Z, SPILL_TIP_AT_S, TIDY_CHEER_AT_S, TUMBLE_DONE_S,
  boxTiltDump, boxTiltTidy, cupTilt, cupTiltWhileMopping, homeAt, landsAt, puddleGrow, puddleLeft, streamLevel, strokeEndsAt, tidyEndsAt, tidyPose, tidyVisitSeconds, toysHome, tumblePose,
} from "./messModel";
import { createMessPrompt } from "./messPrompt";
import { TABLE_TOP_Y, createPuddle, placeAt, type Puddle } from "./messScene";
import type { PropInst } from "./propReactions";
import type { Visit } from "./visitRoutine";

export type MessPhase = "idle" | "making" | "messy" | "cleaning";
export type MessKind = "spill" | "dump";

/** What the mess needs from the game. */
export interface MessWorld {
  /** Where the puddle lives (the world's root, so a world change takes it away). */
  root(): THREE.Object3D;
  /** The stage's element, for the Clean card (null while there is none). */
  host(): HTMLElement | null;
  /** The player asked for less motion. */
  reduced(): boolean;
  /** Say one of the lines in messLines.ts with the game's voice (a no-op when muted or offline). */
  say(text: string): void;
  /** Show a line as text (the toast): the twin of every spoken line, and the count. */
  toast(text: string): void;
  tone(freq: number, delay: number, dur: number, type: OscillatorType, vol: number, slideTo?: number): void;
  /** Play a character clip; false if it cannot (reduced motion, not loaded). */
  clip(action: "oops" | "mop" | "tidy" | "cheer"): boolean;
  /** Put the mop in Kip's hands, and take it away again (safe to call when it holds nothing). */
  hold(item: "mop"): void;
  release(): void;
  /** Start a visit on the toy: false (and nothing happens) if one is already under way. */
  run(visit: Visit): boolean;
}

const C_PENTATONIC = [523, 587, 659, 784, 880, 1047] as const;

export function createMess(w: MessWorld) {
  let phase: MessPhase = "idle";
  let kind: MessKind | null = null;
  let target: PropInst | null = null;
  let puddle: Puddle | null = null;
  let spot = { x: 0, z: 0 };
  /** Seconds since the thing started; -1 = not running. */
  let spillClock = -1, dumpClock = -1, mopClock = -1, tidyClock = -1;
  /** How much of the puddle is left as a fraction of its full size when a mopping starts (1, or less if a mopping was cut short). */
  let puddleBase = 1;
  /** The toys still out of the box, in the order they go home. */
  let outToys: number[] = [];
  /** The toys that were out when this tidying began, and the lean the box had then. */
  let tidyFrom: number[] = [];
  let boxTiltBase = BOX_TILT;
  let asked = false;
  /** Bumped by every reset: a visit made before it, and cut short after it (the order the world resets things in is not ours to rely on), must change nothing. */
  let gen = 0;
  const prompt = createMessPrompt({ host: () => w.host(), onClean: () => { clean(); } });

  const cupOf = (inst: PropInst) => {
    const u = inst.holder.userData;
    return u.cup && u.stream ? { cup: u.cup as THREE.Object3D, juice: u.juice as THREE.Object3D | undefined, stream: u.stream as THREE.Mesh } : null;
  };
  const boxOf = (inst: PropInst) => {
    const u = inst.holder.userData;
    return Array.isArray(u.toys) && u.toys.length === PILE_TOYS && u.boxPivot ? { pivot: u.boxPivot as THREE.Object3D, toys: u.toys as THREE.Object3D[] } : null;
  };

  // ---- placing the pictures --------------------------------------------------------------------------------------------------

  function setPuddle(size: number) {
    if (!puddle) return;
    puddle.set(spot.x, spot.z, size, PUDDLE_R, PUDDLE_R * PUDDLE_DEPTH);
  }
  function applySpill(s: number) {
    const p = target ? cupOf(target) : null;
    if (!p) return;
    const tilt = cupTilt(s);
    p.cup.rotation.x = tilt;
    if (p.juice) p.juice.visible = tilt < 0.35;                                              // the juice has poured out
    const lv = streamLevel(s), len = Math.max(0.001, lv * (TABLE_TOP_Y - 0.04));
    p.stream.visible = lv > 0.01;
    p.stream.scale.y = len;
    p.stream.position.y = TABLE_TOP_Y - len / 2;
    setPuddle(puddleGrow(s));
  }
  function applyMop(t: number) {
    const p = target ? cupOf(target) : null;
    const reduced = w.reduced();
    // Reduced motion: the puddle shrinks in six steps (at the end of each stroke) and the cup stands up when the mopping is done, with no tween in between.
    const strokesDone = Math.max(0, Math.min(MOP_STROKES, Math.floor((t - MOP_START_S) / MOP_EVERY_S + 1e-9)));
    const left = reduced ? 1 - strokesDone / MOP_STROKES : puddleLeft(t);
    setPuddle(puddleBase * left);
    if (p) p.cup.rotation.x = reduced ? (t >= MOP_END_S ? 0 : CUP_LIE) : cupTiltWhileMopping(t);
  }
  function applyDump(d: number) {
    const b = target ? boxOf(target) : null;
    if (!b) return;
    b.pivot.rotation.x = boxTiltDump(d);
    for (let i = 0; i < PILE_TOYS; i++) placeAt(b.toys[i]!, tumblePose(i, d));
  }
  function applyTidy(t: number) {
    const b = target ? boxOf(target) : null;
    if (!b) return;
    const reduced = w.reduced();
    b.pivot.rotation.x = reduced ? (t >= 0.2 ? 0 : boxTiltBase) : boxTiltTidy(t, boxTiltBase);
    for (let i = 0; i < PILE_TOYS; i++) {
      const slot = tidyFrom.indexOf(i);
      if (slot < 0) { placeAt(b.toys[i]!, IN_BOX[i]!); continue; }                          // already home
      placeAt(b.toys[i]!, reduced ? (t >= homeAt(slot) ? IN_BOX[i]! : IN_PILE[i]!) : tidyPose(i, slot, t));
    }
  }
  /** Every toy at rest where the state says: the ones still out on the floor, the rest in the box, the box at its lean. */
  function applyResting() {
    const b = target ? boxOf(target) : null;
    if (!b) return;
    b.pivot.rotation.x = boxTiltBase;
    for (let i = 0; i < PILE_TOYS; i++) placeAt(b.toys[i]!, outToys.includes(i) ? IN_PILE[i]! : IN_BOX[i]!);
  }

  // ---- what Kip says and the question ----------------------------------------------------------------------------------------

  const ohNo = () => { w.say(OH_NO); w.toast(OH_NO); };
  /** The mess is made and has settled: ask. The words are on the card, so no toast; the voice says them once. */
  function askToClean(speak: boolean) {
    if (phase !== "making" && phase !== "messy") return;
    phase = "messy";
    if (speak && !asked) w.say(CLEAN_Q);
    asked = true;
    prompt.show();
  }

  // ---- making the mess -------------------------------------------------------------------------------------------------------

  function startSpill(inst: PropInst) {
    kind = "spill";
    target = inst;
    spot = { x: inst.base.px + PUDDLE_DX, z: inst.base.pz + PUDDLE_DZ };
    puddleBase = 1;
    if (!puddle) { puddle = createPuddle(); w.root().add(puddle.group); }
    setPuddle(0);
    spillClock = 0;
    w.tone(520, 0, 0.1, "sine", 0.07, 200);                                                   // the cup hits the table
    w.tone(300, 0.35, 0.18, "sine", 0.05, 120);                                               // the splash
    asked = false;
  }
  function startDump(inst: PropInst) {
    kind = "dump";
    target = inst;
    outToys = Array.from({ length: PILE_TOYS }, (_, i) => i);
    tidyFrom = [];
    boxTiltBase = BOX_TILT;
    dumpClock = 0;
    for (let i = 0; i < PILE_TOYS; i++) w.tone(200 - i * 12, landsAt(i), 0.09, "triangle", 0.07, 110);   // a thud as each toy lands
    asked = false;
  }

  function spillVisit(inst: PropInst): Visit | null {
    if (!cupOf(inst)) return null;
    let started = false;
    const g = gen;
    return {
      standX: inst.base.px - SPILL_STAND, standZ: SPILL_STAND_Z, face: 1, seconds: SPILL_S,
      begin: () => { phase = "making"; kind = "spill"; target = inst; w.clip("oops"); },
      cues: [
        { at: SPILL_TIP_AT_S, fn: () => { started = true; startSpill(inst); } },
        { at: SPILL_OHNO_AT_S, fn: ohNo },
        { at: SPILL_PROMPT_AT_S, fn: () => askToClean(true) },
      ],
      end: () => {
        if (g !== gen) return;
        if (!started) { phase = "idle"; kind = null; target = null; return; }                // Kip never got to the cup: nothing happened
        askToClean(false);                                                                    // a mess that has begun is a mess, so the question is there whatever cut the visit short
      },
    };
  }
  function dumpVisit(inst: PropInst): Visit | null {
    if (!boxOf(inst)) return null;
    let started = false;
    const g = gen;
    return {
      standX: inst.base.px - BOX_STAND, standZ: BOX_STAND_Z, face: 1, seconds: DUMP_S,
      begin: () => { phase = "making"; kind = "dump"; target = inst; w.clip("oops"); },
      cues: [
        { at: DUMP_TIP_AT_S, fn: () => { started = true; startDump(inst); } },
        { at: DUMP_OHNO_AT_S, fn: ohNo },
        { at: DUMP_PROMPT_AT_S, fn: () => askToClean(true) },
      ],
      end: () => {
        if (g !== gen) return;
        if (!started) { phase = "idle"; kind = null; target = null; return; }
        askToClean(false);
      },
    };
  }

  // ---- cleaning up -----------------------------------------------------------------------------------------------------------

  function finishClean() {
    if (kind === "spill") {
      setPuddle(0);
      const p = target ? cupOf(target) : null;
      if (p) { p.cup.rotation.x = 0; if (p.juice) p.juice.visible = true; }
    } else if (kind === "dump") {
      tidyFrom = [];
      outToys = [];
      boxTiltBase = 0;
      applyResting();
    }
    mopClock = tidyClock = -1;
    phase = "idle";
    kind = null;
    target = null;
    asked = false;
  }

  function mopVisit(): Visit {
    const g = gen;
    const strokes = Array.from({ length: MOP_STROKES }, (_, i) => ({ at: strokeEndsAt(i), fn: () => w.tone(260 + (i % 2) * 40, 0, 0.16, "sine", 0.05, 150) }));   // a swish
    return {
      standX: spot.x - MOP_STAND, standZ: spot.z, face: 1, seconds: MOP_S,
      begin: () => { phase = "cleaning"; prompt.hide(); mopClock = 0; w.hold("mop"); w.clip("mop"); },
      cues: [
        ...strokes,
        { at: MOP_CHEER_AT_S, fn: () => { w.release(); w.clip("cheer"); w.say(ALL_CLEAN); w.toast(ALL_CLEAN); [523, 659, 784].forEach((f, k) => w.tone(f, k * 0.09, 0.2, "triangle", 0.06)); } },
      ],
      end: (completed) => {
        w.release();
        if (g !== gen) return;
        if (completed) { finishClean(); return; }
        // Cut short (a world change or a new toy): what is left is still there, and the question is asked again.
        puddleBase = puddleBase * (w.reduced() ? 1 - Math.max(0, Math.min(MOP_STROKES, Math.floor((mopClock - MOP_START_S) / MOP_EVERY_S + 1e-9))) / MOP_STROKES : puddleLeft(mopClock));
        mopClock = -1;
        setPuddle(puddleBase);
        phase = "messy";
        prompt.show();
      },
    };
  }

  function tidyVisit(): Visit {
    const g = gen;
    const inst = target!;
    const n = outToys.length;
    tidyFrom = outToys.slice();
    boxTiltBase = boxOf(inst)?.pivot.rotation.x ?? BOX_TILT;
    const total = PILE_TOYS;
    const homes = tidyFrom.map((_, slot) => ({
      at: homeAt(slot),
      fn: () => {
        const home = total - (n - (slot + 1));                                               // toys in the box now, counting the ones that never left
        w.tone(C_PENTATONIC[Math.min(C_PENTATONIC.length - 1, slot)]!, 0, 0.2, "triangle", 0.07);
        w.toast(countCaption(home, total));
      },
    }));
    return {
      standX: inst.base.px - BOX_STAND, standZ: BOX_STAND_Z, face: 1, seconds: tidyVisitSeconds(n),
      begin: () => { phase = "cleaning"; prompt.hide(); tidyClock = 0; w.clip("tidy"); },
      cues: [
        ...homes,
        { at: tidyEndsAt(n) + TIDY_CHEER_AT_S, fn: () => { w.clip("cheer"); w.say(ALL_CLEAN); [523, 659, 784].forEach((f, k) => w.tone(f, k * 0.09, 0.2, "triangle", 0.06)); } },
      ],
      end: (completed) => {
        if (g !== gen) return;
        if (completed) { finishClean(); return; }
        const home = toysHome(n, tidyClock);
        outToys = tidyFrom.slice(home);                                                       // the toys that did not get home are back on the floor
        boxTiltBase = boxTiltTidy(tidyClock, boxTiltBase);
        tidyClock = -1;
        tidyFrom = [];
        applyResting();
        phase = "messy";
        prompt.show();
      },
    };
  }

  /** The Clean button: Kip goes to clean up. False if there is nothing to clean or Kip is busy (the card stays, and the button can be pressed again). */
  function clean(): boolean {
    if (phase !== "messy" || !target) return false;
    return w.run(kind === "spill" ? mopVisit() : tidyVisit());
  }

  return {
    get phase(): MessPhase { return phase; },
    get kind(): MessKind | null { return kind; },
    /** How much of the puddle there is now, 0 to about 1. */
    get puddleSize(): number { return puddle?.group.visible ? puddle.group.scale.x / PUDDLE_R : 0; },
    /** Where the puddle's centre is on the floor while there is one (for the camera tests and the dev handle), else null. */
    get puddleAt(): { x: number; z: number } | null { return puddle?.group.visible ? { ...spot } : null; },
    /** How many toys are out of the box. */
    get toysOut(): number { return kind === "dump" ? outToys.length : 0; },
    get promptVisible(): boolean { return prompt.visible; },
    /** The visit a tap on the cup ("spill") or the toy box ("dump") starts, or null when there is a mess already or the prop is not one of ours. */
    visitFor(k: MessKind, inst: PropInst): Visit | null {
      if (phase !== "idle") return null;
      return k === "spill" ? spillVisit(inst) : dumpVisit(inst);
    },
    clean,
    update(dt: number): void {
      const reduced = w.reduced();
      if (spillClock >= 0) {
        spillClock += dt;
        if (reduced || spillClock >= SPILL_DONE_S + 0.05) { applySpill(1e6); spillClock = -1; } else applySpill(spillClock);
      }
      if (dumpClock >= 0) {
        dumpClock += dt;
        if (reduced || dumpClock >= TUMBLE_DONE_S + 0.05) { applyDump(1e6); dumpClock = -1; } else applyDump(dumpClock);
      }
      if (mopClock >= 0) { mopClock += dt; applyMop(mopClock); }
      if (tidyClock >= 0) { tidyClock += dt; applyTidy(tidyClock); }
    },
    /** A world change or a new toy: everything is put right and the card and the puddle are gone. */
    reset(): void {
      gen++;
      spillClock = dumpClock = mopClock = tidyClock = -1;
      phase = "idle";
      kind = null;
      target = null;
      outToys = [];
      tidyFrom = [];
      puddleBase = 1;
      boxTiltBase = BOX_TILT;
      asked = false;
      prompt.dispose();
      puddle?.dispose();
      puddle = null;
    },
  };
}

export type Mess = ReturnType<typeof createMess>;
