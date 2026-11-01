#!/usr/bin/env tsx
/**
 * Launch the persistent warm Forge Fast-Preview + Background Print/Web Optimizer daemon.
 *
 * Usage:
 *   npm run forge:optimizer
 *   npm run forge:optimizer -- --port 8791 --workers 2
 */
import { execFileSync, spawn } from "node:child_process";
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

const py = resolveVenvPython();
const daemonScript = resolve(ROOT, "scripts/forge_optimizer_daemon.py");
const extraArgs = process.argv.slice(2).filter((a) => a !== "--");

const child = spawn(py, [daemonScript, ...extraArgs], {
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

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => child.kill(sig));
}

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
