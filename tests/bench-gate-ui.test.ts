import { describe, expect, it } from "vitest";
// @ts-expect-error untyped JS module
import { COPY, gateCopy, denialMessage } from "../parts/kip/viewer/bench-gate-ui.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
// The words of the grown-up question (docs/specs/workshop-print-gate-spec.md, phase 2). The dialog itself is checked in a real browser (scripts/e2e-bench-gate-ui.mjs).

describe("gate copy", () => {
  it("asks the selfie gate's question in the selfie gate's words", () => {
    const t = gateCopy({ kind: "pack", mode: "math", a: 14, b: 6, error: null });
    expect(t).toMatchObject({ title: "Grown-up check", question: "What is 14 × 6?", inputType: "text", inputMode: "numeric", check: "Check", cancel: "Cancel", error: "" });
    expect(t.intro).toBe("A grown-up needs to say yes before we make a print pack.");
  });

  it("the PIN is typed into a password field, with no sum", () => {
    const t = gateCopy({ kind: "3mf", mode: "pin", a: 14, b: 6, error: null });
    expect(t.question).toBe("Type the grown-up PIN.");
    expect(t.inputType).toBe("password");
    expect(t.question).not.toContain("×");
  });

  it("names what is being made for every exit a bench has, and falls back for one it does not know", () => {
    for (const kind of ["pack", "project-3mf", "3mf", "stl-zip", "stickers-pdf", "stencils-stl", "sheet", "sticker", "photo-plate"]) {
      expect(gateCopy({ kind, mode: "math", a: 1, b: 1 }).intro, kind).not.toContain("a file");
    }
    expect(gateCopy({ kind: "something-new", mode: "math", a: 1, b: 1 }).intro).toBe("A grown-up needs to say yes before we make a file.");
    expect(gateCopy({ mode: "math", a: 1, b: 1 }).intro).toContain("a file");
  });

  it("after a wrong answer it says so calmly and counts the tries left", () => {
    const base = { kind: "pack", mode: "math", a: 14, b: 6 };
    expect(gateCopy({ ...base, error: { attemptsRemaining: 4 } }).error).toBe("That is not it. Try again. 4 tries left.");
    expect(gateCopy({ ...base, error: { attemptsRemaining: 1 } }).error).toBe("That is not it. Try again. 1 try left.");
    expect(gateCopy({ ...base, error: { attemptsRemaining: 0 } }).error).toBe("That is not it. Try again.");
    expect(gateCopy({ ...base, error: {} }).error).toBe("That is not it. Try again.");
  });

  it("never puts a number, a token or the server's own words in front of a child beyond the sum and the tries", () => {
    const t = gateCopy({ kind: "pack", mode: "math", a: 14, b: 6, error: { attemptsRemaining: 3, token: "SECRET", status: "wrong" } });
    expect(JSON.stringify(t)).not.toMatch(/SECRET|status|token/);
  });

  it("the words can be replaced as one object (a translation), and the default object cannot be edited by accident", () => {
    expect(Object.isFrozen(COPY)).toBe(true);
    expect(Object.isFrozen(COPY.whats)).toBe(true);
    const es = { ...COPY, title: "Revisión de un adulto", mathQuestion: (a: number, b: number) => `¿Cuánto es ${a} × ${b}?` };
    expect(gateCopy({ kind: "pack", mode: "math", a: 2, b: 3 }, es)).toMatchObject({ title: "Revisión de un adulto", question: "¿Cuánto es 2 × 3?" });
  });
});

describe("what a bench says when the download was not granted", () => {
  it("is silent for a Cancel, calm about the rest", () => {
    expect(denialMessage({ ok: true })).toBe("");
    expect(denialMessage({ ok: false, reason: "cancelled" })).toBe("");
    expect(denialMessage({ ok: false, reason: "denied" })).toBe("That was not right. Ask a grown-up to help.");
    expect(denialMessage({ ok: false, reason: "cooldown", retryAfterSeconds: 30 })).toBe("Too many tries. Please wait 30 seconds.");
    expect(denialMessage({ ok: false, reason: "cooldown" })).toBe("Too many tries. Please wait 60 seconds.");
    expect(denialMessage({ ok: false, reason: "cooldown", retryAfterSeconds: 0.2 })).toBe("Too many tries. Please wait 1 seconds.");
  });

  it("an unreachable gate uses the selfie's own calm sentence for that status, never the raw status", () => {
    const offline = denialMessage({ ok: false, reason: "unavailable", status: "offline" });
    expect(offline.length).toBeGreaterThan(10);
    expect(offline).not.toMatch(/^offline$|unavailable$/);
    expect(denialMessage({ ok: false, reason: "unavailable" })).toBe(denialMessage({ ok: false, reason: "unavailable", status: "unavailable" }));
    expect(denialMessage(undefined as any)).toBe("");
  });
});
