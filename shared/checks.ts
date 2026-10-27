// The four live builder checks from the spec, as pure functions.
// Print/Order UI stays disabled unless every check passes (spec: Virtual
// builder). Geometry-level checks (watertight, real overhangs) belong to
// the parts pipeline, not here — these judge set-file data only.
import type { Part } from "./part";
import type { Toy } from "./toy";

export type CheckId = "on-grid" | "fits-toy" | "support-free" | "fits-bed";

export interface CheckResult {
  id: CheckId;
  label: string;
  pass: boolean;
  detail: string;
}

/** A common home-printer bed. Per-printer profiles override this later. */
export const DEFAULT_BED_MM: [number, number] = [220, 220];

export function runChecks(
  part: Part,
  toy: Toy,
  bedMm: [number, number] = DEFAULT_BED_MM,
): CheckResult[] {
  const [gu, gv] = part.grid.units;
  const onGrid =
    Number.isInteger(gu) && Number.isInteger(gv) && gu > 0 && gv > 0;

  const [fx, fy] = part.footprintMm;
  const sizeMatch = part.sizeClass === toy.sizeClass;
  const footprintFits = fx <= toy.lengthMm && fy <= toy.widthMm;
  const fitsToy = sizeMatch && footprintFits;

  const supportFree = part.printable
    ? part.supportFree === true && Boolean(part.orientation)
    : true; // skins and digital-only parts never print, so never need supports

  const fitsBed = !part.printable || (fx <= bedMm[0] && fy <= bedMm[1]);

  return [
    {
      id: "on-grid",
      label: "On grid",
      pass: onGrid,
      detail: onGrid ? `${gu}×${gv} units` : "grid units must be whole numbers",
    },
    {
      id: "fits-toy",
      label: "Fits toy",
      pass: fitsToy,
      detail: !sizeMatch
        ? `part is ${part.sizeClass}, toy is ${toy.sizeClass}`
        : footprintFits
          ? `${fx}×${fy} mm on a ${toy.lengthMm}×${toy.widthMm} mm toy`
          : `part footprint ${fx}×${fy} mm exceeds the toy`,
    },
    {
      id: "support-free",
      label: "Prints without supports",
      pass: supportFree,
      detail: part.printable
        ? supportFree
          ? `orientation: ${part.orientation}`
          : "no support-free orientation listed"
        : "digital only, nothing to print",
    },
    {
      id: "fits-bed",
      label: "Fits printer bed",
      pass: fitsBed,
      detail: part.printable
        ? `${fx}×${fy} mm vs ${bedMm[0]}×${bedMm[1]} mm bed`
        : "digital only, nothing to print",
    },
  ];
}

export function allPass(results: CheckResult[]): boolean {
  return results.every((r) => r.pass);
}
