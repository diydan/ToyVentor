// The landscape gate (src/features/game/world/rotateGate.ts): upright on a touch device is gated, nothing else is, and a run can opt out.
import { describe, expect, it } from "vitest";
import { ROTATE_GATE_QUERY, rotateGateBypassed, rotateGateShowing } from "../src/features/game/world/rotateGate";

describe("the rotate gate", () => {
  it("asks for upright AND a touch screen: a narrow desktop window (a mouse) never matches", () => {
    expect(ROTATE_GATE_QUERY).toContain("orientation: portrait");
    expect(ROTATE_GATE_QUERY).toContain("pointer: coarse");
    expect(ROTATE_GATE_QUERY).toMatch(/\band\b/);
  });
  it("shows only while upright, and never when the address opts out", () => {
    expect(rotateGateShowing("", true)).toBe(true);
    expect(rotateGateShowing("", false)).toBe(false);
    expect(rotateGateShowing("?rotate=0", true)).toBe(false);
    expect(rotateGateShowing("?title=0&rotate=off", true)).toBe(false);
    expect(rotateGateShowing("?rotate=1", true)).toBe(true);
  });
  it("opts out with 0, false or off and nothing else", () => {
    for (const v of ["0", "false", "off"]) expect(rotateGateBypassed(`?rotate=${v}`), v).toBe(true);
    for (const v of ["", "1", "on", "yes", "no", "OFF "]) expect(rotateGateBypassed(`?rotate=${v}`), v).toBe(false);
    expect(rotateGateBypassed("")).toBe(false);
    expect(rotateGateBypassed("?title=0")).toBe(false);
  });
  it("a malformed address is not an opt-out and does not throw", () => {
    expect(() => rotateGateBypassed("%E0%A4%A")).not.toThrow();
    expect(rotateGateBypassed("%E0%A4%A")).toBe(false);
  });
});
