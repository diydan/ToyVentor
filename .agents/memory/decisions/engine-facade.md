---
type: project
---

# Native World Port supersedes iframe facade

Dan opted for a **true native port** over keeping the `<iframe>` scrape-and-click facade.

- Canonical spec: [`docs/specs/native-world-port-spec.md`](/Users/dan/Code/toyforge/docs/specs/native-world-port-spec.md) (**Phase 0**, ahead of Phases 1-5 in [`docs/specs/app-continuation-spec.md`](/Users/dan/Code/toyforge/docs/specs/app-continuation-spec.md)).
- **Phase 0A:** Mount `<canvas>` directly in `GameCanvas.tsx` using the single `three` (`^0.183.2`) dependency via Vite, emit events directly (no `100 ms` timer), preserve `#toy=` URLs, and delete `<iframe>`, `game/build25.py`, `public/world/ToyVentor-World.html`, `public/world/three/**`, and `three-v160`.
- **Phase 0B:** Decompose `game/engine25.js` into typed modules under `src/features/game/world/runtime/`, unify `Character` (latest Kip V2 rig) + `Vehicle` while keeping all `25` `robot.*` keys (`11/30` hidden world collectibles) aliased 1-to-1 onto Kip slots, fix background gear tooth meshing, and retire `#fix` (`"Fix it for me"`).
