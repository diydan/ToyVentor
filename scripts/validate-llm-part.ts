#!/usr/bin/env tsx
/**
 * Validate and export one or more LLM-generated ToyVentor PartSpec v2 Python files.
 *
 * Usage:
 *   npm run kip:validate-part -- parts/kip/sdk/examples/example_wizard_hat.py
 *   npm run kip:validate-part              # validates all 3 built-in SDK examples
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const VENV_PY = resolve(ROOT, "parts/partspec/.venv/bin/python3");
const PYTHON = existsSync(VENV_PY) ? VENV_PY : "python3";
const OUT_DIR = resolve(ROOT, "public/kip/custom");

const cliArgs = process.argv.slice(2).filter((a) => a !== "--");
const jsonFlag = cliArgs.includes("--json");
const targets = cliArgs.filter((a) => !a.startsWith("-"));

const files =
  targets.length > 0
    ? targets.map((p) => resolve(process.cwd(), p))
    : [
        resolve(ROOT, "parts/kip/sdk/examples/example_wizard_hat.py"),
        resolve(ROOT, "parts/kip/sdk/examples/example_star_wand.py"),
        resolve(ROOT, "parts/kip/sdk/examples/example_hood_crest.py"),
      ];

let allOk = true;
for (const scriptPath of files) {
  if (!existsSync(scriptPath)) {
    console.error(`[ERROR] File not found: ${scriptPath}`);
    allOk = false;
    continue;
  }
  try {
    const pyArgs = [scriptPath, "--out", OUT_DIR];
    if (jsonFlag) pyArgs.push("--json");
    execFileSync(PYTHON, pyArgs, {
      cwd: ROOT,
      stdio: "inherit",
      env: {
        ...process.env,
        PYTHONPATH: `${resolve(ROOT, "parts/kip/sdk")}:${resolve(ROOT, "parts/kip")}:${resolve(ROOT, "parts/partspec")}`,
      },
    });
  } catch {
    allOk = false;
  }
}

if (!allOk) {
  process.exit(1);
}
