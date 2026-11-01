# Spec: Parts, Kip & 12.5 mm TU Print Calibration

## Status

**Active geometry canon.** The 12.5/25 mm TU lattice governs the app, sets,
print payloads, and calibration. [Decision
0005](../decisions/0005-partspec-lattice-merge.md) migrated the app onto it.

## Goal

Keep one lattice, one verification gate, and one app bridge for Snap and Motion.
The committed catalog targets are **106 Snap + 79 Motion = 185 verified parts**;
the generator marks verification. `sparkle_skin` rides along as an unprintable
demo skin, not a catalog target. Verification is generator-derived: a part
counts only when no blocking check fails and its small-parts result is not
marginal; printed-fit and breakage checks stay pending until real prints.


App IDs hyphenate PartSpec underscores through the canonical bridge. Exact
PartSpec names still matter in generators and tests. New rows must not reuse
IDs, geometry, or stats unless compatibility surgery is explicitly requested.

## Parallel Lane Ownership & Read-Only UI Contract

The parts lane owns parts, sets, public meshes, bridge scripts, and catalog
libraries. UI consumes them only through the catalog, checks, and Kip demo
paths. Stage only owned files in Git.

### Zero-Touch App Handoff

New or calibrated meshes and expansion sets flow into Print and Pack
automatically through the bridge. No UI code change is needed for data-only
expansion.

### Git & Tooling Hygiene

Track sources, manifests, and cached validation artifacts; ignore regenerable
meshes and scratch outputs. Review generated diffs as evidence.

## Baseline Already Landed on `main` (Do Not Regress)

Canonical TU sets, hidden calibration, bridge behavior, generated snapshots,
and app checks are live. Do not regress them while adding rows. App IDs
hyphenate PartSpec underscores; exact PartSpec names still govern generators
and tests.


## Remaining Deliverables (Priority Order)

### 1. Wave 9 Character/Hair Polish & Kip Viewer Sync (Immediate)

Finish the current character/hair wave and keep the Kip viewer, manifests, and
generated snapshots in sync.

### 2. `12.5 mm` TU Hidden-Calibration First-Print Selector ([Decision 0005](../decisions/0005-partspec-lattice-merge.md) #3)

The first-print flow uses a fixed primer and hidden `1/2/3` dot choice to
select physical fit. It stores one choice, not a history, and resolved prints
calibrate both lines.

### 3. Physical PLA Print & Tolerance Lock-In (`parts/test-print-tu/`)

Prove printing physically with the candidate part, reference mates, intended
parents, and enough of each robot to exercise joints and travel limits.

### 4. Curated Expansion Packs (Optional, Zero UI Code)

New packs may add rows through the catalog, generator, bridge, and app data
without UI changes.

## Validation Gates

Fit is judged pair by pair from built geometry. Exact matrices and calibration
records are data, not documentation; read them from generated package artifacts
rather than copying numbers here. Physical prints use the candidate part,
reference mates, intended parents, and enough of each robot to exercise joints
and travel limits.

