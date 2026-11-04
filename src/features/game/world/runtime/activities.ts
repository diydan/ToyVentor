// The activity levels as the world sees them (docs/specs/play-design-spec.md, "Activity levels"): one object that holds every activity (cleaning, cooking), so world.ts builds, updates, resets and routes
// the pointer to ONE thing instead of one per activity, and adding the next activity is a row here and not another hook in the world. Pure glue: it decides nothing an activity decides.
//
//   - Toy Room door: `visitFor(kind, inst)`, the visit a tap on a prop starts (toyRoomActs.ts asks for it by act kind).
//   - Map door: `has(rungId)` says the rung is an activity; `startRung(rungId)` begins it where the toy stands; the activity calls the world's `rungWin` when it is done, and the world pays the stars and
//     XP through its own learn-rung path. `panelText(rungId)` is what the mission panel says instead of its pick-one steps.
//   - One activity at a time: a second never starts while one is under way (and the Toy Room mess knows too: world.ts hands it `active`).
import { createClean, CLEAN_RUNG } from "./clean";
import { createCook, COOK_RUNG } from "./cook";
import type { Activity, ActivityId, ActivitySnapshot, ActivityWorld, PointerLike } from "./activityTypes";
import type { PropInst } from "./propReactions";
import type { Visit } from "./visitRoutine";

/** The act kinds the Toy Room asks about (ACT_FOR_PROP in toyRoomActs.ts), and which activity each belongs to. */
export type ActivityActKind = "scrub" | "cook";
const ACTIVITY_FOR_ACT: Readonly<Record<ActivityActKind, ActivityId>> = { scrub: "clean", cook: "cook" };

/** The rungs that are activities, and the one sentence the mission panel says for each. */
export const ACTIVITY_RUNGS: Readonly<Record<string, { id: ActivityId; panel: string }>> = {
  [CLEAN_RUNG]: { id: "clean", panel: "Oh no, a mess! Pick the tool that fits it, then rub the mess clean." },
  [COOK_RUNG]: { id: "cook", panel: "Let's make pancakes! Crack the egg, count the batter, flip it and serve one to each plate." },
};

export function createActivities(w: ActivityWorld) {
  const list: Activity[] = [createClean(w), createCook(w)];
  const byId = (id: ActivityId): Activity | undefined => list.find((a) => a.id === id);
  const current = (): Activity | undefined => list.find((a) => a.active);

  return {
    get clean() { return list.find((a) => a.id === "clean")!; },
    get cook() { return list.find((a) => a.id === "cook")!; },
    /** An activity is under way (the Toy Room mess must not start; the pointer is ours). */
    get active(): boolean { return current() !== undefined; },
    get promptVisible(): boolean { return list.some((a) => a.promptVisible); },
    /** The visit a tap on a prop starts, or null when that prop is not an activity's or one is under way. */
    visitFor(kind: ActivityActKind, inst: PropInst): Visit | null {
      const a = byId(ACTIVITY_FOR_ACT[kind]);
      return a && !current() ? a.visitFor(inst) : null;
    },
    has(rungId: string): boolean { return Object.prototype.hasOwnProperty.call(ACTIVITY_RUNGS, rungId) && byId(ACTIVITY_RUNGS[rungId]!.id) !== undefined; },
    panelText(rungId: string): string { return ACTIVITY_RUNGS[rungId]?.panel ?? ""; },
    startRung(rungId: string): boolean {
      const r = ACTIVITY_RUNGS[rungId];
      const a = r ? byId(r.id) : undefined;
      return a && !current() ? a.startRung() : false;
    },
    down(e: PointerLike): boolean { const a = current(); return a ? a.down(e) : false; },
    move(e: PointerLike): boolean { const a = current(); return a ? a.move(e) : false; },
    up(e: PointerLike): boolean { const a = current(); return a ? a.up(e) : false; },
    cancel(): void { for (const a of list) a.cancel(); },
    update(dt: number): void { for (const a of list) a.update(dt); },
    reset(): void { for (const a of list) a.reset(); },
    press(id: ActivityId, button: string): void { byId(id)?.press(button); },
    snapshot(): ActivitySnapshot[] { return list.map((a) => a.snapshot()); },
  };
}

export type Activities = ReturnType<typeof createActivities>;
