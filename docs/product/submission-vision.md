# ToyVentor — submission vision

Use this file for the tight external story. [vision.md](vision.md) is the
longer internal direction; [spec.md](spec.md) governs the demo.

## Why it exists

Toy scanners capture a shape and abandon the child. ToyVentor closes the loop:
scan a real toy, rebuild it from the verified printable catalog, improve it with
snap-on upgrades, play it across worlds and labs, then design, play, and print
the result.

## Five pillars

- **Scan once, keep building:** SAM outlines become toys; green checks gate
  printable files and AR placement.
- **Real parts, real game stats:** 13 printable base parts plus Racer Garage
  and Kip Wardrobe sets power speed, spin, glow, and torque.
- **Grown-up controls:** builds are saved on the device first; a grown-up check,
  a daily time ledger, and a Sleep Curtain are built. The grown-up check in
  front of file downloads is built and switched off in this build. Sharing
  between families, contacts, and moderation are designed, not built.
- **Proof, not concept:** six worlds, six labs, 44 missions, STL/GLB exports,
  and one stage from toy to game to printed part.
- **Creator loop:** worlds, levels, missions, and moods built from play, and a
  part made from a child's own words.


## The experience

Scan or choose Kip, Roadster Racer, or Star Scout; equip an upgrade; play a
mission; open one pack; reveal the Character Card; and print the part. Every
beat is touchable by a reviewer with no setup: the shelf preloads the demo
toy, the build beats use a pre-saved build, and failures reply with a named
cause instead of a dead end. The 90-second run is in
[demo-script.md](demo-script.md).

The build holds more than the 90-second run shows: **Make from words** (a child
types a hat or a head; the part is checked by the same print gates as the
catalog, and Kip wears it), the **Describe & Build** book of 35 builds, the
**Workshop** with its Kip, Truck, and Yard benches, the Toy Room toys, party
mode with twelve songs and a Dance picker, spoken names for props and
household objects, and Garage weekends. Make from words runs on Cloudflare: the
model writes a recipe, and a maker in a Cloudflare Container (no public address,
reached only by our Worker) builds the part and runs the print checks. On the
live site a wish takes about 20 seconds, almost all of it the model; where the
maker cannot be reached, the app offers a ready-made hat or head instead.


## The technical spine

SAM outlines toys on the worker: a photo of a toy goes to Meta's hosted API
through our Worker, which does not store it. Muse Spark proposes level recipes
that the game validates before it uses them; themed audio loops are reviewed
ahead of time, never generated live. Make from words and Describe & Build have
the same shape: the model picks parameters, and code builds and checks the
part. There is no chat. Parents start voice (it uses the browser's own speech
recognition), and children can play muted. The toy contract keeps app builds
and game slots separate.

## Models, children, and what this does not claim

ToyVentor is for children (Snap 3+, Pro 8+). Meta's Model API terms (updated
October 9, 2026, section 10.1) say end users must be 18 or older and that
products built on it must not be targeted at people under 18. So this demo uses
the hosted API with adults operating it, and the route for children is a
self-hosted model: the same feature on Muse Glimmer 30B, run on our own
infrastructure. On 40 test wishes, run three times, Glimmer returned 33, 37 and
36 printable parts out of the 37 that should make one, against 36 of 37 on Spark.
In the first run, three of the four failures were Modal's proxy dropping the
connection (the model server's own log shows no error) and one was a timeout;
the last run had one timeout, most likely a slow generation under load. One
setting per capability picks hosted, self-hosted,
or off, and "self-hosted" never falls back to hosted.

Not claimed: that ToyVentor is assessed under COPPA, the UK Children's Code, or
GDPR for children; that Glimmer is the default or in production; that the
safety checks have had a children's red-team (the unsafe-word lists cover
seven languages, but no native speaker has read the six translations); or that any grown-up check stands in front of file downloads in
this build. Photos of toys reach Meta's hosted API with no grown-up check in
front of the scan. The optional Smart face in the Kip selfie is switched on for
this demo: after a consent screen and a grown-up check, it sends one downscaled
photo of a face to Meta's hosted API. That is another reason the demo is
adult-operated, and the route for children keeps it off.

## Business sketch

The app can be free while physical toys, kits, replacement parts, and printed
or ordered upgrades carry the business. Subscriptions can unlock new toys,
exclusive content, marketplace access, and creator powers.

## Promises and proof

No separate product is promised: marketing or external tools may reuse the
wording, but the submitted app, worker, game lane, catalog, docs, and seed
data are the package. Geometry, placement, and fit are exact; slicer settings
are illustrative; the Reveal theme remains a synth placeholder. Reviewers can
verify onboarding, scanning, building, packs, Reveal, and printing in one
uninterrupted 90-second run.

