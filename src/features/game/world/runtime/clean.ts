// The cleaning level (docs/specs/play-design-spec.md, "Activity levels", activity 1; Dan, 2026-11-03: "spilling a drink can be mopped up ... clean levels ... Oh no, oh no ... Clean?").
//
//   A mess lands ("Oh no, oh no!"), Kip asks "Clean?", the child picks the tool that fits (crumbs: vacuum, a puddle: mop, jam: soapy sponge, after the soap is mixed) and rubs the mess away with a finger;
//   the right tool clears it, a wrong tool says why in one kind sentence and the right tool glows, and when every mess is gone Kip cheers: "All clean! Hooray!"
//
// The concept: the tool has to fit the mess. The age bands (cleanModel.ts): ages 2 to 4 get one mess and the right tool already in Kip's hand, and a tap on it cleans it; band 2 two messes and a tool to
// choose; band 3 up all three with the soap window of the Clean mission. Nothing here can go wrong for the child: no timer, no score, no failure. A wrong tool is a kind line and the same mess. A mess
// waits as long as it takes; one activity at a time; a world change puts everything right.
//
// Two doors, one implementation: the Toy Room's cleaning cart (`visitFor`: Kip walks over, then the mess lands) and the Map's rung `daily.clean` (`startRung`: the mess lands where Kip stands, and
// finishing pays the rung's stars and XP through the world's own path, `rungWin`). This file is the state machine; the numbers are cleanModel.ts and scrub.ts, the meshes cleanScene.ts, the card
// activityPrompt.ts, the words cleanLines.ts.
//
// Every picture has a still alternative for `reduced()`: the dirt appears finished and vanishes in one step, nothing flies. Every line Kip says is also shown as text, so a muted game loses nothing.
import { ALL_CLEAN, CLEAN_Q, OH_NO } from "./messLines";
import { CLEAN_PROMPT_LINES, CLEAN_TEXT, CLEAN_WRONG_LINES, SOAP_FIRST, SOAP_HIGH, SOAP_LOW, SOAP_OK } from "./cleanLines";
import {
  CART_STAND, CLEAN_ASK_AT_S, CLEAN_CHEER_S, CLEAN_FIT, CLEAN_MAKE_S, CLEAN_OHNO_AT_S, CLEAN_TOOLS, ROW_AHEAD, ROW_Z, SWISH_GAP_S, WRONG_SPEAK_GAP_S,
  cleanPlan, messOffset, messParams, rowHalfWidth, soapStep, widenSoap, type CleanMess, type CleanPlan,
} from "./cleanModel";
import { createActivityPrompt, type ActivityPrompt, type PromptButton, type PromptSpec } from "./activityPrompt";
import { buildBucket, createDirt, createToolHead, setSuds, type Dirt, type ToolHead } from "./cleanScene";
import { createScrubState, onMess, scrubAll, scrubCells, scrubNeeded, scrubProgress, scrubTouch, type ScrubParams, type ScrubPoint, type ScrubState, type ScrubTool } from "./scrub";
import type { Activity, ActivityHeld, ActivityWorld, PointerLike } from "./activityTypes";
import type { PropInst } from "./propReactions";
import type { Visit } from "./visitRoutine";
import { T } from "./worldScene";
import type * as THREE from "three";

export type CleanPhase = "idle" | "making" | "active" | "cheer";

/** The prop that starts the level in the Toy Room, and the rung that starts it from the Map. */
export const CLEAN_PROP = "cleancart";
export const CLEAN_RUNG = "daily.clean";
/** The cheer lasts CLEAN_CHEER_S; the rung is won this far into it (so the cheer and the win line are both seen). */
export const CLEAN_WIN_AT_S = 1.0;
/** Seconds a rung that could not start (Kip is busy) keeps trying. */
const RUNG_RETRY_S = 6;
/** Fastest a pointer sample may be taken to be (bursty events must not read as an impossible speed), and slowest. */
const MIN_DT = 1 / 120, MAX_DT = 0.25;

interface Mess {
  kind: CleanMess;
  params: ScrubParams;
  cells: ScrubPoint[];
  state: ScrubState;
  dirt: Dirt;
  /** Where its centre is on the floor. */
  cx: number;
  cz: number;
}

