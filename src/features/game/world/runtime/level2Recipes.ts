// First level/2 recipes (play-design Plan step 2 conversion): Pack the car + Tidy one thing as carry.
//
// These recipes are the rungs' logic source. Until the scene drag binding lands, learnRungs.ts renders
// them as MissionPanel steps GENERATED from the carry solver (stepsFromCarry below) — so the panel can
// never disagree with the primitive about what "home" means. When drag/tap scene play arrives, the same
// params drive it and the generated steps become the accessibility proxy panel (play-design §11.4 twin).
import { solveCarry, type CarryParams } from "./carry";
import type { Level2Recipe } from "./level2";
import type { LearnStep } from "./learnRungs";

export const PACK_CAR_RECIPE: Level2Recipe = {
  format: "toyventor.level/2",
  id: "little.pack",
  band: "2-3",
  card: {
    goal: "Pack everything the car needs for a trip.",
    why: "Each thing fits in its own place: big things in the trunk, soft things on the seat.",
    finish: "Put each thing where it fits. The wrong place will not fit.",
  },
  concept: { domain: "life skills", idea: "packing by fit" },
  interaction: {
    primitive: "carry",
    params: {
      items: [
        { id: "suitcase", label: "Suitcase", targetIds: ["trunk"] },
        { id: "teddy", label: "Teddy", targetIds: ["seat"] },
        { id: "ball", label: "Ball", targetIds: ["roof", "trunk"] },
      ],
      targets: [
        { id: "trunk", label: "Trunk", x: 30 },
        { id: "seat", label: "Seat", x: 34 },
        { id: "roof", label: "Roof rack", x: 38 },
      ],
    },
  },
  success: { when: "every item placed" },
};

export const TIDY_ONE_THING_RECIPE: Level2Recipe = {
  format: "toyventor.level/2",
  id: "little.tidy",
  band: "2-3",
  card: {
    goal: "Put each thing back where it lives.",
    why: "Things are easy to find when they go home.",
    finish: "Carry each thing to its home, one at a time.",
  },
  concept: { domain: "life skills", idea: "tidying by home" },
  interaction: {
    primitive: "carry",
    params: {
      items: [
        { id: "book", label: "Book", targetIds: ["bookshelf"] },
        { id: "sock", label: "Sock", targetIds: ["laundry"] },
      ],
      targets: [
        { id: "bookshelf", label: "Bookshelf", x: 14 },
        { id: "laundry", label: "Laundry basket", x: 22 },
        { id: "fridge", label: "Fridge", x: 30 },
      ],
    },
  },
  success: { when: "every item placed" },
};

export const LEVEL2_RECIPES: Level2Recipe[] = [PACK_CAR_RECIPE, TIDY_ONE_THING_RECIPE];

/**
 * Panel steps generated from the carry solution: one "where does X go?" step per placed item, the
 * correct target among three choices (correct target + the next two targets, rotating so the answer
 * position varies). Returns [] when unsolvable — callers keep their static steps rather than guess.
 */
export function stepsFromCarry(params: CarryParams): LearnStep[] {
  const plan = solveCarry(params);
  if (!plan || params.targets.length < 3) return [];
  const labelOf = (list: Array<{ id: string; label?: string }>, id: string) =>
    list.find((e) => e.id === id)?.label ?? id;
  return plan.map((step, i) => {
    const itemLabel = labelOf(params.items, step.itemId);
    const correct = labelOf(params.targets, step.targetId);
    const others = params.targets.filter((t) => t.id !== step.targetId).map((t) => t.label ?? t.id);
    const choices = [correct, others[0]!, others[1] ?? others[0]!] as [string, string, string];
    // Rotate so the answer is not always first: shift left by i % 3.
    const shift = i % 3;
    const rotated = [...choices.slice(shift), ...choices.slice(0, shift)] as [string, string, string];
    return {
      say: `Where does the ${itemLabel.toLowerCase()} go?`,
      choices: rotated,
      answer: rotated.indexOf(correct) as 0 | 1 | 2,
      hint: `The ${itemLabel.toLowerCase()} fits in the ${correct.toLowerCase()}.`,
    };
  });
}
