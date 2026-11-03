import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { systemPromptFor, type PromptVersion } from "../../shared/forgePrompt";

const VERSIONS: PromptVersion[] = ["v0", "v1", "v2", "v3", "v4", "v5"];

describe("shared/forgePrompt.ts", () => {
  it.each(VERSIONS)("prompt %s is word for word what the eval harness sent when the golden file was captured", (v) => {
    // The golden files are the harness's own `--print-prompt` output from before the prompt moved out of scripts/forge-eval.ts.
    // Change a version on purpose by editing the prompt and its golden file in the same commit (or add a new version).
    const golden = readFileSync(join(__dirname, "golden", `prompt-${v}.txt`), "utf8");
    expect(`${systemPromptFor(v)}\n`).toBe(golden);
  });

  it("stays pure: no DOM, network, clock, randomness or imports", () => {
    const src = readFileSync(join(__dirname, "..", "..", "shared", "forgePrompt.ts"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/\b(document|window|fetch|process\.|localStorage|Date\.now|Math\.random|performance\.now)\b/);
    expect(code.match(/^[ \t]*import\s.*$/gm) ?? []).toEqual([]);
  });

  it("tells the model the rules the daemon enforces (a guard against a prompt that forgets them)", () => {
    const v5 = systemPromptFor("v5");
    for (const must of ["0.78", "31.75", "brow", "ribs", "star", "hollow", "Never mention brands"]) {
      expect(v5).toContain(must);
    }
  });
});