export function createClean(w: ActivityWorld): Activity & { snapshotMesses(): unknown[]; nextStart: number } {
  let phase: CleanPhase = "idle";
  let source: "prop" | "rung" | null = null;
  let plan: CleanPlan = cleanPlan(0);
  let messes: Mess[] = [];
  let tool: ScrubTool | null = null;
  let soap = { scoops: 0, ready: false, misses: 0 };
  let hintTool: ScrubTool | null = null;
  /** Band 3 up: the soap row (Add soap, Mix, Pour out) is showing instead of the tools. */
  let soapOpen = false;
  let lineText: string = CLEAN_Q;
  let scene: THREE.Group | null = null;
  let head: ToolHead | null = null;
  let bucket: THREE.Group | null = null;
  let drag: { id: number; mess: number; prev: ScrubPoint | null; t: number } | null = null;
  let clock = 0, cheerClock = -1, lastSwish = -9, lastWrongSpoke = -9, lastWrongLine = "", lastClip = -9;
  let rungWon = false;
  let pendingRung: number | null = null;
  let anchor = { x: 0, z: 0 };
  /** Which mess or pair comes first; goes up by one every game. */
  let nextStart = 0;
  /** Bumped by every reset: a visit made before it, and ended after it, must change nothing. */
  let gen = 0;
  const prompt: ActivityPrompt = createActivityPrompt({ host: () => w.host(), onPress: (id) => press(id), ...(w.timers ? { timers: w.timers } : {}), reduced: () => w.reduced() });

  // ---- the card --------------------------------------------------------------------------------------------------------------

  const soapPending = () => plan.soap && !soap.ready && tool === "sponge" && messes.some((m) => m.kind === "jam" && !m.state.done);
  /** The card is always ONE row of at most four short buttons: a taller one would cover the messes on a phone (the front mess sits just above it; tests/e2e-game-clean-cook.mjs checks it). */
  function cardSpec(): PromptSpec {
    const buttons: PromptButton[] = [];
    if (plan.toolInHand) buttons.push({ id: "clean", label: `\u{1F9FD} ${CLEAN_TEXT.cleanIt}`, aria: CLEAN_TEXT.cleanIt });
    else if (soapOpen && soapPending() && plan.soapWindow) {
      buttons.push({ id: "soap:add", label: `+ Soap${soap.scoops ? ` (${soap.scoops})` : ""}`, aria: `${CLEAN_TEXT.addSoap}, ${soap.scoops} so far` });
      buttons.push({ id: "soap:mix", label: CLEAN_TEXT.mix, aria: CLEAN_TEXT.mix });
      if (soap.scoops > 0) buttons.push({ id: "soap:pour", label: "Pour out", aria: CLEAN_TEXT.pourOut });
      buttons.push({ id: "soap:tools", label: CLEAN_TEXT.tools, aria: CLEAN_TEXT.tools });
    } else {
      for (const t of CLEAN_TOOLS) buttons.push({ id: `tool:${t}`, label: CLEAN_TEXT[t as "vacuum" | "mop" | "sponge"], aria: t === "sponge" ? CLEAN_TEXT.spongeFull : CLEAN_TEXT[t as "vacuum" | "mop"], selected: tool === t, pulse: hintTool === t });
      if (soapPending()) { if (!plan.soapWindow) buttons.push({ id: "soap:mix", label: `\u{1F9FC} Mix soap`, aria: CLEAN_TEXT.mixSoap }); }   // (band 2: one tap is the whole step; from band 3 the Sponge button opens the soap row)
      else buttons.push({ id: "clean", label: `\u{1F9FD} ${CLEAN_TEXT.cleanIt}`, aria: CLEAN_TEXT.cleanIt });
    }
    return { line: lineText, buttons, group: CLEAN_TEXT.group };
  }
  function refresh() { if (phase === "active") prompt.show(cardSpec()); }

  // ---- saying things ---------------------------------------------------------------------------------------------------------

  const speak = (text: string) => { w.say(text); w.toast(text); };

  // ---- the scene -------------------------------------------------------------------------------------------------------------

  function buildScene(at: { x: number; z: number }) {
    scene = new T.Group();
    scene.position.set(0, 0, 0);
    messes = plan.messes.map((kind, i) => {
      const params = messParams(kind, plan.band);
      const cells = scrubCells(params);
      const off = messOffset(i, plan.messes.length);
      const dirt = createDirt(kind, cells, params.brush);
      const cx = at.x + off.x, cz = at.z + off.z;
      dirt.group.position.set(cx, 0, cz);
      scene!.add(dirt.group);
      return { kind, params, cells, state: createScrubState(params), dirt, cx, cz };
    });
    head = createToolHead();
    scene.add(head.group);
    if (plan.soap) {
      bucket = buildBucket();
      bucket.position.set(at.x - rowHalfWidth(plan.messes) - 0.55, 0, at.z + 0.9);
      bucket.visible = false;
      scene.add(bucket);
    }
    w.root().add(scene);
  }
  function disposeScene() {
    for (const m of messes) m.dirt.dispose();
    messes = [];
    head?.dispose();
    head = null;
    bucket = null;
    scene?.parent?.remove(scene);
    scene = null;
  }

  // ---- beginning: the mess lands ---------------------------------------------------------------------------------------------

  function visitAt(at: { x: number; z: number }, standX: number, src: "prop" | "rung"): Visit {
    const g = gen;
    let started = false;
    return {
      standX, face: 1, seconds: CLEAN_MAKE_S,
      begin: () => {
        started = true;
        phase = "making";
        source = src;
        plan = cleanPlan(w.band(), nextStart++);
        tool = plan.toolInHand ? CLEAN_FIT[plan.messes[0]!] : null;
        soap = { scoops: 0, ready: false, misses: 0 };
        soapOpen = false;
        hintTool = null;
        lineText = CLEAN_Q;
        rungWon = false;
        drag = null;
        anchor = { ...at, z: w.kip().z + ROW_Z };
        at = anchor;
        buildScene(anchor);
        for (const m of messes) m.dirt.appear(w.reduced());
        if (tool) w.hold(tool as ActivityHeld);
        w.clip("oops");
        [0.1, 0.2, 0.3].forEach((d, i) => w.tone(210 - i * 30, d, 0.09, "triangle", 0.06, 120));   // the mess lands
      },
      cues: [
        { at: CLEAN_OHNO_AT_S, fn: () => speak(OH_NO) },
        { at: CLEAN_ASK_AT_S, fn: () => { w.say(CLEAN_Q); ask(); } },
      ],
      end: () => {
        if (g !== gen || !started) return;
        ask();                                                                                // a mess that has begun is a mess, whatever cut the visit short
      },
    };
  }
  function ask() {
    if (phase !== "making" && phase !== "active") return;
    phase = "active";
    refresh();
  }

  function visitFor(inst: PropInst): Visit | null {
    if (inst.type !== CLEAN_PROP || phase !== "idle" || w.busy()) return null;
    const standX = inst.base.px + CART_STAND;
    return visitAt({ x: standX + ROW_AHEAD, z: w.kip().z }, standX, "prop");
  }
  function startRung(): boolean {
    if (phase !== "idle" || w.busy()) return false;
    const k = w.kip();
    const ok = w.run(visitAt({ x: k.x + ROW_AHEAD, z: k.z }, k.x, "rung"));
    pendingRung = ok ? null : (pendingRung ?? RUNG_RETRY_S);
    return ok;
  }

  // ---- the finger ------------------------------------------------------------------------------------------------------------

  function messAt(pt: ScrubPoint): number {
    for (let i = 0; i < messes.length; i++) if (onMess(messes[i]!.params, { x: pt.x - messes[i]!.cx, z: pt.z - messes[i]!.cz })) return i;
    return -1;
  }

  function wrong(held: ScrubTool, kind: CleanMess, line: string) {
    hintTool = CLEAN_FIT[kind];                                                         // (the sentence is spoken and toasted; the card keeps its short words so it stays small and out of the mess's way)
    if (clock - lastWrongSpoke >= WRONG_SPEAK_GAP_S || line !== lastWrongLine) { w.say(line); lastWrongSpoke = clock; lastWrongLine = line; }
    w.toast(line);
    w.tone(170, 0, 0.12, "square", 0.04, 110);
    refresh();
    void held;
  }
  const wrongFor = (held: ScrubTool, kind: CleanMess): string => (kind === "jam" && held === "sponge" && !soap.ready ? SOAP_FIRST : CLEAN_WRONG_LINES[`${held}>${kind}`] ?? "");

  /** One finger sample on mess `mi`. */
  function touch(mi: number, pt: ScrubPoint, tsMs: number, fresh: boolean) {
    const m = messes[mi]!;
    if (m.state.done) return;
    if (!tool) { if (clock - lastSwish > 1) { w.toast(CLEAN_TEXT.pickTool); lastSwish = clock; } return; }
    if (tool !== m.params.tool || (m.kind === "jam" && !soap.ready)) { wrong(tool, m.kind, wrongFor(tool, m.kind)); return; }
    const local = { x: pt.x - m.cx, z: pt.z - m.cz };
    const dt = fresh || !drag ? 0 : Math.min(MAX_DT, Math.max(MIN_DT, (tsMs - drag.t) / 1000));
    const r = scrubTouch(m.state, m.params, fresh || !drag ? null : drag.prev, { x: local.x, z: local.z, tool, dt }, m.cells);
    m.state = r.state;
    if (drag) { drag.prev = local; drag.t = tsMs; }
    if (r.gained > 0) {
      m.dirt.set(m.state.clean);
      if (clock - lastSwish >= SWISH_GAP_S) { w.tone(250 + ((m.state.cleared * 7) % 5) * 22, 0, 0.12, "sine", 0.04, 150); lastSwish = clock; }
      if (clock - lastClip > 1.4) { lastClip = clock; w.clip("mop"); }
    }
    if (r.event === "done") {
      m.dirt.set(new Uint8Array(m.params.cells).fill(1));                                    // the last bits go with it: coverage is enough, but the picture ends clean
      [523, 659, 784].forEach((f, k) => w.tone(f, k * 0.07, 0.16, "triangle", 0.05));
      if (messes.every((x) => x.state.done)) finishAll();
      else { lineText = CLEAN_Q; refresh(); }
    }
  }

  function down(e: PointerLike): boolean {
    if (phase !== "active" || e.pointerId === undefined) return false;
    const fl = w.floorAt(e.clientX, e.clientY);
    if (!fl) return false;
    const mi = messAt(fl);
    if (mi < 0) return false;
    drag = { id: e.pointerId, mess: mi, prev: null, t: e.timeStamp };
    head?.show(tool, fl.x, fl.z);
    touch(mi, fl, e.timeStamp, true);
    return true;
  }
  function move(e: PointerLike): boolean {
    if (!drag || drag.id !== e.pointerId) return false;
    if (phase !== "active") { drag = null; return false; }
    const fl = w.floorAt(e.clientX, e.clientY);
    if (!fl) return true;
    head?.show(tool, fl.x, fl.z);
    const mi = messAt(fl);
    if (mi < 0) { drag.prev = null; drag.t = e.timeStamp; return true; }                       // off the mess: nothing, and the next touch on it starts a fresh stroke
    if (mi !== drag.mess) { drag.mess = mi; drag.prev = null; }
    touch(mi, fl, e.timeStamp, drag.prev === null);
    return true;
  }
  function up(e: PointerLike): boolean {
    if (!drag || drag.id !== e.pointerId) return false;
    drag = null;
    head?.hide();
    return true;
  }
  function cancel() { drag = null; head?.hide(); }

  // ---- the buttons -----------------------------------------------------------------------------------------------------------

  function press(id: string) {
    if (phase !== "active") return;
    if (id.startsWith("tool:")) {
      const t = id.slice(5) as ScrubTool;
      if (!CLEAN_TOOLS.includes(t)) return;
      tool = t;
      hintTool = null;
      lineText = CLEAN_TEXT.rubIt;
      soapOpen = t === "sponge" && Boolean(plan.soapWindow) && !soap.ready;                 // the soap row replaces the tools until the soap is mixed (band 3 up)
      w.hold(t as ActivityHeld);
      w.tone(440, 0, 0.08, "triangle", 0.05);
      refresh();
      return;
    }
    if (id === "soap:add") {
      soap.scoops = Math.min(6, soap.scoops + 1);
      w.tone(600 + soap.scoops * 40, 0, 0.1, "sine", 0.05);
      if (bucket) { bucket.visible = true; setSuds(bucket, soap.scoops / 4); }
      refresh();
      return;
    }
    if (id === "soap:tools") { soapOpen = false; refresh(); return; }
    if (id === "soap:pour") {
      soap.scoops = 0;
      if (bucket) setSuds(bucket, 0);
      refresh();
      return;
    }
    if (id === "soap:mix") {
      if (!plan.soapWindow && soap.scoops < 1) soap.scoops = 1;                                // band 2: one tap is the whole step
      if (bucket) { bucket.visible = true; setSuds(bucket, Math.max(0.5, soap.scoops / 4)); }
      const r = soapStep(soap.scoops, widenSoap(plan.soapWindow, soap.misses));
      if (r === "ok") { soap.ready = true; soapOpen = false; w.toast(SOAP_OK); w.tone(660, 0, 0.14, "triangle", 0.06); }
      else { soap.misses++; speak(r === "low" ? SOAP_LOW : SOAP_HIGH); }
      refresh();
      return;
    }
    if (id === "clean") cleanIt();
  }

  /** The switch form: one press cleans the first mess the tool in hand fits; if it fits none, the kind line for the first mess left. */
  function cleanIt() {
    const left = messes.filter((m) => !m.state.done);
    if (!left.length) return;
    if (!tool) { w.toast(CLEAN_TEXT.pickTool); return; }
    const fits = left.find((m) => m.params.tool === tool);
    if (!fits) { wrong(tool, left[0]!.kind, wrongFor(tool, left[0]!.kind)); return; }
    if (fits.kind === "jam" && !soap.ready) { wrong(tool, "jam", SOAP_FIRST); return; }
    const r = scrubAll(fits.state, fits.params);
    fits.state = r.state;
    fits.dirt.set(fits.state.clean);
    w.clip("mop");
    w.tone(300, 0, 0.18, "sine", 0.05, 160);
    [523, 659, 784].forEach((f, k) => w.tone(f, 0.12 + k * 0.07, 0.16, "triangle", 0.05));
    if (messes.every((x) => x.state.done)) finishAll();
    else { lineText = CLEAN_Q; refresh(); }
  }

  // ---- the end ---------------------------------------------------------------------------------------------------------------

  function finishAll() {
    if (phase !== "active") return;
    phase = "cheer";
    cheerClock = 0;
    drag = null;
    head?.hide();
    prompt.hide();
    w.release();
    w.clip("cheer");
    speak(ALL_CLEAN);
    [523, 659, 784, 1047].forEach((f, k) => w.tone(f, k * 0.09, 0.2, "triangle", 0.06));
  }
  function endCheer() {
    prompt.dispose();
    disposeScene();
    phase = "idle";
    source = null;
    cheerClock = -1;
    tool = null;
  }

  // ---- the world's calls -----------------------------------------------------------------------------------------------------

  function update(dt: number) {
    clock += dt;
    const reduced = w.reduced();
    for (const m of messes) m.dirt.update(dt, reduced);
    if (pendingRung !== null) {
      pendingRung -= dt;
      if (pendingRung <= 0) pendingRung = null;
      else if (phase === "idle" && !w.busy() && startRung()) pendingRung = null;
    }
    if (cheerClock >= 0) {
      cheerClock += dt;
      if (!rungWon && source === "rung" && cheerClock >= CLEAN_WIN_AT_S) { rungWon = true; w.rungWin?.(); }
      if (cheerClock >= CLEAN_CHEER_S) endCheer();
    }
  }
  function reset() {
    gen++;
    phase = "idle";
    source = null;
    tool = null;
    drag = null;
    cheerClock = -1;
    pendingRung = null;
    rungWon = false;
    prompt.dispose();
    disposeScene();
  }

  function snapshotMesses() {
    return messes.map((m) => {
      const c = w.project(m.cx, 0, m.cz);
      const px = w.project(m.cx + 1, 0, m.cz);
      return {
        kind: m.kind, tool: m.params.tool, cleared: m.state.cleared, needed: scrubNeeded(m.params), progress: scrubProgress(m.state, m.params), done: m.state.done, wrongs: m.state.wrongs,
        shape: m.params.shape, width: m.params.width, depth: m.params.depth, brush: m.params.brush, tapClears: m.params.tapClears, x: m.cx, z: m.cz,
        screen: c, pxPerUnit: c && px ? Math.hypot(px.x - c.x, px.y - c.y) : null, visibleCells: m.dirt.visibleCount,
      };
    });
  }

  return {
    id: "clean",
    get active() { return phase !== "idle"; },
    get phase() { return phase; },
    get promptVisible() { return prompt.visible; },
    get nextStart() { return nextStart; },
    set nextStart(n: number) { nextStart = Math.max(0, Math.floor(n)); },
    visitFor, startRung, down, move, up, cancel, press, update, reset, snapshotMesses,
    snapshot() {
      return {
        id: "clean" as const, phase, band: plan.band, source, promptIds: prompt.ids,
        detail: { tool, soap: { ...soap }, line: lineText, plan: { messes: plan.messes, toolInHand: plan.toolInHand, soap: plan.soap, soapWindow: plan.soapWindow }, messes: snapshotMesses(), anchor, hintTool, lines: CLEAN_PROMPT_LINES.length },
      };
    },
  };
}

export type Clean = ReturnType<typeof createClean>;
