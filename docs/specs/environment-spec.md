# Environment: time of day and weather — spec (draft 1, 2026-11-03)

How the game's look follows the clock, and later the weather. One spec for the
map and the 3D worlds, so they always agree. The two-look map (day and night)
is the first piece and is being built now; everything after it is **post
hackathon** (Dan, 2026-11-03).

## Decisions so far (Dan, 2026-11-03)

- **Two looks, day and night.** Night is the **same scene** with the lights on
  and its own lighting, not a different place.
- **Indoor scenes are identical** at night and during the day.
- **The 3D worlds** use the day and night **mid and far backgrounds** from the
  parallax spec (parallax-backdrops-spec.md), with a day and a night lighting
  rig; lamps and lanterns are lit at night. **Built 2026-11-04** (parallax
  spec section 8): all five outdoor worlds, both looks, from this one clock.
- **The day version is the one a child plays first.**
- **Build the map's day and night now.**

## Lighting presets and the cost knobs (2026-11-04)

Dan: "bloom and light sometimes a bit too reflective, do a review on lighting; ideally a reusable setting for all scenes and levels, with an indoor and outdoor, night and day", and "performance is a
bit slow, any obvious wins for animated scenes". **Built** (`runtime/lighting.ts`, `runtime/worldScene.ts`; `tests/lighting-presets.test.ts`, 21 tests).

- **The setting.** Four presets, `LIGHT_PRESETS["outdoor-day" | "outdoor-night" | "indoor-day" | "indoor-night"]` and `presetFor(place, time)`. A world, a level or a generated level says where it is
  (`place`: indoor or outdoor; absent = the Toy Room indoors, everything else outdoors) and when (`mood`: day, dusk or night) and `rigFor` gives it that preset's lights, fog, reflections, bloom and grade. The
  themed rigs (Garden, Sky Meadow, Junkyard, Beach, Snow Peak, the Toy Room) are the presets with a world's own character. A level may carry `"place": "indoor"` next to `"mood"`. The Toy Room stays the
  evening by default (the "indoor looks the same at any hour" decision stands); `indoor-day` exists for a level that wants a daylight room (a kitchen, say) and is used when a world asks for it.
