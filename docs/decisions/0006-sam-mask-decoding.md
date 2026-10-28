# 0006 — SAM mask decoding spike: masks are available, official parser works

Date: 2026-10-28. Status: spike proven in scratch; not yet integrated.

## What we believed before

That the SAM 3.1 image lane returns only bounding boxes in `output_text`,
with mask payloads unavailable or in an unknown file lane. The worker
(`worker/meta.ts`) therefore parses boxes only; try-on outlines and attach
points come from the box and kind presets.

## What the probe showed (verified 2026-10-28)

Re ran the known-good cup/bottle photo through `sam-3.1` with
`metadata.mask_encoding: one_bit`, prompt `cup`, and inspected the full SSE
stream (`/tmp/sam_raw.txt`, probe `/tmp/sam_mask_probe.py`):

- `output_text` carries BOTH tokens inline:
  `<0f>0<|box;x1=347;y1=734;x2=837;y2=1104;w=1920;h=1280|><|mask;x=0;y=0;data=371,491,…|>`
- Mask grammar: `data=H,W,<marker><base85 payload>`; marker `!` = one_bit,
  `~` = lossless (API default). Payload = 5-char base85 length prefix +
  arithmetic-coded body. Custom codec — do not hand-roll.
- Meta publishes the official reader: `@meta-sam/parser` (npm, v0.1.0,
  zero runtime deps, ~148 KB dist) and `meta-sam-parser` (PyPI); protocol
  in `github.com/meta-models/meta-sam` (`protocol/sam3.md`).
- Decode proven in scratch (`/tmp/samtest/decode.mjs`):
  `parseImageStream` → 1 mask record, `one_bit 491x371`,
  bounds {left:347, top:734, right:838, bottom:1105}; `decodeMaskToRaster`
  → 182,161 bytes, 72.1% coverage; ASCII preview shows the cup body and
  handle clearly.

## License check before bundling

The parser ships under the SAM License (not a standard OSS license;
"SEE LICENSE IN LICENSE"). Read the redistribution/attribution clauses
before adding it to the Worker bundle; the nodetool integration notes it
requires attribution and shipping the license. Alternative that avoids
the dependency question entirely: keep decoding server-side in the
Worker (still redistribution), or implement from `protocol/sam3.md`
(arithmetic codec — days, not hours; rejected for the hackathon).

## Integration plan (when approved)

1. Worker: parse the mask record alongside the box; decode to raster.
2. Derive a normalized silhouette (column/row extents or a downsampled
   outline polygon) and merge into the existing outline type used by
   try-on, replacing the box-crop approximation.
3. Attach points from the mask: topmost occupied row band (mount seat),
   centroid, and widest row — replacing kind presets where a mask exists.
4. Keep the box-only path as fallback (empty SAM lane, parser diagnostics,
   non-mask objects). SAM still gives proportions, not millimetres: the
   human "real longest side" anchor stays.

## Consequences

Scan quality stops being box-bound: handles, tails and necks become real
silhouette features the mount placement can respect — which is also the
input PartSpec's hugging/clip-on shoes are waiting on ("scan export of
real surface patches" is their stated open item; a silhouette is not a
surface patch, but it is the 2D half of one).
