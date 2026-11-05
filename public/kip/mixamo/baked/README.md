# Kip dance, reaction and movement data (local only, not in git)

These JSON files are derived from Mixamo clips and are **not committed**:
Adobe's terms bar redistributing the raw files and using them as ML
training data, and a public repo goes beyond that.

Source them yourself from one place:

- [Mixamo](https://www.mixamo.com/) (own Adobe account, "without skin")

Then bake locally:

1. Drop the FBX files listed in `scripts/mixamo-clips.json`
   (plus `scripts/mixamo-loco-clips.json` for idle/walk/run) into
   `.local/mixamo/` (git-ignored).
2. Run `node scripts/mixamo-bake.mjs` — writes this folder.
3. Optional: `node scripts/mixamo-bake.mjs --dry` to preview.

Without these files the app still runs on its procedural and
three.js-sample (`Xbot.glb`/`Michelle.glb`) clips; Mixamo moves load
when present and are skipped when absent.
