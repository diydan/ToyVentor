// S1 scavenger quests, pure core (docs/specs/sam-physical-to-digital-spec.md §7.1, Real Life Counts 2.0).
//
// A quest is a STEM concept plus a CLOSED set of SAM target nouns. Verification is counts only: the
// Worker returns noun -> count facts from an ephemeral photo (zero background pixels stored), and this
// module turns counts into a verdict. No XP, storage, or copy lives here. Chore-list integration
// (REAL_LIFE_CHORES entries) and the shared +25/day ceiling (Q10) landed in dailyQuests.ts; the
// photo capture UI that feeds counts in, and every kid-facing privacy sentence (Q7), land with the
// S1 UI step.

export type ScavengerConcept = "lever" | "gear" | "wheel";

export interface ScavengerQuest {
  id: string;
  concept: ScavengerConcept;
  title: string;
  /** Closed SAM noun set for this quest. Anything outside it can never verify the quest. */
  nouns: readonly string[];
}

/** Launch shortlist (spec Q5 proposes lever/gear/wheel; extend only by adding nouns here). */
export const SCAVENGER_QUESTS: readonly ScavengerQuest[] = [
  {
    id: "scavenge-lever",
    concept: "lever",
    title: "Find a Lever",
    nouns: ["door handle", "seesaw", "bottle opener", "light switch", "switch", "tap", "faucet", "handle", "lever", "scissors", "nutcracker"],
  },
  {
    id: "scavenge-gear",
    concept: "gear",
    title: "Find a Gear",
    nouns: ["gear", "cog", "clock", "bicycle chain", "bike chain", "watch", "gearwheel"],
  },
  {
    id: "scavenge-wheel",
    concept: "wheel",
    title: "Find a Wheel",
    nouns: ["wheel", "bicycle wheel", "bike wheel", "toy car", "car wheel", "tire", "tyre", "pram wheel", "stroller", "office chair wheel", "skateboard", "scooter"],
  },
];

export interface ScavengerVerdict {
  found: boolean;
  /** The first quest noun (quest order) with a positive count, when found. */
  matchedNoun: string | null;
}

/**
 * Found = at least one of the quest's own nouns was counted at least once.
 * Counts for other nouns, zero/negative counts, and missing entries never verify.
 */
export function scavengerVerdict(
  quest: ScavengerQuest,
  countsByNoun: Readonly<Record<string, number>>,
): ScavengerVerdict {
  for (const noun of quest.nouns) {
    if ((countsByNoun[noun] ?? 0) > 0) return { found: true, matchedNoun: noun };
  }
  return { found: false, matchedNoun: null };
}

/**
 * The same verdict from the names the helper gave a photo (`/api/scan {nameIt}`: up to three plain lowercase names, best first, already screened by
 * the Worker). A name counts when it IS one of the quest's words, or contains one as whole words ("old bicycle wheel" has "wheel"). The quest's own
 * closed list stays the only thing that can verify it: a name outside it, however close, never does. Never throws.
 */
export function scavengerVerdictFromNames(
  quest: ScavengerQuest,
  names: readonly string[],
): ScavengerVerdict & { name: string | null } {
  const clean = (s: string) => String(s ?? "").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  const has = (haystack: string, needle: string) => ` ${haystack} `.includes(` ${needle} `);
  for (const raw of names) {
    const name = clean(raw);
    if (!name) continue;
    for (const noun of quest.nouns) {
      if (name === noun || has(name, noun)) return { found: true, matchedNoun: noun, name };
    }
  }
  return { found: false, matchedNoun: null, name: null };
}

/**
 * A real 3D part to show after a find, so the child can put it in the room with the phone's own AR viewer (model-viewer, through PartPreview).
 * Only concepts that have a model: there is no lever part yet.
 */
export const SCAVENGER_REWARD_GLB: Readonly<Partial<Record<ScavengerConcept, { glb: string; name: string }>>> = {
  gear: { glb: "gear-spur-z10.glb", name: "gear" },
  wheel: { glb: "veh-wheel-sport.glb", name: "wheel" },
};

/** The camera sentence for a quest: what to look for, in a child's words. */
export function scavengerHint(quest: ScavengerQuest): string {
  switch (quest.concept) {
    case "lever":
      return "A lever helps you lift or push. Try a door handle, a tap or a light switch.";
    case "gear":
      return "A gear has teeth that turn together. Try a clock or a bike.";
    default:
      return "A wheel goes round and round. Try a toy car, a bike or a chair.";
  }
}

/** What the camera says when the photo was of something else. Warm, never "wrong". */
export function scavengerMissText(quest: ScavengerQuest, seen: string | null): string {
  const what = seen ? `I can see a ${seen}. ` : "";
  return `${what}That is not a ${quest.concept} yet. Look around and try something else!`;
}

/** Is this chore id one of the scavenger quests (it is found with the camera, not ticked by a tap)? */
export const isScavengerChore = (id: string): boolean => SCAVENGER_QUESTS.some((q) => q.id === id);
