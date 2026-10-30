# Spec: Stage Simplification, Kip Unification & Native Port Alignment

Companion to [native-world-port-spec.md](native-world-port-spec.md) (**Phase 0**)
and [app-continuation-spec.md](app-continuation-spec.md) (**Phases 1-5**),
covering brain-dump sections 6-8. Code-verified against the live tree; counts
below are observed, not estimated.

## 1. Phase 0 Native Port Resolution

Previously, React wrapped the standalone iframe (`ToyVentor-World.html`) via
`100 ms` DOM scraping + synthetic `.click()` calls, which blocked engine-level
fixes. **Decision:** we are executing the **Native World Port (Phase 0)** in
[native-world-port-spec.md](native-world-port-spec.md) first (`Phase 0A`
in-process WebGL stage -> `Phase 0B` pure TypeScript modules + Kip V2 rig),
which cleanly unblocks the stage items below while keeping full `2.5D` parallax
art post-freeze.

## 2. Execution Lanes

| Item | Target Phase | Rationale |
| --- | --- | --- |
| In-process `<canvas>` stage, remove `<iframe>` & `public/world/**` | **Phase 0A** | Single `three` bundle, `< 1 ms` toy switch, React owns 100% of HUD |
| Cog-mesh math fix (`Z1/r1 = Z2/r2`) | **Phase 0B** | Native `worldScene.ts` gear builder; ~10 lines |
| Kip V2 `Character` + `Vehicle` rig & `25` `robot.*` aliases | **Phase 0B** | Native `playerRig.ts` + `catalog.ts`; preserves all `11` `robot.*` world spots |
| Retire `#fix` (`"Fix it for me"`) end-to-end | **Phase 0B** | Removed from both `ToyCustomizer.tsx` and `customizerState.ts` |
| `Toy Box` pill + mini icon, `⚙️` entry | **Phase 1** | React dock; local icon first, async upgrade off render path |
| 4-tap PIN pad + cooldown + `Forgot PIN?` | **Phase 1** | `GrownUpsSheet.tsx` + `worker/parent.ts` |
| `Demo Mode` v1 toggle (default `Off`) | **Phase 0A + Phase 1** | Stage chrome gone in 0A; compact `Worlds` selector in React until portals land |
| Full 2.5D illustrated parallax planes | **Post-freeze** | Dedicated visual polish pass on top of `worldScene.ts` depth planes |
| XP, greyed roster, weekly packs | **Phases 3-5** | Per [app-continuation-spec.md](app-continuation-spec.md) ordering |

## 3. Demo Mode v1 (Phase 0A + Phase 1) vs v2 (Phase 3+ portals)

v1 ships inside `⚙️` Settings (default `Off`):

- With **Phase 0A** removing the standalone iframe bars (`#home`, `#build`,
  `#title` button stack), React owns 100% of stage chrome with zero duplicates.
- Boots straight onto the current world. Keeps a compact React `Worlds`
  selector so players can travel between rooms before in-world portals exist.
- Flipping `Demo Mode: On` exposes the full 12-world / `Lab 1-6` quick-jump
  bar, `Level Editor`, `Kip 3D Rig` launcher, `Seed Demo Save`, and sandbox
  unlock-all (never mutating earned XP).

v2 (Phase 3+): in-world progression portals replace the `Worlds` selector in
Normal Mode so players advance organically from `Garden` onward.

## 4. Background cogs: Phase 0B fix vs post-freeze 2.5D parallax

Observed: the legacy gear builder makes 8 boxy teeth regardless of radius, and
the two background gears use mismatched radii (`0.9` vs `0.55`) with unmeshed
speeds, so teeth clip instead of meshing.

- **Phase 0B fix (`worldScene.ts`, ~10 lines):** matched module
  (`r1/Z1 = r2/Z2`, e.g. `12` teeth at `r = 0.90` meshing with `8` teeth at
  `r = 0.60`), opposite angular velocity scaled by `-Z1 / Z2` (`-1.5x`), plus a
  `pi / Z2` half-tooth phase offset.
- **Post-freeze 2.5D parallax:** multi-depth illustrated backdrop planes at
  stepped `Z` depths (`z = -4, -9, -16, -24`) get their own visual-polish pass
  after the November 4 freeze.

## 5. Kip unification: UI-merge, wire-keep (Phase 0B)

Observed wire surface for `robot`: `25` `robot.*` part rows out of `70`, `11`
of the `30` hidden world collectibles across the five non-start worlds,
custom-world validation requiring every spot key to exist in `PART`,
world-recipe cleaning that passes part keys through as strings, a
scanned-`other` default to `robot`, per-type stat mappings, and save/contract
acceptance of all three types.

Rule: never delete a `robot.*` key or narrow accepted wire contracts. Collapse
only the top-level UI in `Build` to **Character (latest Kip V2)** and **Vehicle**
(full `25`-key mapping in [native-world-port-spec.md §4.2](native-world-port-spec.md)):

| Robot slot | Kip dock (alias target) |
| --- | --- |
| `head.*` | `head` -> Kip `Bolt Robot` / `Visor` heads |
| `top.*` | `hat` (Crown 2x1 dock) -> `Spark Buds`, `Gear Crown`, radar/bulb toppers |
| `torso.*` | `back` (Back 2x2 dock) -> `Bolt Jetpack`, `Explorer Pack`, `Core` / `Barrel` rigs |
| `arms.*` | `prop` (Hand Ø6.6 mm shaft dock (5.0 mm flats)) -> `Pro Wrench`, `Pro Spinner`, magnet/claw tools |
| `legs.*` | `stance` / `boots` -> Kip spring/hover/tread foot mounts |

- `toyTypeForKind("other")` moves from `robot` to `character`; stored `robot`
  contracts, saves, share URLs, and hidden collectibles resolve onto Kip slots.

## 6. Retiring the legacy fix button (Phase 0B)

Two separate systems, verified:

1. Theatrical engine warning (`checkBad` / `#fix`): sets a flag and toasts
   "Laid flat, so no supports are needed." Pure flavor.
2. Real printability (`on-grid`, `fits-toy`, `support-free`, `fits-bed`
   plus grid snap/clamp): already filters part shelves up front and gates
   STL download on all-checks-pass plus board validity.

Rule: never silently swap a child's chosen part. Remove `checkBad()` / `#fix`
from both `ToyCustomizer.tsx` and `customizerState.ts`, pre-filter parts to
support-free fitting parts up front, and clamp + snap `Stud Grid` drops to the
nearest free `12.5 mm` cell.

## 7. Acceptance gates

- Zero `<iframe>` on the stage and `<= 1` active WebGL context under React
  `StrictMode` double-mount once Phase 0A lands.
- No locked card, lock icon, or XP promise ships before the XP system (Phase 3).
- Every previously selectable toy stays selectable after gating lands.
- A forgotten PIN never bricks parent settings.
