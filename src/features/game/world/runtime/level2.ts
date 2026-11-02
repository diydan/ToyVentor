// toyventor.level/2 (play-design-spec §The level recipe, Plan step 3): the recipe shape and its validator.
//
// v1 of this module knows exactly one primitive (carry, runtime/carry.ts). Validation enforces the
// play-design rules that code can check: closed format, one concept, a mission card, known primitive,
// valid + solvable params. Cause-and-effect (success reachable through effects) joins when the effect
// catalog lands with the remaining primitives; `success.when` is carried as data until then.
import { solveCarry, validateCarry, type CarryParams } from "./carry";

export interface Level2Card {
  goal: string;
  why: string;
  finish: string;
}

export interface Level2Recipe {
  format: "toyventor.level/2";
  id: string;
  /** Age band id, e.g. "3-4" (see src/lib/age.ts BANDS). */
  band: string;
  card: Level2Card;
  concept: { domain: string; idea: string; also?: string[] };
  interaction: { primitive: "carry"; params: CarryParams };
  success: { when: string };
}

const PRIMITIVES_V1 = ["carry"] as const;

/** Errors as plain strings (empty = valid). Unknown shapes are refused whole, never half-applied. */
export function validateLevel2(recipe: Level2Recipe): string[] {
  const errors: string[] = [];
  if (!recipe || typeof recipe !== "object") return ["recipe is not an object"];
  const r = recipe as Level2Recipe & Record<string, unknown>;
  if (r.format !== "toyventor.level/2") errors.push(`format must be "toyventor.level/2"`);
  if (typeof r.id !== "string" || !r.id) errors.push("id is required");
  if (typeof r.band !== "string" || !r.band) errors.push("band is required");
  for (const k of ["goal", "why", "finish"] as const) {
    if (typeof r.card?.[k] !== "string" || !(r.card[k] as string).trim()) errors.push(`card.${k} is required`);
  }
  if (typeof r.concept?.domain !== "string" || !r.concept.domain) errors.push("concept.domain is required (one idea per level)");
  if (typeof r.concept?.idea !== "string" || !r.concept.idea) errors.push("concept.idea is required (one idea per level)");
  const primitive = (r.interaction as { primitive?: string } | undefined)?.primitive;
  if (!PRIMITIVES_V1.includes(primitive as never)) {
    errors.push(`interaction.primitive "${String(primitive)}" is not in the level/2 v1 catalog (${PRIMITIVES_V1.join(", ")})`);
    return errors;
  }
  const params = r.interaction.params as CarryParams;
  errors.push(...validateCarry(params).map((e) => `carry: ${e}`));
  if (errors.length === 0 && solveCarry(params) === null) {
    errors.push("carry: no assignment places every item (level is unsolvable)");
  }
  if (typeof r.success?.when !== "string" || !r.success.when.trim()) errors.push("success.when is required");
  return errors;
}
