// The cooking level (docs/specs/play-design-spec.md, "Activity levels", activity 2; Dan, 2026-11-03: "separate levels on cooking, cleaning etc"): pancakes, in five beats.
//
//   1. crack the egg (tap it)        2. pour the batter and count (tap the bowl; Kip counts "One!" ... up to the number on the card)        3. "it's hot!" (a grown-up holds one button for 1.2 s)
//   4. flip (swipe up on the pan)    5. serve (carry one pancake to each plate: one to one)                                                    then Kip cheers: "Yummy pancakes! Hooray!"
//
// The concept: counting to N (cookModel.ts: the spoons are the pancakes are the plates). Each beat is one primitive (the play-design Q1 decision): taps, the shared `flick` (flick.ts) for the flip,
// the shared `carry` (carry.ts) for the serve. Nothing here can go wrong for the child: no timer, no score, no failure. A missed flip is a kind line and a wider window; the first two bands cannot miss;
// a plate that already has its pancake sends the pancake back with a kind line; the hot pan is never drawn as something to touch, and "it's hot" is a GROWN-UP'S line (Q2), never a promise it is safe.
//
// Two doors, one implementation: the Toy Room's hob (`visitFor`) and the Map's rung `daily.cook` (`startRung`, which pays the rung's stars and XP through the world's own path, `rungWin`). No printable
// part is unlocked as a reward. This file is the state machine; the numbers are cookModel.ts, the meshes cookScene.ts, the card activityPrompt.ts, the words cookLines.ts.
//
// Every picture has a still alternative for `reduced()`: things appear finished, the flip is a change of colour, nothing flies. Every line Kip says is also shown as text, so a muted game loses nothing.
import { applyDrop, createCarryState, type CarryState } from "./carry";
import { COOK_CRACK, COOK_COUNT, COOK_DONE, COOK_FLIP, COOK_FLIP_AGAIN, COOK_HOT, COOK_HOT_OK, COOK_INTRO, COOK_POUR, COOK_PROMPT_LINES, COOK_SERVE, COOK_SERVE_AGAIN, COOK_TEXT } from "./cookLines";
import {
  BOWL, COOK_AHEAD, COOK_ASK_AT_S, COOK_Z, COOK_CHEER_S, COOK_INTRO_AT_S, COOK_MAKE_S, COOK_WIN_AT_S, COUNT_GAP_S, CRACK_S, EGG, FLIP_S, HOB_STAND, PAN, SERVE_S, SPOON_S,
  cookPlan, crackPose, plateAt, plateOffset, serveParams, type CookPlan,
} from "./cookModel";
import { createCookSet, type CookSet } from "./cookScene";
import { createActivityPrompt, HOLD_MS, type ActivityPrompt, type PromptButton, type PromptSpec } from "./activityPrompt";
import { createFlickState, flickAttempt, flickSwitch, flickWindowAt, type FlickState } from "./flick";
import type { Activity, ActivityHeld, ActivityWorld, PointerLike } from "./activityTypes";
import type { PropInst } from "./propReactions";
import type { Visit } from "./visitRoutine";

export type CookPhase = "idle" | "making" | "egg" | "pour" | "hot" | "flip" | "serve" | "cheer";

/** The prop that starts the level in the Toy Room, and the rung that starts it from the Map. */
export const COOK_PROP = "hob";
export const COOK_RUNG = "daily.cook";
const RUNG_RETRY_S = 6;
/** A missed flip's line is spoken at most this often (seconds apart); the toast is always there. */
const AGAIN_SPEAK_GAP_S = 3;

