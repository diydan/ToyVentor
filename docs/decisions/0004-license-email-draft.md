# Retired — license clarification email (do not send)

Status, Oct 29, 2026: **Do not contact the MachineBlocks author.** The
PartSpec record controls: we evaluated the library, found the Apache-2.0
versus CC BY-NC-SA ambiguity unresolved, and chose not to build on it
rather than ask for clarification. The message below is retained only as
a historical appendix.

To: Jan Philipp Knöller <pk@pksoftware.de>
Subject: MachineBlocks license question (Apache-2.0 vs CC BY-NC-SA headers?)

Hi Jan Philipp,

I'm building ToyVentor (toyventor.com), an open system for 3D-printable
snap-on toy upgrades, currently for a hackathon ending Nov 4. I spent
an evening spiking BlockML + MachineBlocks (@machineblocks/core
3.0.0-A5, @machineblocks/cli 0.1.6) and I'm impressed: with
unitMbuToMm="3.2" I got a watertight 2×2 brick on our own 16 mm kids'
grid within the hour, and the scan/inspect/validate workflow is the
best agent-facing tooling I've used.

Before I consider building on it beyond evaluation, I hit a licensing
ambiguity I want to get right:

- @machineblocks/core's package.json and LICENSE file say Apache-2.0.
- But individual files carry "Creative Commons
  Attribution-NonCommercial-ShareAlike 4.0" headers, including
  lib/block.scad (which generated SCAD needs at render time), the
  precompiled blocks/com/machineblocks/scad/bricks/Standard.scad, and
  the .bml block files such as bricks/Standard.bml.

Three questions:

1. Which license governs lib/block.scad and the @machineblocks/core
   block library, Apache-2.0 or CC BY-NC-SA 4.0?
2. If I author my own .bml parts and compile them with the
   MachineBlocks target, are the outputs (generated .scad, exported
   STL/3MF, and the resulting part designs) encumbered by NC-SA, or
   are they mine to license as I choose?
3. ToyVentor plans commercial elements later (paid monthly part sets,
   a market for print files) alongside an open-source part format.
   Is commercial use of the library permitted? If not under the
   current terms, do you offer a commercial license?

Happy to attribute either way, and to share the spike write-up if
useful. Thanks for building this in the open.

Best,
Dan O.
ToyVentor — https://toyventor.com
