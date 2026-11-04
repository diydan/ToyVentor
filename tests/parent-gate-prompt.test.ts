/**
 * The one "ask the grown-up" prompt (src/features/game/world/ParentGatePrompt.tsx): the gate that exists in a small window, for any screen that needs a fresh proof. Rendered to static markup
 * (no browser here); the look was checked in headless Chrome at 844x390 (scripts/tuning/data/ops/shots, not committed). The logic it calls is tested in tests/grown-up-gate.test.ts and
 * tests/hosted-gate.test.ts; the maths pad in tests/gate-math-pad.test.ts.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ParentGatePrompt } from "../src/features/game/world/ParentGatePrompt";

describe("ParentGatePrompt", () => {
  const html = renderToStaticMarkup(createElement(ParentGatePrompt, { onDone: () => undefined }));
  it("opens as a modal dialog that says what it is for, starting with the hold, and can be cancelled", () => {
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("A grown-up needs to say yes");
    expect(html).toContain("Hold to unlock");
    expect(html).toContain(">Cancel</button>");
  });
  it("shows no question, no PIN pad and no text field before the hold is done (a child tapping gets nowhere)", () => {
    expect(html).not.toContain("tv-pin-pad");
    expect(html).not.toContain("tv-math-answer");
    expect(html).not.toContain("<input");
  });
  it("is mounted once at the app root and the scavenger camera, the SAM scan and the skin call use the gated fetch", () => {
    expect(readFileSync("src/App.tsx", "utf8")).toContain("<ParentGateHost />");
    const camera = readFileSync("src/features/game/world/ScavengerCamera.tsx", "utf8");
    expect(camera).toContain('makeGatedFetch({ purpose: "ar" })');
    expect(camera).toContain("nameObject(arFetch");
    expect(camera).toContain("scanPhoto(arFetch");
    const api = readFileSync("src/lib/api.ts", "utf8");
    expect(api).toContain('makeGatedFetch({ feature: "segment"');
    expect(api).toContain('makeGatedFetch({ feature: "image"');
    expect(readFileSync("src/features/game/world/GrownUpsSheet.tsx", "utf8")).toContain("rememberGrownUpProof(session)");
  });
});
