# Deploy checklist (written 2026-11-03, checked against a clean export of the commit)

**Why this exists.** The app serves `public/` straight from git with no build step for `/kip/` (see the note in `.gitignore`), so a deploy is only as complete as git is. A file that exists on a dev machine but is gitignored works locally and 404s in production. Everything below was found by exporting a commit to a scratch folder, building that export, and loading every bench from it.

## What the check found (2026-11-03, HEAD `faae674`)

1. **19 files the Truck bench needs are gitignored** (`public/kip/partspec/mockup/` is ignored on purpose; the Truck-Mockup commit was meant to un-ignore and add them, and did for 31 of them). From a clean export the Truck bench never becomes ready (18 STLs return 404). The 19 (8.95 MB) are the 18 STLs plus `kip_stack.json`, listed in step 1. With them added, the Kip, Truck (pro and mech), Yard and Truck-Mockup pages all load with zero 404s. The other 39 ignored files in that folder were not requested by any of the six pages the check loads (other pages, such as `JetCar-Lab.html`, were not covered); run the check on any page you add to a deploy.
2. **`npm run build` (and so `npm run deploy`) failed on a clean HEAD**: `tsc --noEmit` covers `tests/`, and 53 strict-mode "possibly undefined" errors in `tests/yard-vehicles.test.ts` (44) and `tests/kip-baked-clips.test.ts` (9) aborted it. Type-only fixes, no behaviour change; with them the same export builds (`tsc` and `vite build`, exit 0).
3. **The service worker serves `/kip/` cache-first** (`public/sw.js`, `IMMUTABLE_PREFIXES`) and `/kip/` URLs do not change when their bytes do, so a deploy that touches `/kip/` must bump `CACHE` (still `toyventor-v3` at the time of writing) or returning visitors keep the old copies. A network-first or stale-while-revalidate strategy for `/kip/` is an open decision (`workshop-spec.md`); until then, bump.

## Steps (run from the repo root; nothing here deploys until step 8)

1. **Add the files git is missing** (force, they are ignored), and commit them with the type fixes:
   ```
   git add -f \
     public/kip/partspec/mockup/kip_stack.json \
  public/kip/partspec/mockup/kit_turntable.stl \
  public/kip/partspec/mockup/mech_bat_door_screw.stl \
  public/kip/partspec/mockup/mech_brain_lid.stl \
  public/kip/partspec/mockup/mech_brain_tray.stl \
  public/kip/partspec/mockup/mech_drive_lid.stl \
  public/kip/partspec/mockup/mech_drive_tray.stl \
  public/kip/partspec/mockup/mech_n20_pinion_z10.stl \
  public/kip/partspec/mockup/mech_servo_lid.stl \
  public/kip/partspec/mockup/mech_servo_mount.stl \
  public/kip/partspec/mockup/mech_servo_pinion_z10.stl \
  public/kip/partspec/mockup/mech_sill_duct.stl \
  public/kip/partspec/mockup/pro_captive_pin_28.stl \
  public/kip/partspec/mockup/pro_pilot_pin.stl \
  public/kip/partspec/mockup/pro_steer_column.stl \
  public/kip/partspec/mockup/pro_steer_wheel.stl \
  public/kip/partspec/mockup/pro_tie_rod_link.stl \
  public/kip/partspec/mockup/pro_tub_hinge.stl \
  public/kip/partspec/mockup/shaft_tu03.stl
   ```
2. **Bump the cache name** in `public/sw.js`: `const CACHE = "toyventor-v3";` to `"toyventor-v4"` (next number each time `/kip/` changes). Commit it.
3. **Commit everything else that should ship**, and nothing that should not: `git status` must show no file you want in production as modified or untracked. (A deploy is built from a clean export of HEAD, so uncommitted work is never in it.)
4. **Make the clean export** and build it:
   ```
   E=$(mktemp -d) && git archive HEAD | tar -x -C "$E" && ln -s "$PWD/node_modules" "$E/node_modules"
   (cd "$E" && npm run build)        # expect exit 0: tsc, vite build
   ```
5. **Load every bench from that export**: `E2E_GPU=metal node scripts/check-clean-export.mjs "$E"` (prints every request that is not a 200; exits nonzero on any). Expect "clean export loads: every bench ready, no missing file".
6. **Check the remote Worker** (needs your Wrangler login; read-only commands):
   - `npx wrangler d1 migrations list DB --remote`: nothing pending (`migrations/` has `0001_ownership.sql` and `0002_parent_time.sql`; the parent and gate tables also create themselves if absent).
   - `npx wrangler secret list`: the Worker reads `MODEL_API_KEY`, `PARENT_GATE_SECRET` (falls back to `MODEL_API_KEY`), `META_MODEL_API_KEY` and `META_MODEL_API_URL`, `FORGE_OPTIMIZER_TOKEN` and `FORGE_OPTIMIZER_URL`, `VOICE_SIGNING_KEY`, `VOICE_NAME` and `MUSE_SPARK_MODEL`; bindings `DB`, `AI`, `ASSETS` come from `wrangler.jsonc`. `VOICE_SIGNING_KEY` was an open item. No `vars` block is set, so `SELFIE_CLOUD` and `FORGE_MAKE_REQUIRES_PROOF` are unset in production: Smart face is off, and Make from words asks for no proof.
7. **Decide the showcase switch**: a normal build keeps the grown-up checks on (the default). `VITE_PARENT_CONTROLS=off npm run build` makes a build with the checks and limits off and Workshop downloads on (`parent-controls-off-spec.md`); use it only for a deployment that never holds a real child's photo.
8. **Deploy from the export, not the working tree**: `(cd "$E" && npx wrangler deploy)` (this repeats the build, then ships). `.dev.vars` is not in a git export, and the build script removes it from `dist/` as well.
9. **Smoke test the live site** in a private window and again in a browser that has visited before (to prove the cache bump took): the game loads; Workshop opens; the Kip, Truck and Yard tabs each show their model; the Truck's tabs `stage=mech` load; `/api` answers (the parent gate, `GET /api/parent/settings`).

## Not covered here

The Worker's behaviour with the real D1 and the real model keys; the print-gate and compliance decisions (`workshop-print-gate-spec.md`, 7b and 7c: deferred until after the hackathon); and the 3 type errors that showed up in the working tree but not at HEAD (someone's uncommitted work).
