# Kip prop-clip arm retargeter

Why: a Kip hand prop is rigidly attached to the hand (the shaft runs through the fist, across the finger axis), so **where the prop points fixes how
the hand is turned**. The first prop clips were posed by prop orientation alone and bent the wrist 57 to 135 degrees (hands "upside down"). This
tool keeps every clip's *motion* (where the prop goes, per frame) and re-solves the right arm so the hand is natural: wrist bend 17 degrees or less,
thumb not pointing down, arm inside soft joint limits and out of the torso.

What it writes: the `PROP_ARMS` table in `parts/kip/viewer/kip-clips.js` (36 samples per loop of arm, elbow and hand angles per prop clip, plus a
`flip` flag). The clip formulas still define the motion; `applyArmTrack` plays the table over their right arm. The wardrobe reads `flip: true` on
the prop row to mount the prop end for end (a half turn about the prop's own x axis through the fist) so a head-up prop (flag, magnifier, spatula,
frying pan, paint roller) gets a thumb-up hand. `tests/kip-clips.test.ts` keeps the table, the wardrobe flags, the wrist limit and the planted feet honest.

## Pieces

- `fk.mjs` forward kinematics of Hips -> right arm -> hand -> prop mesh (rig numbers measured in the page; `measureC.json` holds the constant
  hand-to-prop transform `REL`). Checked against the page on random poses: 0.000 mm and 0.0000 direction error.
- `measureC.mjs` measures `REL` and sample poses in the real page (needs a scratch copy of the viewer with a `probeClip` export, served with `E2E_VIEWER`).
- `oldposes.mjs` records, from the ORIGINAL clips (`git show 1804e8f:parts/kip/viewer/kip-clips.js` in a scratch viewer copy), the hips and prop-mesh
  world matrices at 36 phases. The result is `oldposes.json`. Re-record it only if the motion itself changes.
- `retarget.mjs` the solver. Per clip and per mounting (plain, flipped): 6000-sample global search for frame 0, Nelder-Mead warm-started from the previous
  frame (so the arm moves smoothly), then keeps the mounting with the lower cost. Targets are the old prop pose relative to the body (floor tools keep
  their world height; broom, mop and scrub brush are pulled down to touch the floor; the upright vacuum is fitted by its foot points; the screwdriver
  has a designed target because "pointing along the forearm" is impossible with a natural wrist).
- `apply_table.py` writes the table into `kip-clips.js`: `python3 scripts/kip-retarget/apply_table.py out.json [more.json]`.

## Run

    node scripts/kip-retarget/retarget.mjs scripts/kip-retarget/oldposes.json /tmp/out.json 2.85 [prop_mop ...]
    python3 scripts/kip-retarget/apply_table.py /tmp/out.json     # (all clips in one file, or merge several; later files win)

`2.85` is the grounder lift (Hips world y minus the clip's hips y, measured with planted feet). The solver uses `Math.random` for its global search, so
two runs differ by a little: review a contact sheet (`window.kipClips.scrub(id, t)` then a screenshot) after regenerating, and measure
(`window.kipRig()`: prop mesh `matrixWorld`, lowest point, thumb direction) rather than judging numbers alone.

## Traps

- The largest visible mesh under `rightHandCgripParent` is the HAND, not the prop: pick the mesh whose ancestor is named `slot_prop_*`.
- Hand rx and rz bend the wrist; ry is forearm twist and is free. A big hand rx or rz is what made hands look inverted.
- Floor contact: the old clips hovered 4 to 17 mm above the floor; planted feet put the floor at ankle height 12.9 and Hips lift 2.85.
- Shield and the Pro spinner mount differently (not through the workshop slot): they are not retargeted.
