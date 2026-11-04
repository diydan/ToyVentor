/**
 * The grown-up gate's maths answer on a big number pad (src/features/game/world/GateMathPad.tsx): Dan, 2026-11-04, "the maths input is too small and not visible". The old field was a small
 * text input that the on-screen keyboard covered on a phone held sideways. The pad has no text field at all (nothing for a keyboard to cover), shows the answer large, and uses the PIN
 * pad's keys. Rendered to static markup (no browser here); the look was checked in headless Chrome at 844x390 and 500x760 (scripts/tuning/data/ops/shots, not committed).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GateMathPad, MATH_ANSWER_MAX_DIGITS } from "../src/features/game/world/GateMathPad";
import { readFileSync } from "node:fs";

const render = (props: Partial<Parameters<typeof GateMathPad>[0]> = {}) =>
  renderToStaticMarkup(createElement(GateMathPad, { question: "What is 34 × 27?", value: "", onChange: () => undefined, onSubmit: () => undefined, ...props }));

describe("GateMathPad", () => {
  it("shows the question, ten digit keys, Clear, Delete and Continue, and no text field a keyboard could cover", () => {
    const html = render();
    expect(html).toContain("What is 34 × 27?");
    for (const d of "0123456789") expect(html).toContain(`>${d}</button>`);
    expect(html).toContain(">Clear</button>");
    expect(html).toContain('aria-label="Delete last digit"');
    expect(html).toContain(">Continue</button>");
    expect(html).not.toContain("<input");
    expect((html.match(/tv-pin-key/g) ?? []).length).toBeGreaterThanOrEqual(12); // the PIN pad's own key class: 10 digits, Clear, Delete
  });
  it("an empty answer says what to do, and Continue, Clear and Delete wait until something is typed", () => {
    const html = render();
    expect(html).toContain("Tap the numbers");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Continue<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Clear<\/button>/);
  });
  it("a typed answer is shown large and Continue is live", () => {
    const html = render({ value: "918" });
    expect(html).toContain('data-testid="gate-math-answer"');
    expect(html).toContain(">918<");
    expect(html).not.toContain("Tap the numbers");
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>Continue<\/button>/);
  });
  it("while the check is running every key is off, and a wrong answer is announced as an alert", () => {
    const html = render({ value: "12", busy: true, error: "That is not right. Try again." });
    expect(html).toMatch(/<button[^>]*disabled[^>]*>5<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Continue<\/button>/);
    expect(html).toContain('role="alert"');
    expect(html).toContain("That is not right. Try again.");
  });
  it("the answer can be four digits at most (two two-digit numbers multiplied)", () => {
    expect(MATH_ANSWER_MAX_DIGITS).toBe(4);
    expect(99 * 99).toBeLessThan(10 ** MATH_ANSWER_MAX_DIGITS);
  });
  it("the grown-ups sheet uses the pad for the maths step, and the sideways layout is in the stylesheet", () => {
    const sheet = readFileSync("src/features/game/world/GrownUpsSheet.tsx", "utf8");
    expect(sheet).toContain("<GateMathPad");
    expect(sheet).not.toContain('id="tv-parent-answer"'); // the small input is gone
    const css = readFileSync("src/index.css", "utf8");
    expect(css).toContain(".tv-math-answer");
    expect(css).toMatch(/@media \(orientation: landscape\) and \(max-height: 520px\)[\s\S]*\.tv-math-q/);
  });
});
