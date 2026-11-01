import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function resolvePythonVenv(): string | null {
  const local = resolve(ROOT, "parts/partspec/.venv/bin/python3");
  if (existsSync(local)) return local;
  try {
    const commonGit = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const shared = resolve(ROOT, commonGit, "..", "parts/partspec/.venv/bin/python3");
    if (existsSync(shared)) return shared;
  } catch {
    // no shared venv
  }
  return null;
}

const PYTHON_VENV = resolvePythonVenv();

describe("Universal face plates print with the plate edge and the stem on the same bed plane", () => {
  it.skipIf(!PYTHON_VENV)(
    "has no stem hovering above the bed (slicers flag it as a floating cantilever) and still passes the generator gate",
    () => {
      const res = spawnSync(PYTHON_VENV!, [join(ROOT, "tests/fixtures/partspec/faceplate_bed_contact.py")], {
        encoding: "utf8",
        timeout: 150_000,
      });
      expect(res.status, res.stderr).toBe(0);
      const rows = JSON.parse(res.stdout.trim().split("\n").pop()!) as {
        id: string;
        design_status: string;
        blocking: string[];
        watertight: boolean;
        plate_min_z: number;
        stem_min_z: number;
        stem_length_mm: number;
      }[];
      expect(rows.map((r) => r.id)).toEqual(["char_faceplate", "char_faceplate_vinyl", "char_faceplate_flat"]);
      for (const r of rows) {
        expect(r.blocking, r.id).toEqual([]);
        expect(r.design_status, r.id).toBe("verified");
        expect(r.watertight, r.id).toBe(true);
        expect(r.plate_min_z, r.id).toBeLessThan(0.05); // plate edge on the bed
        expect(r.stem_min_z, r.id).toBeLessThan(0.05); // stem flat on the bed, not 0.4 mm above it
        expect(r.stem_length_mm, r.id).toBeGreaterThan(10); // the check measures the real stem
      }
    },
    180_000,
  );
});
