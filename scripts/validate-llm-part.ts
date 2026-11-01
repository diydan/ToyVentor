#!/usr/bin/env tsx
/**
 * Validate, optimize (Print STL + quantized Web GLB + slicer_recipe), and export
 * one or more LLM-generated ToyVentor PartSpec v2 Python files.
 *
 * Usage:
 *   npm run kip:validate-part -- parts/kip/sdk/examples/example_wizard_hat.py
 *   npm run kip:validate-part              # validates & optimizes all 3 built-in SDK examples
 *   npm run kip:validate-part -- --json    # machine-readable JSON output
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

function resolveVenvPython(): string {
  const local = resolve(ROOT, "parts/partspec/.venv/bin/python3");
  if (existsSync(local)) return local;
  try {
    const commonGit = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const mainRoot = resolve(ROOT, commonGit, "..");
    const shared = resolve(mainRoot, "parts/partspec/.venv/bin/python3");
    if (existsSync(shared)) return shared;
  } catch {
    // ignore
  }
  return "python3";
}

const PYTHON = resolveVenvPython();
const DEFAULT_OUT_DIR = resolve(ROOT, "public/kip/custom");

const cliArgs = process.argv.slice(2).filter((a) => a !== "--");
const jsonFlag = cliArgs.includes("--json");
const noOptimizeFlag = cliArgs.includes("--no-optimize");

let outDir = DEFAULT_OUT_DIR;
const targets: string[] = [];
for (let i = 0; i < cliArgs.length; i++) {
  const arg = cliArgs[i]!;
  if (arg === "--out" && cliArgs[i + 1]) {
    outDir = resolve(process.cwd(), cliArgs[++i]!);
  } else if (!arg.startsWith("-")) {
    targets.push(arg);
  }
}

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
    const pyArgs = [scriptPath, "--out", outDir];
    if (jsonFlag) pyArgs.push("--json");
    if (noOptimizeFlag) pyArgs.push("--no-optimize");
    execFileSync(PYTHON, pyArgs, {
      cwd: ROOT,
      stdio: "inherit",
      env: {
        ...process.env,
        PYTHONPATH: [
          resolve(ROOT, "scripts"),
          resolve(ROOT, "parts/kip/sdk"),
          resolve(ROOT, "parts/kip"),
          resolve(ROOT, "parts/partspec"),
        ].join(":"),
      },
    });
  } catch {
    allOk = false;
  }
}

if (!allOk) {
  process.exit(1);
}
