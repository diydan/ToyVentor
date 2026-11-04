# ToyVentor: 90-second demo script

November 4 readiness: reviewer touches the live app and sees a scanned toy
become printable, playable, and shippable.

## The run (draft of 2026-11-04, not yet rehearsed or timed)

Dan picks the length ("Video length" in [close-out-checklist.md](close-out-checklist.md) section 4). The order below is the whole run; for 90 seconds drop beats 3, 6 and 8 first. Waits that were measured are named; every other length is unknown until the first rehearsal with a stopwatch.

1. **Open it from the home screen icon** (the installed web app, full screen). One sentence: scan a real thing, make a toy part from it, print it, play with it.
2. **Describe & Build.** Say a wish into the mic (an adult speaks; the hosted transcriber is on only if `TRANSCRIBE_BACKEND=hosted` is set). The blocks start in a pile and are carried to their seats.
3. **Make from words** in the Kip bench: a hat or a head. A real wish takes about 22 s (measured twice on 2026-11-04). Start it and cut the wait in the edit, or use the ready-made one and say so.
4. **The flagship: Tools > Pick it up.** Put a spoon on the desk, press the shutter with no word: the app says "It looks like a spoon!", the spoon is cut out where it lies, lifts off the camera picture and flies into Kip's hand. Then a guitar: tap the word "guitar" first, so the naming model is not the thing that can fail on camera. Kip plays it.
5. **The moment song.** Tap "Make a song about the guitar". The name and words appear first; the sound follows about 45 to 50 s later (Spark 13 to 20 s, Mureka about 32 s). **Stay in the bench until it plays:** closing the Workshop destroys the bench (`WorkshopLauncher.tsx` frees it on close), and a song still being made is lost. Or make the guitar and spoon songs before recording and say they were made earlier.
6. **Close the Workshop.** The game's Kip is still holding the guitar (the game's own) or a flat card of the spoon, in the Toy Room. Put it away with the chip ("Put the guitar away") or by tapping Kip. A tap on Kip while he holds the guitar puts it away; it does not strum.
7. **Make a mess.** The juice cup spills or the toy box tips, Kip says "Oh no, oh no", the child taps **Clean**, the pile is tidied. (It is a button; nothing listens for the spoken word.)
8. **A song and a dance.** The party plays the starter songs (no spend) and Kip dances.
9. **One line on the custom model, only what the ladder allows** ([close-out-checklist.md](close-out-checklist.md) section 4, "Do not say").

> "Point a camera at a real spoon, and Kip picks it up. Point it at a guitar, and he plays it, then we make a song about it. Say what you want to build and the blocks arrive in a pile. Make a mess and Kip says oh no, and the child cleans up."

**What the camera flow is, when asked:** a camera view with an overlay on a still frame: SAM cuts the object out of the frozen picture, a flat card or a 3D item goes in Kip's hand. It is not tracked AR and not real-time detection (there is no WebXR, and SAM is a seconds-long round trip).

## Shot list for the backup

1. The home-screen icon, then the app full screen.
2. The pile and the seats (Describe & Build).
3. The camera view with the spoon, "It looks like a spoon!", the cut-out in flight.
4. Kip with the spoon, then Kip playing the guitar.
5. The song card with its words, and Kip dancing to it.
6. The game's Kip holding the card, and the "Put the spoon away" chip.
7. The spilled cup and the Clean button.

## Backups, in the order they save the run

- **No service:** use the cached build and keep everything local.
- **Camera blocked (or the page is on plain `http://`, where phones refuse the camera):** the Pick it up view says so and offers a photo instead; use a pre-shot photo of the spoon and say it is pre-shot. Red Racer or Kip also work.
- **The naming helper says the wrong thing or nothing:** tap the word first (spoon, guitar, pan); the shutter then scans that word and the helper is not called.
- **Scan says "slow down":** `/api/scan` allows 10 a minute per address and the plate's fit check 5 a minute (shared with Make from words); wait the stated seconds.
- **No "Make a song" button:** the song settings are not set on the Worker, so the button hides by design. Play the starter songs and say nothing about a made song.
- **Scan finds nothing:** retry, enter name/kind/size manually, or pick a seed.
- **Model or physics fails:** name the failure, retry or switch toys, and do
  not improvise.
- **Part will not fit:** show the failed check and suggest repair, forge, or
  reprint.
- **Pack already claimed:** show that one-claim-per-day is working.
- **Make from words is slow or unreachable:** a wish takes about 20 seconds (the
  model names the part in seven languages; the maker itself answers in well under a
  second), and the maker runs in a Cloudflare Container that sleeps after 10 idle
  minutes. If it is unreachable the app offers a ready-made hat or head. Say so;
  do not improvise. Two live wishes on 2026-11-04 took 21.8 s and 21.9 s.

## Check before recording

Confirm smoke checks, the canonical review payload, live world page, seeded and
fresh mission states, and print gating. Open the installed app online once and check
the version pill shows the deployed version (the Kip files are cached by the service
worker, now `toyventor-v6`). Do one real pick-up of the spoon and the guitar on the
phone you will film with; that pass has not been done. Preload the demo toy first on the
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