export function createCook(w: ActivityWorld): Activity & { nextStart: number; snapshotParts(): unknown } {
  let phase: CookPhase = "idle";
  let source: "prop" | "rung" | null = null;
  let plan: CookPlan = cookPlan(0);
  let set: CookSet | null = null;
  let anchor = { x: 0, z: 0 };
  let lineText: string = COOK_CRACK;
  let poured = 0, hot = false;
  let flick: FlickState = createFlickState(plan.flick);
  let carry: CarryState = createCarryState(serveParams(1));
  let selected: number | null = null;
  let swipe: { id: number; x: number; y: number } | null = null;
  let dragId: number | null = null;
  /** Seconds since each thing began; -1 = not running. */
  let clock = 0, eggClock = -1, flipClock = -1, flipStart = 0, cheerClock = -1, spoonAt: number[] = [], serveAnim: Array<{ i: number; j: number; t: number }> = [];
  let lastCount = -9, lastAgain = -9;
  let rungWon = false, pendingRung: number | null = null;
  let nextStart = 0;
  /** Bumped by every reset: a visit made before it, and ended after it, must change nothing. */
  let gen = 0;
  const prompt: ActivityPrompt = createActivityPrompt({ host: () => w.host(), onPress: (id) => press(id), ...(w.timers ? { timers: w.timers } : {}), reduced: () => w.reduced() });

  const speak = (text: string) => { w.say(text); w.toast(text); };

  // ---- the card --------------------------------------------------------------------------------------------------------------

  function cardSpec(): PromptSpec {
    const buttons: PromptButton[] = [];
    if (phase === "egg") buttons.push({ id: "crack", label: `\u{1F95A} ${COOK_TEXT.crack}`, aria: COOK_TEXT.crack });
    else if (phase === "pour") buttons.push({ id: "spoon", label: `\u{1F944} ${COOK_TEXT.spoon} (${COOK_TEXT.progress(poured, plan.spoons)})`, aria: `${COOK_TEXT.spoon}, ${COOK_TEXT.progress(poured, plan.spoons)}` });
    else if (phase === "hot") buttons.push({ id: "hot", label: `\u{1F525} ${COOK_TEXT.hot}`, aria: COOK_TEXT.hotAria, hold: true });
    else if (phase === "flip") buttons.push({ id: "flip", label: `\u{1F95E} ${COOK_TEXT.flip}`, aria: COOK_TEXT.flip });
    else if (phase === "serve") buttons.push({ id: "serve", label: `\u{1F37D}️ ${COOK_TEXT.serve} (${COOK_TEXT.progress(Object.keys(carry.placed).length, plan.spoons)})`, aria: `${COOK_TEXT.serve}, ${COOK_TEXT.progress(Object.keys(carry.placed).length, plan.spoons)}` });
    return { line: lineText, buttons, group: COOK_TEXT.group };
  }
  function refresh() { if (phase !== "idle" && phase !== "making" && phase !== "cheer") prompt.show(cardSpec()); }

  // ---- beginning -------------------------------------------------------------------------------------------------------------

  function visitAt(at: { x: number; z: number }, standX: number, src: "prop" | "rung"): Visit {
    const g = gen;
    let started = false;
    return {
      standX, face: 1, seconds: COOK_MAKE_S,
      begin: () => {
        started = true;
        phase = "making";
        source = src;
        plan = cookPlan(w.band(), nextStart++);
        anchor = { x: at.x, z: w.kip().z + COOK_Z };
        poured = 0; hot = false; selected = null; swipe = null; dragId = null;
        eggClock = flipClock = cheerClock = -1;
        spoonAt = Array.from({ length: plan.spoons }, () => -1);
        serveAnim = [];
        flick = createFlickState(plan.flick);
        carry = createCarryState(serveParams(plan.spoons));
        rungWon = false;
        lineText = COOK_CRACK;
        set = createCookSet(plan.spoons);
        set.place(anchor.x, anchor.z);
        set.setEgg(0, 0, 0);
        w.root().add(set.group);
        w.hold("spatula" as ActivityHeld);
        w.tone(392, 0, 0.12, "triangle", 0.05);
      },
      cues: [
        { at: COOK_INTRO_AT_S, fn: () => speak(COOK_INTRO) },
        { at: COOK_ASK_AT_S, fn: () => enterEgg() },
      ],
      end: () => {
        if (g !== gen || !started) return;
        enterEgg();                                                                         // a kitchen that has begun is a kitchen, whatever cut the visit short
      },
    };
  }
  function visitFor(inst: PropInst): Visit | null {
    if (inst.type !== COOK_PROP || phase !== "idle" || w.busy()) return null;
    const standX = inst.base.px + HOB_STAND;
    return visitAt({ x: standX + COOK_AHEAD, z: w.kip().z }, standX, "prop");
  }
  function startRung(): boolean {
    if (phase !== "idle" || w.busy()) return false;
    const k = w.kip();
    const ok = w.run(visitAt({ x: k.x + COOK_AHEAD, z: k.z }, k.x, "rung"));
    pendingRung = ok ? null : (pendingRung ?? RUNG_RETRY_S);
    return ok;
  }

  // ---- the beats -------------------------------------------------------------------------------------------------------------

  function enterEgg() {
    if (phase !== "making") return;
    phase = "egg";
    lineText = COOK_CRACK;
    speak(COOK_CRACK);
    refresh();
  }
  function crack() {
    if (phase !== "egg" || eggClock >= 0) return;
    eggClock = 0;
    w.clip("tidy");
    w.tone(300, 0, 0.08, "square", 0.05, 200);
    w.tone(240, 0.35, 0.1, "square", 0.05, 160);
    prompt.hide();
    if (w.reduced()) finishCrack();
  }
  function finishCrack() {
    eggClock = -1;
    set?.setEgg(0, 1, 1);
    set?.setBatter(true);
    phase = "pour";
    lineText = `${COOK_TEXT.target(plan.spoons)}. ${COOK_POUR}`;
    speak(COOK_POUR);
    refresh();
  }
  function spoon() {
    if (phase !== "pour" || poured >= plan.spoons) return;
    const i = poured++;
    spoonAt[i] = w.reduced() ? SPOON_S : 0;
    if (w.reduced()) set?.setSpoon(i, SPOON_S);
    const line = COOK_COUNT[i] ?? `${i + 1}!`;
    w.toast(line);
    if (clock - lastCount >= COUNT_GAP_S || poured >= plan.spoons) { w.say(line); lastCount = clock; }
    w.tone(440 + i * 70, 0, 0.14, "triangle", 0.06);
    w.clip("tidy");
    lineText = `${COOK_TEXT.target(plan.spoons)}: ${COOK_TEXT.progress(poured, plan.spoons)}`;
    if (poured >= plan.spoons) { prompt.hide(); if (w.reduced()) enterHot(); }
    else refresh();
  }
  function enterHot() {
    if (phase !== "pour") return;
    phase = "hot";
    set?.setHeat(true);
    lineText = COOK_HOT;
    speak(COOK_HOT);
    refresh();
  }
  function confirmHot() {
    if (phase !== "hot") return;
    hot = true;
    speak(COOK_HOT_OK);
    w.tone(660, 0, 0.14, "triangle", 0.06);
    enterFlip();
  }
  function enterFlip() {
    phase = "flip";
    flick = createFlickState(plan.flick);
    flipStart = clock;
    lineText = COOK_FLIP;
    speak(COOK_FLIP);
    refresh();
  }
  function flipAttempt(dxPx: number, dyPx: number) {
    if (phase !== "flip" || flipClock >= 0) return;
    const r = flickAttempt(flick, plan.flick, { t: clock - flipStart, dx: dxPx, dy: dyPx });
    afterFlick(r.event, r.state);
  }
  function afterFlick(event: string, state: FlickState) {
    flick = state;
    if (event === "wrong") {
      lineText = COOK_FLIP_AGAIN;
      w.toast(COOK_FLIP_AGAIN);
      if (clock - lastAgain >= AGAIN_SPEAK_GAP_S) { w.say(COOK_FLIP_AGAIN); lastAgain = clock; }
      w.tone(190, 0, 0.12, "square", 0.04, 130);
      refresh();
    } else if (event === "done" || event === "progress") {
      flipClock = 0;
      prompt.hide();
      set?.setRing(0);
      w.clip("mop");
      w.tone(520, 0, 0.1, "triangle", 0.06, 900);
      if (w.reduced()) finishFlip();
    }
  }
  function finishFlip() {
    flipClock = -1;
    set?.setFlip(FLIP_S, true);
    enterServe();
  }
  function enterServe() {
    phase = "serve";
    selected = null;
    lineText = COOK_SERVE;
    speak(COOK_SERVE);
    refresh();
  }
  /** Pick up the next pancake that is still in the pan. */
  function pickUp(): boolean {
    if (phase !== "serve" || selected !== null) return selected !== null;
    for (let i = 0; i < plan.spoons; i++) if (carry.placed[`pancake${i}`] === undefined && !serveAnim.some((a) => a.i === i)) { selected = i; set?.setHeld(i, true); w.tone(600, 0, 0.06, "triangle", 0.04); return true; }
    return false;
  }
  function dropOn(j: number) {
    if (phase !== "serve" || selected === null) return;
    const i = selected;
    selected = null;
    const r = applyDrop(carry, serveParams(plan.spoons), `pancake${i}`, `plate${j}`);
    carry = r.state;
    if (r.event === "wrong") {
      set?.setHeld(i, false);
      lineText = COOK_SERVE_AGAIN;
      speak(COOK_SERVE_AGAIN);
      w.tone(190, 0, 0.12, "square", 0.04, 130);
      refresh();
      return;
    }
    serveAnim.push({ i, j, t: w.reduced() ? SERVE_S : 0 });
    if (w.reduced()) set?.setServe(i, j, 1);
    w.clip("tidy");
    w.tone(700 + j * 60, 0.25, 0.12, "triangle", 0.06);
    lineText = COOK_SERVE;
    if (r.event === "done") { prompt.hide(); if (w.reduced()) finishAll(); } else refresh();
  }
  /** The switch form: the next pancake onto the next free plate. */
  function serveNext() {
    if (phase !== "serve") return;
    if (selected === null && !pickUp()) return;
    for (let j = 0; j < plan.spoons; j++) if (!Object.values(carry.placed).includes(`plate${j}`)) { dropOn(j); return; }
  }
  function finishAll() {
    if (phase !== "serve") return;
    phase = "cheer";
    cheerClock = 0;
    prompt.hide();
    set?.setHeat(false);
    w.release();
    w.clip("cheer");
    speak(COOK_DONE);
    [523, 659, 784, 1047].forEach((f, k) => w.tone(f, k * 0.09, 0.2, "triangle", 0.06));
  }
  function endCheer() {
    prompt.dispose();
    set?.dispose();
    set = null;
    phase = "idle";
    source = null;
    cheerClock = -1;
  }

  // ---- the finger ------------------------------------------------------------------------------------------------------------

  const hit = (e: PointerLike, part: "egg" | "bowl" | "pan"): boolean => Boolean(set && w.pick(e.clientX, e.clientY, [set.parts[part]]));
  function plateUnder(e: PointerLike): number {
    const fl = w.floorAt(e.clientX, e.clientY);
    return fl ? plateAt(fl.x - anchor.x, fl.z - anchor.z, plan.spoons) : -1;
  }
  function down(e: PointerLike): boolean {
    if (!set || phase === "idle" || phase === "making" || phase === "cheer") return false;
    if (phase === "egg") { if (hit(e, "egg")) { crack(); return true; } return false; }
    if (phase === "pour") { if (hit(e, "bowl")) { spoon(); return true; } return false; }
    if (phase === "flip") { if (hit(e, "pan")) { swipe = { id: e.pointerId, x: e.clientX, y: e.clientY }; return true; } return false; }
    if (phase === "serve") {
      if (hit(e, "pan")) { pickUp(); dragId = e.pointerId; return true; }
      if (selected !== null) { const j = plateUnder(e); if (j >= 0) { dropOn(j); return true; } }
      return false;
    }
    return false;
  }
  function move(e: PointerLike): boolean { return (swipe !== null && swipe.id === e.pointerId) || (dragId !== null && dragId === e.pointerId); }
  function up(e: PointerLike): boolean {
    if (swipe && swipe.id === e.pointerId) {
      const s = swipe;
      swipe = null;
      flipAttempt(e.clientX - s.x, s.y - e.clientY);                                          // up is positive
      return true;
    }
    if (dragId !== null && dragId === e.pointerId) {
      dragId = null;
      if (phase === "serve" && selected !== null) { const j = plateUnder(e); if (j >= 0) dropOn(j); }
      return true;
    }
    return false;
  }
  function cancel() { swipe = null; dragId = null; }

  // ---- the buttons -----------------------------------------------------------------------------------------------------------

  function press(id: string) {
    if (id === "crack") crack();
    else if (id === "spoon") spoon();
    else if (id === "hot") confirmHot();
    else if (id === "flip" && phase === "flip" && flipClock < 0) { const r = flickSwitch(flick, plan.flick); afterFlick(r.event, r.state); }
    else if (id === "serve") serveNext();
  }

  // ---- the world's calls -----------------------------------------------------------------------------------------------------

  function update(dt: number) {
    clock += dt;
    const reduced = w.reduced();
    set?.update(dt, reduced);
    if (pendingRung !== null) {
      pendingRung -= dt;
      if (pendingRung <= 0) pendingRung = null;
      else if (phase === "idle" && !w.busy() && startRung()) pendingRung = null;
    }
    if (eggClock >= 0) {
      eggClock += dt;
      const p = crackPose(eggClock);
      set?.setEgg(p.shake, p.split, p.drop);
      if (eggClock >= CRACK_S) finishCrack();
    }
    for (let i = 0; i < spoonAt.length; i++) {
      if (spoonAt[i]! < 0 || spoonAt[i]! >= SPOON_S) continue;
      spoonAt[i] = spoonAt[i]! + dt;
      set?.setSpoon(i, Math.min(SPOON_S, spoonAt[i]!));
    }
    if (phase === "pour" && poured >= plan.spoons && spoonAt.every((t) => t >= SPOON_S)) enterHot();
    if (phase === "flip" && flipClock < 0) set?.setRing(flickWindowAt(flick, plan.flick, clock - flipStart));
    if (flipClock >= 0) {
      flipClock += dt;
      set?.setFlip(Math.min(FLIP_S, flipClock), true);
      if (flipClock >= FLIP_S) finishFlip();
    }
    for (let k = serveAnim.length - 1; k >= 0; k--) {
      const a = serveAnim[k]!;
      if (a.t >= SERVE_S) continue;
      a.t = Math.min(SERVE_S, a.t + dt);
      set?.setServe(a.i, a.j, a.t / SERVE_S);
    }
    if (phase === "serve" && carry.done && serveAnim.every((a) => a.t >= SERVE_S)) finishAll();
    if (cheerClock >= 0) {
      cheerClock += dt;
      if (!rungWon && source === "rung" && cheerClock >= COOK_WIN_AT_S) { rungWon = true; w.rungWin?.(); }
      if (cheerClock >= COOK_CHEER_S) endCheer();
    }
  }
  function reset() {
    gen++;
    phase = "idle";
    source = null;
    swipe = null; dragId = null; selected = null;
    eggClock = flipClock = cheerClock = -1;
    spoonAt = []; serveAnim = [];
    pendingRung = null;
    rungWon = false;
    prompt.dispose();
    set?.dispose();
    set = null;
  }

  function snapshotParts() {
    const P = (x: number, y: number, z: number) => w.project(anchor.x + x, y, anchor.z + z);
    return {
      egg: P(EGG.x, EGG.y + 0.14, EGG.z), bowl: P(BOWL.x, BOWL.y + 0.2, BOWL.z), pan: P(PAN.x, PAN.y, PAN.z),
      plates: Array.from({ length: plan.spoons }, (_, j) => { const o = plateOffset(j, plan.spoons); return P(o.x, 0.05, o.z); }),
    };
  }

  return {
    id: "cook",
    get active() { return phase !== "idle"; },
    get phase() { return phase; },
    get promptVisible() { return prompt.visible; },
    get nextStart() { return nextStart; },
    set nextStart(n: number) { nextStart = Math.max(0, Math.floor(n)); },
    visitFor, startRung, down, move, up, cancel, press, update, reset, snapshotParts,
    snapshot() {
      return {
        id: "cook" as const, phase, band: plan.band, source, promptIds: prompt.ids,
        detail: {
          plan: { spoons: plan.spoons, range: plan.range, flick: { window: plan.flick.window, tapFlicks: plan.flick.tapFlicks, needed: plan.flick.needed } },
          poured, hot, line: lineText, flick: { hits: flick.hits, misses: flick.misses, window: flick.window, done: flick.done }, selected, served: Object.keys(carry.placed).length, placed: { ...carry.placed },
          pancakesShown: set ? Array.from({ length: plan.spoons }, (_, i) => set!.pancakeShown(i)) : [], parts: snapshotParts(), anchor, holdMs: HOLD_MS, lines: COOK_PROMPT_LINES.length,
        },
      };
    },
  };
}

export type Cook = ReturnType<typeof createCook>;
