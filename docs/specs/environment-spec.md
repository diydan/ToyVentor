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
  rig; lamps and lanterns are lit at night.
- **The day version is the one a child plays first.**
- **Build the map's day and night now.**

## One clock

`src/lib/timeOfDay.ts` (built): `timeOfDayFor(nowMs, timezone, mode)` gives
`day` (07:00 to 18:59, confirmed by Dan) or `night`, read from the **device's
own clock**, so it is the user's local time and follows them when they travel.
(The grown-up's timezone setting is saved once and can go stale, so the look
does not use it; play-time limits and quiet hours still do.) A grown-up can pin Auto, Day or
Night on the device (`tvTimeOfDay:v1`); the pin also makes either look easy to
show. The map, the Garage and, later, the 3D worlds all read this one function.

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
