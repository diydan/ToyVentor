/**
 * The game is a landscape game (Dan, 2026-11-04: "force landscape mode and have any ui needed on a left slide out menu"; chosen: a hard rotate gate). On a touch device held upright the game shows a full-screen
 * "turn your phone sideways" screen and nothing underneath can be touched. Desktop windows (a mouse, a fine pointer) are never gated, however narrow, and automated runs and screenshots opt out with
 * `?rotate=0` (also `false` or `off`) the way they skip the title with `?title=0`.
 *
 * Pure: no React, no DOM, no storage. The media query is the single place that says what "upright on a touch device" is.
 */

/** Upright (portrait) on a touch screen. A mouse never matches `pointer: coarse`, so a narrow desktop window is not gated. */
export const ROTATE_GATE_QUERY = "(orientation: portrait) and (pointer: coarse)";

/** Whether the address asks to skip the gate: `?rotate=0`, `false` or `off`. */
export function rotateGateBypassed(search: string): boolean {
  try {
    const v = new URLSearchParams(search).get("rotate");
    return v === "0" || v === "false" || v === "off";
  } catch {
    return false;
  }
}

/** Whether the gate is showing: only while the device is upright on a touch screen and the address has not opted out. */
export function rotateGateShowing(search: string, matchesUpright: boolean): boolean {
  return matchesUpright && !rotateGateBypassed(search);
}
