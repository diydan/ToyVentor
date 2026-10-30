# ToyVentor vision

For the tighter hackathon-facing narrative, see
[submission-vision.md](submission-vision.md). This document remains the
internal long-term direction.

## Grow into robotics through play

ToyVentor helps the next generation grow into robotics through play. A child scans a favourite toy, designs an upgrade, receives or prints the physical parts, snaps them on, then continues playing with the upgraded character in AR and a web mini-game.

In short: **sandbox creativity + modular construction + gentle discovery play + hands-on engineering**.

The learning path is progressive. Children begin with characters, stories and simple construction, then develop intuition for balance, structures, joints, gears, leverage and motion. Those are the foundations of mechanical thinking and, later, robotics.

## Two lines, one system

**Snap** is the entry line for the initial playtesting audience: children aged 4 to 9 with grown-ups nearby. It uses large, rounded, easy-to-handle stud-and-socket modules to make soft-looking modular characters. Robots belong here too, initially as fixed-pose characters. Printed parts are not yet safety-certified or formally age-graded.

**Pro** is for older builders. It introduces beams, pins, shafts, gears and articulated figures based on an openly licensed ball-jointed humanoid. Snap is the simplified expression of the same body layout, so children can progress without learning a completely new system.

Humans, animals, robots, tails, wings and accessories form one interchangeable module library. Every part carries machine-readable connection metadata — connector type, size, orientation, fit, printability and safety constraints — so software and AI can assemble valid designs from known parts instead of inventing incompatible geometry.

Parts should move between Snap and Pro wherever physical scale allows, with adapters only where a direct connection is impractical. Humanoid proportions and joint layouts should map to standard animation rigs, allowing one library of reusable motion clips to drive many characters.

## The play experience

The game is 2.5D by default: readable, touch-friendly and focused on experimentation rather than failure. An AI-assisted Create mode helps children turn an idea, photo or simple request into a build made from real, printable modules.

Draw-to-build is the longer-term ambition: sketch something, have it interpreted through the part library, then bring the result into both the physical and digital toy.

## Access and business

ToyVentor is delivery-first because most families do not own a printer. The goal is delivered custom parts starting at $1, with a target direct print cost of $0.50–$5 per design. Home printing remains available for families and makers who have a printer. These are product targets, not yet proven manufacturing economics.

A monthly subscription will deliver seasonal physical packs connected to age-appropriate engineering and science activities. The launch market is the US.

The intended release model is open at the system layer: permissive licensing for code and attribution-based licensing for part designs. A marketplace for print-ready designs can follow once the core catalogue, safety checks and manufacturing workflow are proven.

## Principles

- Children buy known parts and known packs — never paid chance-based packs.
- Study the principles behind great play, but express them through original art, geometry, mechanics and stories.
- Use only original or licence-clean material.
- Make the physical result real: if the software says a part fits, its geometry, connection rules and print checks should support that promise.

## Near-term proof

For the hackathon ending Nov 4, 2026, the core proof is one complete loop: scan a toy, upgrade it with printable parts, and play with the result in AR and the web mini-game.

The current gap against the one-system vision is in the Pro humanoid work: those parts still need the standard connection metadata, and the new heads do not yet swap onto Snap. Until both are demonstrated through the shared connector model, they should not be described as fully cross-line modules.
