import seedCarJson from "../../../seed/toys/seed-car.json";
import type { Toy } from "../../../shared/toy";
import { fetchScanToy } from "../../lib/api";

// Single source of truth for the backup toy: the same JSON the Worker serves.
export const seedCar = seedCarJson as Toy;

/**
 * Try the live scan route first; fall back to the bundled seed toy so the
 * demo path works with the API down. Either way the returned Toy carries
 * source:"seed" today — live SAM (Day 2) is what flips that to "scan".
 */
export async function scanToy(): Promise<Toy> {
  try {
    return await fetchScanToy();
  } catch {
    return seedCar;
  }
}
