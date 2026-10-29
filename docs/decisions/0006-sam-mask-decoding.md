# 0006 — SAM mask decoding: official parser, Worker-only, box fallback kept

Date: 2026-10-28. Status: approved by Dan, integrated, deployed, and
live-verified the same day. Conditions: official parser only in the
Worker, exact version pinned, box-only fallback retained.

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

## License decision

Dan approved the SAM License on 2026-10-28 with these constraints:

- `@meta-sam/parser` is pinned to 0.1.0 and imported only by
  `worker/meta.ts`; browser code never imports it.
- The full agreement is kept at `licenses/SAM-LICENSE.txt`, with the
  package, purpose and acknowledgement recorded in `THIRD_PARTY.md`.
- The local box parser remains a complete fallback. If Meta changes the
  SAM License into terms ToyVentor cannot accept, remove the Worker
  parser import and continue with box outlines.
- Implementing the arithmetic codec from `protocol/sam3.md` was rejected
  for the hackathon: the official reader is the supported path.

## Integrated v1

1. The Worker collects structural SSE events alongside output text, with
   event/text caps. The existing local parser chooses the largest box;
   the official parser then decodes the matching mask in a fail-soft
   step. Any parser, diagnostic, matching or codec failure leaves the
   box result unchanged.
2. `shared/sam.ts` summarizes the raster into storage-safe facts: actual
   occupied outline and pixel size, coverage, centroid, top anchor,
   widest-row anchor, and a coarse filled-cell silhouette capped at
   48 x 36 cells / 8,000 path characters.
3. Scan dimensions use the mask's actual pixel extents when present.
   The first kind-preset attach point gains the mask top anchor as a
   photo-space hint; labels and IDs are unchanged.
4. AR try-on draws the coarse silhouette inside the scan outline and
   anchors the part to the mask top anchor. Without a mask it uses the
   prior box centre/top behaviour.
5. SAM still gives proportions, not millimetres: the human "real longest
   side" anchor stays.
6. Live verification on `toyventor.com`: the cup probe returned
   `maskApplied: true`, coverage 0.7208, and a silhouette; a D1 ownership
   round-trip with the scanned toy was written, listed, deleted, and
   confirmed empty.

## Consequences

Scan quality stops being box-bound: handles, tails and necks become real
silhouette features the mount placement can respect — which is also the
input PartSpec's hugging/clip-on shoes are waiting on ("scan export of
real surface patches" is their stated open item; a silhouette is not a
surface patch, but it is the 2D half of one).
