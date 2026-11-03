// Every line the Carousel scenes can say out loud, found by RUNNING the scene code rather than by reading its strings: each recipe is played through every state it can reach
// (tap each item and each target, walk there, arrive; tap each spot in every order) with the real functions from runtime/level2Scene.ts, and what world.ts would hand to
// speech is collected. The result is the closed list in src/lib/scenePrompts.json (see src/lib/scenePrompts.ts).
//
// What world.ts speaks (src/features/game/world/runtime/world.ts, `sayT(...)` and `say(winText)`), which this mirrors call site for call site:
//   a tap on an item / target / spot ........ the tap's own `say`
//   the toy arrives with an item ............ `say` ("Holding the teddy - where does it go?")
//   a drop that fits, not the last .......... `say`
//   a drop that does not fit ................ `say + " " + hint`  (one sentence: the miss and the nudge)
//   the last drop of a carry ................ the rung's `winText`  (its own `say` is only toasted, never spoken)
//   a visit's intro ......................... `recipe.intro`;  a visit's out-of-order arrival: `oops + " " + hint`;  an expected arrival: the spot's `arrive`
//   the last spot of a visit ................ `arrive`, then the rung's `winText` (which replaces it at once)
//   the start of a carry .................... "<n> things to put away. Tap one."  (built inside world.ts: the one line this file has to copy)
// tests/scene-prompts.test.ts reads world.ts and fails when its call sites are not the ones listed above, so a new spoken line cannot slip past this file.
import { LEARN_RUNGS, learnRungDef } from "../../src/features/game/world/runtime/learnRungs";
import { LEVEL2_RECIPES } from "../../src/features/game/world/runtime/level2Recipes";
import {
  arriveScene,
  arriveSceneVisit,
  startSceneCarry,
  startSceneVisit,
  tapSceneItem,
  tapSceneSpot,
  tapSceneTarget,
  type SceneCarrySession,
  type SceneVisitSession,
} from "../../src/features/game/world/runtime/level2Scene";
import { promptId } from "../../src/lib/scenePromptId";

export interface PromptEntry {
  id: string;
  text: string;
}
export interface ManifestFile {
  version: 1;
  prompts: PromptEntry[];
}

/** The rung's win line, exactly as world.ts picks it. */
const winTextOf = (missionId: string): string => learnRungDef(missionId)?.winText ?? "All done!";

const cloneCarry = (s: SceneCarrySession): SceneCarrySession => ({ ...s, state: { ...s.state, placed: { ...s.state.placed } }, pending: s.pending ? { ...s.pending } : null });
const cloneVisit = (s: SceneVisitSession): SceneVisitSession => ({ ...s, pending: s.pending ? { ...s.pending } : null });

/** Every line a carry rung can speak, by walking every state of the game (what is placed, what is held) with the real tap and arrival functions. */
function carryLines(missionId: string, add: (text: string, from: string) => void): void {
  const root = startSceneCarry(missionId);
  if (!root) return;
  const from = `carry:${missionId}`;
  add(`${root.params.items.length} things to put away. Tap one.`, from); // world.ts builds this one itself (startSceneMarkers)
  add(winTextOf(missionId), from);
  const seen = new Set<string>();
  const todo: SceneCarrySession[] = [root];
  while (todo.length) {
    const s = todo.pop()!;
    const key = JSON.stringify([Object.entries(s.state.placed).sort(), s.state.held, s.state.done]);
    if (seen.has(key)) continue;
    seen.add(key);
    if (s.state.done) continue; // world.ts drops the session when the last thing lands
    const taps = [
      ...s.params.items.map((i) => (t: SceneCarrySession) => tapSceneItem(t, i.id, 0)),
      ...s.params.targets.map((g) => (t: SceneCarrySession) => tapSceneTarget(t, g.id, 0)),
    ];
    for (const tap of taps) {
      const t = cloneCarry(s);
      const r = tap(t);
      add(r.say, from);
      if (r.action === "goto") {
        const a = arriveScene(t);
        if (a?.event === "picked" || a?.event === "placed") add(a.say, from);
        if (a?.event === "wrong") add(`${a.say} ${a.hint}`, from);
        // a "done" arrival speaks the win line instead (added above)
      }
      todo.push(t);
    }
  }
}

/** Every line a visit rung can speak: its intro, every tap, every arrival in every order. */
function visitLines(missionId: string, add: (text: string, from: string) => void): void {
  const root = startSceneVisit(missionId);
  if (!root) return;
  const from = `visit:${missionId}`;
  add(root.recipe.intro, from);
  add(winTextOf(missionId), from);
  const seen = new Set<string>();
  const todo: SceneVisitSession[] = [root];
  while (todo.length) {
    const s = todo.pop()!;
    const key = `${s.at}|${s.done}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const spot of s.recipe.spots) {
      const t = cloneVisit(s);
      const r = tapSceneSpot(t, spot.id, 0);
      add(r.say, from);
      if (r.action === "goto") {
        const a = arriveSceneVisit(t);
        if (a?.event === "wrong") add(`${a.say} ${a.hint}`, from);
        if (a?.event === "advanced" || a?.event === "done") add(a.say, from);
      }
      todo.push(t);
    }
  }
}

/** Every line, with where each came from (a line two scenes share is one line). */
export function enumeratePrompts(): Map<string, string[]> {
  const found = new Map<string, Set<string>>();
  const add = (text: string, from: string) => {
    if (!text) return;
    (found.get(text) ?? found.set(text, new Set()).get(text)!).add(from);
  };
  const ids = new Set<string>([...LEARN_RUNGS.map((r) => r.missionId), ...LEVEL2_RECIPES.map((r) => r.id)]);
  for (const id of [...ids].sort()) {
    carryLines(id, add);
    visitLines(id, add);
  }
  return new Map([...found].map(([text, from]) => [text, [...from].sort()]));
}

/** The manifest the enumeration gives: sorted by text, ids from the text, and a stop if two lines ever share an id. */
export function buildManifest(lines: Iterable<string> = enumeratePrompts().keys()): ManifestFile {
  const prompts = [...new Set(lines)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map((text) => ({ id: promptId(text), text }));
  const byId = new Map<string, string>();
  for (const p of prompts) {
    const other = byId.get(p.id);
    if (other !== undefined) throw new Error(`two scene prompts share the id ${p.id}: "${other}" and "${p.text}"`);
    byId.set(p.id, p.text);
  }
  return { version: 1, prompts };
}

/** One prompt per line, so a change shows in a diff as exactly the lines that changed. */
export function serializeManifest(m: ManifestFile): string {
  const lines = ["{", `  "version": ${m.version},`, '  "prompts": ['];
  m.prompts.forEach((p, i) => lines.push(`    { "id": ${JSON.stringify(p.id)}, "text": ${JSON.stringify(p.text)} }${i < m.prompts.length - 1 ? "," : ""}`));
  lines.push("  ]", "}", "");
  return lines.join("\n");
}
