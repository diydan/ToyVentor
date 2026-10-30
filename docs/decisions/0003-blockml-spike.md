# 0003 — BlockML spike results: grid proven, license gate found

Oct 28, 2026. Completes step 2 of
[0002](0002-blockml-machineblocks.md): expressing Brick 2×2 small in
BlockML and comparing against `parts/snap/`. The decision in 0002
stands (hand OpenSCAD stays the committed source for the demo); this
record adds the measurements 0002 asked for, plus one new blocker it
did not know about.

Neither old follow-up is owed for adoption. A side-by-side print is no
longer on the product path, and the written license clarification is no
longer being pursued: [0004-license-email-draft.md](0004-license-email-draft.md)
is retired in favor of PartSpec's no-contact decision. If the author ever
clarifies the terms unprompted, that only updates the documentation; it
does not reopen adoption before Nov 4.

This record exists so the spike evidence survives. It ran entirely in
`/tmp/blockml-spike` on Oct 27–28; nothing in the repo depends on it.

## What was tested

[BlockML](https://blockml.org/) is a solo-author modeling language
(BML files, Apache-2.0) whose compiler derives artifacts from one
model. Its geometry path is [MachineBlocks](https://machineblocks.com/)
by the same author: an OpenSCAD library for LEGO®-compatible bricks.
The spike modeled our Brick 2×2 in BML and ran the full pipeline:
BML → generated SCAD → STL via our OpenSCAD.

Versions: `@blockml/cli` 0.9.18, `@blockml/core` 1.4.6,
`@machineblocks/cli` 0.1.6, `@machineblocks/core` 3.0.0-A5,
Node v22.23.4, OpenSCAD snapshot 2026.10.11.

The working consumer pattern is a CompositeBlock wrapping a
NativeBlock part. Subclassing their `Standard` brick does not render
(see failures). The final spike block, complete:

```xml
<spike:Brick2x2 xmlns="http://blockml.org/bml"
  xmlns:mbcore="com.machineblocks.bml.core"
  xmlns:mbt="com.machineblocks.bml.type"
  xmlns:spike="org.toyforge.spike">

  <baseType>
    mbcore:CompositeBlock
  </baseType>
  <is>
    ToyForge spike brick 2x2
  </is>
  <properties>
    <size type="mbt:SizeXYZ">
      <value>{x:2,y:2,z:3}</value>
    </size>
  </properties>
  <aggregations>
    <_parts override="true">
      <composition>
        <mbcore:NativeBlock size="${ size }" unitMbuToMm="3.2" />
      </composition>
    </_parts>
  </aggregations>
</spike:Brick2x2>
```

`unitMbuToMm` is the system scale knob: default 1.6 gives the 8 mm
LEGO grid; 3.2 doubles every mbu-dimensioned feature at once.

## Measured results (STL vertex bounding boxes)

| | MachineBlocks default | MachineBlocks ×2 | ToyForge Brick 2×2 small |
| --- | --- | --- | --- |
| Footprint | 15.8 × 15.8 mm | 31.8 × 31.8 mm | 32 × 32 mm |
| Height | 11.2 mm | 22.4 mm | 18 mm |
| Stud pitch | 8 mm | **16.00 mm** | 16 mm |
| Stud diameter | ~4.9 mm | **9.80 mm** | 9.50 mm (target) |
| Triangles | 10,068 | 14,598 | 1,982 |
| Manifold | Genus 0, NoError | Genus 0, NoError | Genus 0, NoError |

The ×2 brick lands on our small grid almost exactly, with a proper
0.1 mm/side fit gap and a real hollow underside (tubes, pillars,
printer configs, calibration blocks). Our brick is a solid body with
cone-roof sockets: simpler, and its fit is equally unproven until
something prints. Stud-height splits above are totals only; the
body/stud split was inferred from grid math, not measured directly.

## What worked

- Agent workflow: scaffolded `AGENTS.md`, `scan`/`inspect`/`validate`
  with clear diagnostics. First valid model on the first attempt.
- One scale parameter expresses a size class. Snap large would be
  `unitMbuToMm="6.4"` by the same logic (untested).
- Generated SCAD is a thin, readable wrapper over the library.

## What failed

- Both CLIs crash on a clean Mac (`dlopen … libssl.3.dylib` from a
  native dependency, `@ladybugdb/core`) until Homebrew `openssl@3`
  is installed. Not flagged in the docs we read.
- Subclassing `com.machineblocks.bml.bricks.Standard` compiles to
  `MB_EMPTY_BLOCK: A block with no children has nothing to render.`
- Compiling their own `Standard` from a consumer project fails with
  `BML_LEAF_VALUE_UNSUPPORTED: Parameter cannot be serialized.`
  It ships precompiled instead. Assume version skew between core
  3.0.0-A5 and render-target 0.1.6.
- Compile needs a `bml` segment in the package FQN or explicit
  `--source-package`/`--target-package` flags.
- Sculpted parts (Dragon Wing, Glow Capsule) have no expression in
  the library. Everything is brick-system geometry. Adoption would
  still leave a split pipeline.

## License conflict (the hard gate)

`@machineblocks/core` declares Apache-2.0 in `package.json` and its
`LICENSE` file. But the geometry sources carry CC BY-NC-SA 4.0
headers, including:

- `lib/block.scad` (the core geometry module, required at render)
- `blocks/com/machineblocks/scad/bricks/Standard.scad` (precompiled)
- `blocks/com/machineblocks/bml/bricks/Standard.bml` and other `.bml` files

Generated SCAD `use`s that library to render. NonCommercial +
ShareAlike conflicts with Forge Club, the Market, and the spec's
"designs CC BY" plan. Until the author clarifies in writing which
license governs the library and generated output, no ToyForge part
may be built on it beyond evaluation.

## Revisit when

1. License clarified as Apache-2.0 (or a commercial license exists).
2. `Standard` compiles cleanly from a consumer project.
3. After Nov 4. The plausible shape then: BlockML as the parts
   catalog layer (one model → set files + SCAD + docs, killing the
   SCAD↔JSON duplication tests currently guard), MachineBlocks for
   brick-like parts, hand SCAD for sculpted parts behind the same
   set-file contract.

## Reproduce

```sh
brew install openssl@3   # required by a native CLI dependency
mkdir blockml-spike && cd blockml-spike
npm init -y
npm install @machineblocks/cli @blockml/cli
npx machineblocks init org.toyforge.spike --no-install
npm install
npx blockml agents-md generate
# add Brick2x2.bml (above) under blocks/org/toyforge/spike/
npx machineblocks validate
npx machineblocks compile org.toyforge.spike.Brick2x2 \
  --source-package org.toyforge.spike \
  --target-package org.toyforge.scad.spike
openscad -o Brick2x2-big.stl blocks/org/toyforge/scad/spike/Brick2x2.scad
```
