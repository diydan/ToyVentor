/**
 * The tuned models (pilots 6 and 8 and any later one) were trained on ONE exact production prompt: the text the make route sends for a wish, here hashed for the placeholder wish "X"
 * exactly as scripts/tuning/lib/dataset.ts records it in a dataset manifest (promptSha256, version p1). A model reads the prompt it was trained on or it is a different model.
 * If this test fails, the production prompt changed (shared/forgeMakePrompt.ts or something it imports). Do not just update the hash: either revert the prompt change, or retrain and
 * re-evaluate a tuned model on the new text, and keep FORGE_FAST_MODE off (the Worker's fast path) until that is done.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MAKE_PROMPT_VERSION, buildMakePrompt } from "../shared/forgeMakePrompt";

const TRAINED_ON_SHA256 = "440c729c8f2c94f5f23e6c8dd344ac1a45f439ca94c94d4ab59f413a86b0a547"; // dataset-p1, p2 and p3 manifests, 2026-11-04
const TRAINED_ON_VERSION = "v5";

describe("the production prompt the tuned models were trained on", () => {
  it("has not changed", () => {
    expect(MAKE_PROMPT_VERSION).toBe(TRAINED_ON_VERSION);
    expect(createHash("sha256").update(buildMakePrompt({ text: "X" })).digest("hex")).toBe(TRAINED_ON_SHA256);
  });
});