- **What the review found** (screenshots of every world by day and by night, and a frame-cost benchmark on the headless Metal GPU, one setting at a time):
  1. Nearly every material had a full clearcoat and a strong reflection of the studio environment (`plastic` clearcoat .85, toy paint clearcoat 1.0 with metalness .28): floors, palm leaves and toy parts
     shone like mirrors and their highlights went over the bloom threshold. Now satin: plastic clearcoat .3, toy paint clearcoat .3 and metalness .08, reflection 0.55 to 0.6, chrome a little less. A caller can
     still ask for gloss (the Kip's skin and the glass do).
  2. The day worlds white-washed: Sky Meadow was 69 % pixels brighter than 200 of 255, Snow Peak 25 %. Day is now lower and cooler (key 1.4, fill .62, exposure .9, reflections .55): 20 % and 12 %.
  3. The night worlds bloomed at 0.9 to 1.0 with strength .4 to .45, so every highlight glowed. Now threshold 1.25 to 1.5, strength .24 to .32; the twilight Snow Peak is darker.
  4. Bloom ran at full price in the day worlds where its threshold (2.0 and up) made it do nothing. A bloom pass that cannot show is not run (`bloomWanted`: strength above .02 and threshold below 2).
- **Cost.** Measured on the garden at phone size, the previous commit against this one, alternating runs: about 4.3 ms a frame down to about 2.9 (median 4.5 to 2.5). Largest single items, in order: the
  clearcoat, the 2048 shadow map (now 1024), the pixel ratio (a phone's 3 was capped at 2, now 1.5), bloom. The adaptive step-down used to look ONCE, 2.5 s after start, and only below 29 fps; it now judges
  every 120-frame window (a step below 33 fps, two below 22), settles for 2 s after a step, never undoes one, and a new world no longer turns bloom back on after it was lowered.
- **Not done (next, in order of size):** the Kip's own STL parts are about 126 000 of the garden's 321 000 triangles (a decimated copy for the game); 279 foliage spheres are another 105 000 (merge or instance
  them); 97 % of all meshes cast a shadow (small and far decor need not); the renderer's multisampling is paid for a full-screen pass the FXAA already smooths. Not judged on a real phone.

## One clock

`src/lib/timeOfDay.ts` (built): `timeOfDayFor(nowMs, timezone, mode)` gives
`day` (07:00 to 18:59, confirmed by Dan) or `night`, read from the **device's
own clock**, so it is the user's local time and follows them when they travel.
(The grown-up's timezone setting is saved once and can go stale, so the look
does not use it; play-time limits and quiet hours still do.) A grown-up can pin Auto, Day or
Night on the device (`tvTimeOfDay:v1`); the pin also makes either look easy to
show. The map, the Garage and the 3D worlds all read this one function (the 3D worlds since 2026-11-04).

## Stretch goal (post hackathon): a continuous look, and weather

Dan: not just night and day but a transition through the day (midnight darker
than dusk), and weather specific, so if it is raining where the user is, it is
raining in the game.

### Continuous time of day

Replace the two looks with a smooth curve: `skyAt(now, timezone, place?)`
returns `{ daylight 0..1, phase (night | dawn | day | dusk), depth 0..1 }`,
where `depth` is how deep the night is (midnight is darker than 20:00).
Rendering interpolates between a few keyframes (day, dusk or dawn, night, deep
night): sky colours, fog, light colours and strength, the overlay on the map,
and a **cross-fade between the day and night background images**. Lamps fade
on as `daylight` falls. The map is already written against a single `darkness`
scalar (0 day, 1 night), so this is a change of input, not of art. Sunrise and
sunset need a rough latitude; without one, use fixed hours (as now) or the
timezone's region.

### Weather

Conditions: clear, cloudy, rain, snow, storm, fog. A weather scene is a
particle layer (rain, snow), a muted sky and light, wet or snowy ground, and
sound, in the world and on the map. Gentle always: no lightning flashes, and
`prefers-reduced-motion` drops the particles.

### The privacy problem (decide before any weather-by-location work)

The product spec's Safety and privacy section says ToyVentor **"never collects
names, contacts, locations, photos, or builds"**. Weather where the child is
needs a location, so it contradicts that sentence as written. Options, in the
order to try them:

1. **Manual weather** (no location at all). A grown-up, or Demo Mode, pins
   Clear, Rain, Snow or Fog. Ships the whole look with nothing collected.
2. **Coarse weather by city, with consent.** A grown-up picks a **city from a
   list** (never GPS, never an address) behind the parent gate, with a consent
   screen like Smart face's. The device asks the Worker for that city's
   condition code only; the Worker returns clear, rain and so on, caches it for
   about 15 minutes per city, stores nothing, and has a kill switch (like
   `SELFIE_CLOUD`). The request is the same for everyone in that city. The
   Worker, not the device, talks to the weather provider, so the child's
   address is not exposed to it.
3. Anything finer than a city: not proposed.

Option 2 changes a written promise, so it needs the compliance owner's decision
and the COPPA review, and the sentence in spec.md updated. Option 1 does not.

## Phases

| | What | Needs |
| --- | --- | --- |
| E0 | Map day and night, one clock, a Grown-ups pin | Built now |
| E1 | 3D worlds day and night on the parallax mid and far images; lamps lit at night; indoor unchanged | Parallax approval and art (that lane) |
| E2 | Continuous curve: dawn, dusk, deep night, cross-fade | E1's two looks as keyframes |
| E3 | Manual weather, in the world and on the map | E2; rain and snow layers; sound |
| E4 | Weather from a chosen city | The privacy decision above |

## Tests (when built)

Unit: the curve at fixed instants and timezones (monotonic, `depth` deepest
around local midnight), keyframe interpolation, weather codes mapped to
scenes. E2E: forced times and weather give the expected look on the map and in
the world; reduced motion shows no particles; nothing in the child UI says
where the user is.
