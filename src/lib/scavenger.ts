// S1 scavenger quests, pure core (docs/specs/sam-physical-to-digital-spec.md §7.1, Real Life Counts 2.0).
//
// A quest is a STEM concept plus a CLOSED set of SAM target nouns. Verification is counts only: the
// Worker returns noun -> count facts from an ephemeral photo (zero background pixels stored), and this
// module turns counts into a verdict. No XP, storage, or copy lives here — chore-list integration
// (new REAL_LIFE_CHORES entries), the +25/day cap question (spec Q10), launch concept list (Q5), and
// every kid-facing privacy sentence (Q7) land with the S1 UI step, after those answers exist.

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
    nouns: ["door handle", "seesaw", "bottle opener", "light switch", "tap", "handle"],
  },
  {
    id: "scavenge-gear",
    concept: "gear",
    title: "Find a Gear",
    nouns: ["gear", "cog", "clock", "bicycle chain"],
  },
  {
    id: "scavenge-wheel",
    concept: "wheel",
    title: "Find a Wheel",
    nouns: ["wheel", "bicycle wheel", "toy car", "pram wheel", "office chair wheel"],
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
