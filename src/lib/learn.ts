// Ladder state for the Map carousel (carousel-modes-ladders-spec §9.2).
// Ports the mockup's learn.ts rules exactly; the only adaptation is the
// done source: callers inject finished rung indexes (ToyForge derives
// them from missionStars, Decision 5) instead of reading tvDone.
//
// A ladder is BANDED when its rung bands strictly increase (bridges,
// gears, circuits, code): it starts on the rung for the player's age,
// finishing a rung unlocks the next one up, and rungs below the start
// stay open via RungSheet. Otherwise it is a SEQUENCE (little, early,
// daily): the rungs that suit the age, played in order from the first
// one not yet done.
import { bandOf } from "./age";
import { ladderById, LADDERS, rungKey, type Ladder } from "./ladders";
import type { ProgressionState } from "./progression";

export interface RungState {
  index: number;
  title: string;
  age: string;
  done: boolean;
  locked: boolean;
}

export interface LadderState {
  ladder: Ladder;
  banded: boolean;
  rungs: RungState[];
  /** The rungs this player works through (the card's pips). */
  shown: RungState[];
  done: number;
  total: number;
  complete: boolean;
  /** The rung a tap on the card plays. */
  next: number;
  /** How many rungs are open to pick from; >1 opens RungSheet. */
  choices: number;
  /** The rungs one run plays, in order (banded: one; sequence: to the end). */
  plan: number[];
}

export interface LadderOptions {
  /** Indexes of finished rungs on this ladder. */
  done?: ReadonlySet<number>;
  /** Demo/sandbox: nothing hidden, every rung open. */
  openAll?: boolean;
}

const bandsOf = (ladder: Ladder): number[] => ladder.rungs.map((r) => bandOf(r.age));

export const isBanded = (ladder: Ladder): boolean => {
  const bands = bandsOf(ladder);
  return bands.every((b, i) => i === 0 || b > bands[i - 1]!);
};

/** Finished rung indexes for a ladder, from progression stars (Decision 5). */
export function doneRungsFor(
  ladder: Ladder,
  prog: Pick<ProgressionState, "missionStars">,
): Set<number> {
  const done = new Set<number>();
  ladder.rungs.forEach((rung, i) => {
    if ((prog.missionStars[rungKey(rung)] ?? 0) >= 1) done.add(i);
  });
  return done;
}

/** The ladder as this player sees it, or null when it does not suit their age. */
export function ladderState(
  ladder: Ladder,
  age: number | null,
  opts: LadderOptions = {},
): LadderState | null {
  const bands = bandsOf(ladder);
  const n = bands.length;
  const banded = isBanded(ladder);
  const openAll = opts.openAll === true;
  const everything = openAll || age === null;
  if (!everything && age !== null) {
    const youngest = Math.min(...bands);
    const oldest = Math.max(...bands);
    // Banded ladders stretch up to any older age; a sequence stays one
    // band past its top, then steps aside.
    if (age < youngest || (!banded && age > oldest + 1)) return null;
  }

  const done = opts.done ?? new Set<number>();
  const suits = (i: number): boolean => everything || bands[i]! <= (age as number);
  const ageRung =
    age === null ? 0 : Math.max(0, bands.map((b) => b <= age).lastIndexOf(true));

  let unlockedTo = n - 1;
  let next: number;
  let plan: number[];
  let shownIdx: number[];
  if (banded) {
    const maxDone = Math.max(-1, ...[...done].filter((i) => i < n));
    unlockedTo = openAll ? n - 1 : Math.min(n - 1, Math.max(ageRung, maxDone + 1));
    shownIdx = Array.from({ length: n - ageRung }, (_, k) => ageRung + k);
    next = shownIdx.find((i) => i <= unlockedTo && !done.has(i)) ?? ageRung;
    plan = [next];
  } else {
    shownIdx = bands.map((_, i) => i).filter(suits);
    next = shownIdx.find((i) => !done.has(i)) ?? shownIdx[0] ?? 0;
    plan = shownIdx.filter((i) => i >= next);
  }

  const rungs: RungState[] = ladder.rungs.map((r, index) => ({
    index,
    title: r.title,
    age: r.age,
    done: done.has(index),
    locked: banded && index > unlockedTo,
  }));
  const shown = shownIdx.map((i) => rungs[i]!);
  const doneCount = shown.filter((r) => r.done).length;
  return {
    ladder,
    banded,
    rungs,
    shown,
    done: doneCount,
    total: shown.length,
    complete: shown.length > 0 && doneCount >= shown.length,
    next,
    choices: banded ? unlockedTo + 1 : 1,
    plan,
  };
}

/** Every ladder that suits the age, in map order. With no age set, none. */
export function learnStates(
  age: number | null,
  prog?: Pick<ProgressionState, "missionStars" | "sandboxUnlockAll">,
): LadderState[] {
  const openAll = prog?.sandboxUnlockAll === true;
  if (age === null && !openAll) return [];
  return LADDERS.map((l) =>
    ladderState(l, age, {
      done: prog ? doneRungsFor(l, prog) : new Set<number>(),
      openAll,
    }),
  ).filter((s): s is LadderState => s !== null);
}

/** What one run plays; an explicit rung pick is honoured (§9.2). */
export function planFor(
  trackId: string,
  age: number | null,
  prog?: Pick<ProgressionState, "missionStars" | "sandboxUnlockAll">,
  rung?: number,
): number[] | null {
  const ladder = ladderById(trackId);
  if (!ladder) return null;
  const done = prog ? doneRungsFor(ladder, prog) : new Set<number>();
  const openAll = prog?.sandboxUnlockAll === true;
  // A direct start on an age-unsuited ladder still plays, built as if open.
  const state =
    ladderState(ladder, age, { done, openAll }) ??
    (ladderState(ladder, age, { done, openAll: true }) as LadderState);
  if (rung === undefined || !Number.isInteger(rung) || rung < 0 || rung >= ladder.rungs.length) {
    return state.plan;
  }
  if (state.banded) return [rung];
  const onward = state.shown.filter((r) => r.index >= rung).map((r) => r.index);
  return onward.length ? onward : [rung];
}
