// Scanned (or seeded) toy shape. The seed toy in seed/toys/ uses this exact
// shape so the demo's backup path exercises the same code as a live scan.
import type { SizeClass } from "./part";

export type ToyKind = "car" | "figure" | "other";

export interface AttachPoint {
  id: string;
  label: string;
}

export interface Toy {
  id: string;
  name: string;
  kind: ToyKind;
  sizeClass: SizeClass;
  /** Overall size from the scan mask, mm. Attach-part fit is judged
   *  against these, so a bad mask shows up as parts "not fitting". */
  lengthMm: number;
  widthMm: number;
  attachPoints: AttachPoint[];
  /** "seed" = preloaded backup toy. Never pretend it was scanned. */
  source: "scan" | "seed";
}
