# ToyVentor: 90-second demo script

November 4 readiness: reviewer touches the live app and sees a scanned toy
become printable, playable, and shippable.

## The run

1. **0–10:** scan or choose a starter toy.
2. **10–25:** equip two upgrades and watch the stats move.
3. **25–40:** complete the garden mission.
4. **40–55:** open the daily pack and equip the pull.
5. **55–70:** reveal the Character Card and hear its theme.
6. **70–90:** open 3D Print and export the support-free STL.

> “Scan a real toy. Equip speed, rescue, and splash. Play one garden mission,
> open today’s pack, reveal the Character Card, create one splash world, and
> print the part.”

## Shot list for the backup

1. Toy shelf with augmented starter.
2. Build sheet with 4/4 checked part.
3. Pack Rip.
4. Playground glider mission.
5. Character Card reveal.
6. Order or 3D-print preview.

## Backups, in the order they save the run

- **No service:** use the cached build and keep everything local.
- **Camera blocked:** use Red Racer or Kip.
- **Scan finds nothing:** retry, enter name/kind/size manually, or pick a seed.
- **Model or physics fails:** name the failure, retry or switch toys, and do
  not improvise.
- **Part will not fit:** show the failed check and suggest repair, forge, or
  reprint.
- **Pack already claimed:** show that one-claim-per-day is working.
- **Make from words is slow or unreachable:** the maker service runs on the
  author's machine for now, so the app offers a ready-made hat or head. Say so;
  do not improvise.

## Check before recording

Confirm smoke checks, the canonical review payload, live world page, seeded and
fresh mission states, and print gating. Preload the demo toy first on the
shelf; keep a pre-saved build ready for the Build beat.

Say once, out loud: this demo uses Meta's hosted model with adults operating it,
because Meta's hosted terms are for adults; for children the same feature runs
on a self-hosted model. Scan a toy, not a person: the photo goes to Meta's
hosted model through our Worker, and this build has no grown-up check in front
of the scan. The selfie's optional Smart face is on for the demo: it sends one
downscaled photo of a face to the same hosted model after a consent screen and
a grown-up check, so use an adult's face and say so.


## Where this lives

The demo behavior is governed by [spec.md](spec.md); the one-stage flow is in
[world-first-spec.md](../ux/world-first-spec.md). After recording, file the
video, the write-up, and the live-deploy verification together so the
submission is reproducible from the repo state.

