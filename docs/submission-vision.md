# ToyVentor — submission vision

**Build it. Play it. Make it real.**

ToyVentor is where kids build real toys, bring them to life in playful worlds, and grow from their first snap to their first robot. Scan a toy, build on it, play its world, then make the upgrade real.

## Why it exists

ToyVentor started with a wish to pass on a love of building and robots to a young kid, without a worksheet in sight. Every kid already owns toys they love, so ToyVentor starts there. The toy on the shelf becomes the hero of the game, and the upgrades it earns in play can become physical parts.

It blends five things in one loop:

1. **Real upgrades for toys kids already love.** Wheels, jetpacks, gears and character parts snap onto an existing toy and change how it plays.
2. **Open-ended creation.** Kids set their own goals, describe a world, test what appears, and tweak it.
3. **Gentle worlds to explore.** Small, hand-made places to wander and pretend in, with no lives, timers or losing.
4. **Real STEM by doing.** Bridges, gears, levers, balance, floating, circuits, logic, code and patterns are encountered as problems to solve, with hints that explain what happened.
5. **A path to robotics.** Snap parts first; then Pro beams, gears and motion; then logic, circuits and code; later, motors and sensors.

Initial playtesting targets kids aged **4 to 9** on phones and tablets, with grown-ups nearby. It is designed for pre-readers and one-thumb play: short lines, big targets, picture prompts and five-to-ten-minute sessions. Printed parts remain prototypes pending fit, durability and age-safety review.

## Five pillars

- **Your toy is the hero.** Play starts from the kid's scanned toy or own build, not a stock hero.
- **Parts are verbs.** Each part carries one stat, and each stat changes a move or behaviour. Building changes play.
- **Real on purpose.** Printable upgrades come from parametric library geometry, not free-form AI meshes. Checks test the grid, toy size, support-free orientation and printer bed before a file is offered.
- **No fail, all wonder.** No lives, timers or losing. Experiments produce feedback worth seeing.
- **Built to grow.** Snap is the simplified expression of the Pro layout, so children can progress inside one system instead of starting again.

## The experience

1. **Scan it.** A photo of a toy the kid owns becomes a digital toy using Meta SAM 3.1, with a grown-up-supplied real length as the scale anchor.
2. **Build it.** The kid swaps parts and paints while the move list updates. Live checks keep physical builds printable.
3. **Play it.** The same toy explores small 2.5D worlds, finds hidden parts, repairs junk machines, and solves STEM missions.
4. **Create it.** The kid describes a world in words, voice where supported, or picture cards. Meta Muse Spark returns a constrained recipe that the game validates before loading.
5. **Make it real.** A grown-up approves a home print or future order, and the upgrade snaps onto the real toy.

Ordering is a side door, never a gate: payment is not required to build, explore or finish the core missions.

## The technical spine

Beneath the play layer is one open modular system. Humans, animals, robots and accessories share a module vocabulary. Printable parts carry typed connection metadata — interface, orientation, intended mates, fit, printability and safety — so AI composes only from parts that can really mate. AI perceives, arranges and explains; deterministic code owns geometry, compatibility and print checks.

Snap and Pro swap directly where scale allows, with fit-checked adapters where it does not. Humanoid joint axes map to a standard animation rig for reusable motion.

## Business sketch

The long-term model is a monthly seasonal pack: one season, one STEM idea, and something to try in the real world — levers on a snow day, floating and sinking on a rainy day.

- **Digital:** seasonal world and missions, digital parts and skins, Create pieces, and challenge cards.
- **Maker:** everything in Digital plus print-at-home files.
- **Box:** everything in Digital plus printed parts, printed challenge cards and a grown-up guide.

Families can also print custom upgrades at home or have a grown-up approve a future delivered order. Targets — delivered parts from $1 and print costs of $0.50–$5 per design — and subscription prices still need supplier proof. US launch first.

## Promises and proof

No ads, no open chat, and no paid random items for kids. Grown-ups approve orders, settings and sharing. ToyVentor is designed around data minimisation, original or licence-clean designs, constrained AI outputs, and privacy and toy-safety review before launch. Kids keep unlocks if a subscription stops, and adapters bridge standard revisions.

For the hackathon, proof is deliberately narrow: one scanned toy becomes a checked build, enters ToyVentor World, solves a mission, creates a validated world, and produces print files. Checkout and fulfilment are mocked; electronics are roadmap; no printed part is safety-certified yet.

Next evidence: playtests with eight or more kids, a four-year-old reaching the first find unaided, scan-to-play under a minute, repeated snap-fit/durability testing, and seasonal-pack retention.
