# Accounts and the new-user flow: spec (draft 1, 2026-11-04; phase 0, the on-device onboarding, was built the evening of 2026-11-04 and is described under section 8 as it actually is; accounts and login are not built)

Dan (2026-11-04): "I'd like to create user account, parents must setup for anyone under 13", with this onboarding: "Kid's name and parent's name. Kid's favourite colour, fruit and animal. Create character, with music and theme song." Then an addendum: the character step starts with a pile of bricks like the Kip demo's Describe and Build; then a main intro animation with confetti and the theme song made for the first user, played while Kip dances; then a quick intro to the app: benefits, the three tiers of progress, the weekly challenge, STEM education alignment, and two ways to get real objects (DIY 3D print at home, or a monthly kit subscription).

Not legal advice. Related: `docs/specs/coppa-readiness-spec.md` (this spec is the proposal for its open decision D4), `docs/decisions/0008-meta-models-and-under-18-users.md`, `docs/specs/app-continuation-spec.md` (the grown-up PIN), `docs/specs/xp-system-spec.md`, `docs/specs/dance-party-spec.md` (songs and the quota), `docs/specs/garage-weekend-spec.md`.

## 0. Status and how to read

Dan chose **"onboarding now, accounts later"**. So this document is two things:

1. **Phase 0 (tonight, before the 6 PM ET freeze):** a parent-led, opt-in, on-device onboarding. No login, no email, nothing about the family stored on our servers. The profile lives in `localStorage` under `toyventor:profile:v1`. The only thing that leaves the device is the theme song request, and only after a grown-up taps a consent button (section 3, N7). Section 3 is written to be built from.
2. **Phases 1 to 4 (after the freeze):** real accounts for grown-ups. Everything in sections 2, 4 and 5 for those phases is a plan. Nothing in it is built.

Marks: **DECIDED** is something Dan said. **PROPOSED** is mine and Dan can change it. "Verified" means I read it in the repo on 2026-11-04. "Not checked" means I did not. Where Dan's addendum asks for facts about the product (tiers, weekly challenge, STEM wording, kits), section 3.2 uses only what the repo says, cites it, and lists the rest as open questions: I did not invent any of it.

## 1. What exists today (verified in the repo, 2026-11-04)

| Item | Where | Note |
| --- | --- | --- |
| An anonymous **device UUID**, the only identity | `src/lib/sync.ts`, `localStorage` key `toyforge:device:v1`, sent as `x-device-id` | The comment there says "Anonymous per-device identity until real accounts exist". `worker/ownership.ts` says "real accounts map onto the same id". |
| D1 tables keyed by it | `ownership`, `parent_settings`, `time_ledger` (`migrations/0001`, `0002`), `song_reservations`, `song_settings` (`0003`), `world_budget`, `world_art_redeem` | The id must match `isPlayerId`: `^[A-Za-z0-9-]{16,64}$` (`shared/ownership.ts`). A new kind of id (a child's) has to pass that check or the check changes. |
| A grown-up check | the gear held 1.2 s, then a multiplication question or a 4-tap PIN (`app-continuation-spec.md`, "First-time setup"); `worker/parent.ts` issues a short-lived HMAC `x-parent-proof` (5 to 10 minutes) bound to the device id | "There is no separate login wall." The COPPA spec says this check is **not** consent (a hold plus a math question is an age screen at best). |
| An age band | `ageBand` in `toyforge:progression:v1` (`src/lib/progression.ts`); a grown-up sets it in the Grown-ups sheet (`qa.md` Part 5 setup) | The onboarding's age answer could feed it. Not decided (open question 9). |
| Per-device XP | `xp-system-spec.md` Decision 4: "One shared pool per device. Per-kid profiles would change the data model of every ledger write... Revisit post-freeze only if parents ask." "No account system is being built for the freeze." | |
| Song quota per device | `shared/songQuota.ts` `WEEKLY_SONGS = 5`; `dance-party-spec.md` 4.6: "when profiles exist the quota follows the profile" | Production has `THEME_SONG`, `MUREKA_API_KEY` and `SONG_MONTHLY_BUDGET` set (`wrangler secret list`, 2026-11-04). |
| No email | `wrangler.jsonc` has D1, R2, AI, a service binding, a rate limiter, and no `send_email` or email service | Sending a sign-in link needs something new (section 2.2). |
| The privacy line we may say | `coppa-readiness-spec.md` section 4: "It has no accounts, stores no wish text..." | Accounts make that sentence false (section 5). |
| `kidSafeText` | `worker/muse.ts` (Worker side, not `shared/`) | Rejects unsafe terms, link-like and contact-like text. The theme-song route already applies it to a child's own words (`kind: "prompt"`). |
| The toy's name syncs to D1 | `coppa-readiness-spec.md` section 1: the toy name (free text, 48 characters) is in `ownership.payload` | Phase 0 must **not** put the child's name in the toy's name, or it would reach D1 (section 3, N8). |
| Confetti | `confetti()` in `runtime/world.ts`; `play-design-spec.md` "juice" setting (calm, normal, party) sizes the squash, sparkle and confetti | The intro reuses it and respects the juice setting and reduced motion. |
| The pile | the Kip bench's Describe and Build tab (`parts/kip/viewer/kip-describe-tab.js`): parts start in a pile and are carried to their seats; the waiting-state pile is in `parts-engineering-spec.md` (the parts pile fills along `1 - exp(-t/5.5)`) | It is a **bench** feature, not a game screen (section 3, N8). |

## 2. Decisions

| # | Question | Mark | Decision |
| --- | --- | --- | --- |
| A1 | Accounts for whom | PROPOSED | **Grown-ups only.** A child never has an email, a password or a login. This matches `toyventor-town-vision.md` ("no child accounts: a grown-up's account holds the saves") and `coppa-readiness-spec.md` section 5. |
| A2 | Who sets up a player under 13 | **DECIDED** | **A parent does.** The parent passes the grown-up check and the consent screen first and types their own name. |
| A3 | A player 13 or older | PROPOSED | May set up alone, with the same screens. The age answer is self-declared and a child can lie; section 5 says what that means. |
| A4 | Anonymous play | PROPOSED | **Stays.** Nothing is locked behind an account. A device can be **claimed** by a family later (2.5). |
| A5 | Children | PROPOSED | A child is a **profile under a family** (first name or nickname, favourites, age band). One family, many children. |
| A6 | Login method | PROPOSED | An **emailed one-time link**, no passwords. Passkey as the second option (2.2). Dan decides. |
| A7 | When the first-run flow is the default | PROPOSED | Not tonight. Tonight it is opt-in (3.0). Whether a fresh visitor, a judge included, is sent through it is Dan's call after the freeze (open question 3). |
| A8 | Onboarding content | **DECIDED** | Names, favourites, a character built from a pile, music and a theme song, a confetti intro with Kip dancing, then a short intro to the app (3.2). |
| A9 | Tonight's intro | **DECIDED** | Static copy slides with confetti. No purchase flow, no payment, no email capture. The subscription slide is information only. |

### 2.1 Who is a "user"

Today a user is a device UUID. After accounts, a **subject** is one of: the device UUID (anonymous play, unchanged), or a child of a signed-in family. The existing tables keep their `player_id` column. A child's quota and XP use the child's own subject id in that same column, once it passes `isPlayerId` (a `c-` prefix and a UUID is 38 characters, inside the 16 to 64 limit). So no existing table is altered. This is phase 3 work and costs a change to every ledger write (`xp-system-spec.md` Decision 4 explains why it was deferred).

### 2.2 Login method (PROPOSED; Dan decides)

| | Emailed one-time link | Passkey (WebAuthn) |
| --- | --- | --- |
| What the parent does | Types an email, opens the link on the same device | Taps the phone's fingerprint or face prompt |
| New work in the repo | A `login_links` table, a send route, a verify route, session cookie. About one day. | Registration and assertion verification in the Worker (a library such as SimpleWebAuthn, not checked here), a `credentials` table, a fallback for lost devices. About two days. |
| Needs outside the repo (Dan) | An email service on `toyventor.com`: Cloudflare Email Sending (domain onboarding in the dashboard; SPF, DKIM and DMARC records) or another provider's API key as a Worker secret. **Not set up. Not checked whether Email Sending is available on this account.** | Nothing outside the repo. The domain is the relying-party id, so staging and production are separate sets of credentials. |
| Recovery | The email is the recovery | Hard: a lost phone needs a second way in, which is usually an email anyway |
| What we hold | The parent's email address (personal information of an adult, collected for an account) | A credential id and public key. No email unless we ask for one. |
| Abuse | Link flooding: limit per email and per IP | Few: nothing to flood |

My proposal is the emailed link because it is the familiar flow and doubles as the recovery path; passkeys can be added later as a second factor. **No passwords.**

### 2.3 Sessions, limits, abuse (PROPOSED)

- A session is an opaque random token in an **httpOnly, Secure, SameSite=Lax cookie**; the database stores only its hash. Lifetime 30 days idle, 90 days absolute, **rotated on every use after 24 hours**. The grown-up PIN still guards parent actions on the device; the session says whose family it is, the PIN says a grown-up is holding the phone.
- A sign-in link is single use, expires in 15 minutes and stores only its hash. Asking for one is limited to 3 an hour per email and 10 an hour per IP, using the rate-limit binding the Worker already has (`MODEL_SPEND_LIMITER` is for model spend, so this needs its own namespace). The reply never says whether the email exists.
- Account creation is limited per IP per day. A family holds at most 6 children and 3 grown-ups.
- Nothing in the child's screens ever shows an email address, a link, or any text field except the first name.

### 2.4 Data model, migration `0004_families.sql` (PROPOSED; phase 1 and 2)

`0001` to `0003` are never edited. All new tables use `CREATE TABLE IF NOT EXISTS`, like the earlier ones, and the Worker creates them on first use as `0002` and `0003` do.

```
families(id TEXT PK, created_at, timezone, deleted_at)
parents(id TEXT PK, family_id, email_norm UNIQUE, email_verified_at, display_name, created_at)
children(id TEXT PK, family_id, first_name, under_13 INTEGER, age_band, created_at)   -- first name or nickname only
favourites(child_id PK, colour, fruit, animal, mood, instrument)                      -- closed-list ids, no free text
consents(id, family_id, parent_id, kind, version, method, given_at, revoked_at)       -- kind: account, song_name, data
login_links(token_hash PK, email_norm, created_at, expires_at, used_at)
sessions(token_hash PK, parent_id, created_at, last_used_at, expires_at, rotated_from)
device_claims(device_id PK, family_id, child_id, claimed_by, claimed_at)
```

### 2.5 Claiming a device (PROPOSED; phase 2)

A signed-in parent taps "This is our family's phone" and picks a child (or none). That writes one `device_claims` row. The Worker then answers for that device id as before, plus the family's data when a session is present. **Nothing is re-keyed or copied**: the rows in `ownership`, `parent_settings`, `time_ledger` and `song_*` keep the device id they already have, and a claim is only a mapping. Restoring on a new phone means signing in there, which adds a second `device_claims` row for the same family and reads the first phone's toys through the family. An un-claim deletes the mapping row and nothing else. Phase 2 must answer: which phone's parent settings win when two devices disagree (open question 10).

### 2.6 Delete everything (PROPOSED; phase 4, a precondition for switching accounts on for children)

A signed-in grown-up, after the PIN, taps **Delete this family**: soft-delete the `families` row, then a job removes every `children`, `favourites`, `consents`, `parents`, `sessions` and `device_claims` row and every row in the device-keyed tables for the claimed devices (`ownership`, `parent_settings`, `time_ledger`, `song_reservations`, `song_settings`), and deletes `songs/<device>/...` objects in R2. A test must fail when a new table keyed by a device or child id is added without being listed in the delete list. The COPPA spec already asks for the device-level version (`coppa-readiness-spec.md` P1).

### 2.7 Retention (PROPOSED; the numbers are Dan's and the compliance owner's)

Login links 15 minutes. Sessions their lifetime. Unused anonymous device rows: not decided (`coppa-readiness-spec.md` D3). A deleted family: all rows gone within 30 days, the song files with them. Consent records are kept for the life of the account because they are the proof.

## 3. The new-user flow

### 3.0 Entry points

- **Tonight:** a **"New player"** item in the Grown-ups sheet (behind the existing grown-up check), and `?onboarding=1` on the game URL. Neither is shown to anyone who does not look for it, so a fresh visitor and a judge see the title menu exactly as before.
- **Later (open question 3):** the first-run default for a device with no `toyventor:profile:v1`, with "Skip, just play" always available.

### 3.1 Screens

Fresh state is `toyventor:profile:v1` absent. Every screen has Back, a visible step count ("Step 3 of 11"), 56 px or larger targets, and text labels (never colour alone).

| # | Screen | What happens | Fails or skips |
| --- | --- | --- | --- |
| N1 | **"Is the player under 13?"** Two big buttons: Yes, No. Spoken. | Sets `under13`. Yes: the next screens are for a grown-up and the copy says so ("Hand the phone to a grown-up"). No: the same screens, worded to the player. | Closing here stores nothing. The answer is self-declared (section 5). |
| N2 | **Grown-up check** | The existing hold and question (or PIN, if one is set). A first-time device also sets a PIN here, as the Grown-ups sheet does. For a player 13 or over, the same check runs. | Five wrong PINs: the existing 30 s cooldown (`app-continuation-spec.md`). "Skip, just play" ends the flow with nothing stored. |
| N3 | **Parent's name** | One text field, first name only, 1 to 30 letters. "What should we call you?" | Empty or not letters: a plain line under the field. Skippable: stored as "Grown-up". |
| N4 | **Child's first name or nickname** | One text field, **letters only, 1 to 20**, checked on the device with the same rules as `kidSafeText` (links, contact-like text, unsafe words) and again in the Worker when it reaches the song request. "What do we call the player? A nickname is fine." | Not allowed: a kind line such as "Let's pick a different name!" (the song route's own wording is "Let's pick a different idea!"). Skippable: the song then says "you". |
| N5 | **Favourites**, three pages of tiles: **colour**, **fruit**, **animal** | Pick one tile on each. **Closed lists, no typing**, so nothing a child wrote can reach a model through these. Colours are the swatches Kip can wear. Fruit comes from the fruit the game already names (`FRUIT` in `propReactions.ts`), so each tile can also be spoken by the existing voice clips. Animals are a list of 8 to 12 chosen for words a song can use. | Skipping any page uses a default; the colour default is the Kip shirt orange. |
| N6 | **Pick the music** | Two tile rows from the closed song lists: a mood (bouncy, sleepy, silly, space, kitchen, cleanup) and an instrument (drums, piano, guitar, trumpet, maracas, bells, xylophone, synth; at most two). | Skip: bouncy. |
| N7 | **Song consent**, a grown-up screen | Says in two short sentences what is sent: "We will send the name you chose and the favourites to our song makers to write and sing a theme song. They are not used for anything else." Two buttons: **"Make the song"** and **"No thanks, no song"**. A line with the name is shown before the tap. A checkbox "Use the name in the song" is **off by default**; off means the song is written from the favourites only (see 5.2). Tapping Make the song stores the consent locally (`profile.consent.song = { at, version }`) and **starts the song request in the background**. | "No thanks": nothing leaves the device; N9 uses a starter-library song. Offline or no quota: same. |
| N8 | **Build: the pile** | A **pile of bricks** (the Kip demo workshop's pile) and Kip builds himself from it: the parts are carried to their seats. The shirt is the favourite colour. Then the existing Build screen opens for changes, with a "That's me!" button. **The child's name is not put in the toy's name** (it would sync to D1). The song is being made while this plays. | Parts failing to load: the existing procedural fallback Kip appears with no pile. Reduced motion: the finished Kip appears with a short fade. See 3.4 on how the pile gets into the game. |
| N9 | **The intro** | Confetti falls (sized by the juice setting) and **the theme song plays while Kip dances**, with the karaoke words lit (the existing song card and "My songs" dance party). The song joins My songs. | The song is not ready by the time N8 ends, or fails, or the weekly quota is spent: confetti and a starter-library song play now, and a finished theme song is added to My songs when it arrives. Nothing blocks. Reduced motion: no confetti, Kip stands, the words and the audio still play. |
| N10 | **A quick intro to the app** | Five static slides (3.2), swipe or Next, a Skip on every slide. | Skip goes straight to N11. |
| N11 | **Play** | Opens the world as the title menu's Play does. Writes `toyventor:profile:v1` and sets `S.started` as Play does. | |

The profile (phase 0) is one JSON value: `{ v: 1, createdAt, under13, parentName, child: { name, colour, fruit, animal, mood, instrument }, consent: { song: { at, version } | null }, songId: null | string }`. It is written only at N11, so a half-finished flow leaves nothing, and "Start over" (grown-up check first) deletes the key. Clearing the browser's site data deletes it too, and the device UUID is a separate key, so the song quota is not reset by it.

### 3.2 The intro slides (N10): only what the repo supports

Dan's addendum names five topics. Each row says what the repo actually says, where, and what is missing. **Copy for tonight uses only the "Say" column.**

| Slide | Say (from the repo) | Source | Not specified: open question |
| --- | --- | --- | --- |
| **1. What it is, and why it helps** | "Build it. Play it. Make it real." Scan once and keep building; real printable parts set real game stats; builds save on the device first; a grown-up check, a daily time ledger and a Sleep Curtain are built. | the tagline is `TITLE_TAGLINE` in `titleEntries.ts`; the rest is `vision.md` "Scan once, keep building", "Real parts, real game stats" and "Grown-up controls" | "Benefits" for a parent in plain words (learning outcomes, screen-time claims) are not written anywhere. Q6. |
| **2. Three tiers of progress** | Three difficulty tiers on every mission: **Tier 1 Starter** (open from the start), **Tier 2 Tinker** (opens after 2 stars on the Starter of that mission), **Tier 3 Engineer** (opens after 2 stars on the Tinker). Stars come from 1 to 3 for how well a mission went. | `app-continuation-spec.md` section 4.4; `xp-system-spec.md`; `spec.md` "STEM XP, Quests and Real-Life Routines" | The repo has **other three-step ladders**: concept badges are Sprout, Tinker, Master; toys are Snap, Pro, Max; Maker Ranks run 1 to 6. I used Starter, Tinker, Engineer because it is the one called "tiers". Dan to confirm. Q4. |
| **3. The weekly challenge** | A new **Garage weekend drop** every Friday to Sunday (the parent's timezone), the same for every device: a part to try for the weekend, a build idea, or a remix of your last build. A missed one costs nothing and can come round again. There are also three **daily quests** (`+40 XP` once a day). | `garage-weekend-spec.md` "The weekend drop"; `spec.md` "Daily Quest Board" | **There is no "weekly challenge" by that name.** The weekend drop is the closest. "Weekly STEM pack drops remain parked post-freeze" (`spec.md`), so the slide must not promise a weekly pack. Q5. |
| **4. STEM education alignment** | Eleven kinds of STEM missions (bridge, measure, balance, lever, logic, lift, raft, circuit, code, pattern, clean) and 11 concept badges (Sprout, Tinker, Master) that show a grown-up, in plain English, which skills were practised, in the Grown-ups summary. | `spec.md` "STEM XP, Quests and Real-Life Routines"; `vision.md` "Proof, not concept" | **No curriculum or standard is named anywhere in the repo** (I searched `docs/` for NGSS, Common Core, curriculum and standards). Saying "aligned with" any standard would be a new claim. Q7. |
| **5. Two ways to real objects** | **At home:** a grown-up can export a support-free STL or Kip's `.3mf` plates and sticker packs for a home 3D printer. A grown-up check sits in front of file downloads (built; **switched off in the submitted build**). **Kits:** the vision says "physical toys, kits, replacement parts, and printed or ordered upgrades" may carry the business, and "subscriptions can unlock new toys, exclusive content, marketplace access, and creator powers". | `spec.md` Demo step 6 and the 3D print row; `vision.md` "Business sketch" and "Grown-up controls" | **A monthly kit subscription is not specified anywhere**: no price, contents, cadence, shipping, region or provider. The slide says only what the sketch says, as information, with no price. Q8. |

Slide rules for tonight (decided): static copy, one idea a slide, 20 words or fewer, spoken by the existing voice only if a clip already exists (otherwise text only: no new paid clips), confetti on the last slide only, **no buy button, no price, no payment, and no email or "notify me" field**.

### 3.3 Returning user, two children, and everything else

- **Returning user on the same phone (phase 0):** the profile is found, the title menu opens as it does today, and Grown-ups > "New player" offers "Start over". Nothing is asked again.
- **Returning user on a new phone:** phase 0 has no answer (the profile is on the old phone), and the screen says so plainly. Phases 1 and 2 answer it with sign-in.
- **Two children:** phase 0 holds one profile per device; a second run replaces it after the grown-up check and a "Replace Sam's profile?" confirmation. Phase 3 holds several under one family, each with their own favourites, songs and quota.
- **Skipping:** every screen after N2 can be skipped; skipping stores a default or nothing, and the flow still ends in Play. "No thanks" at N7 means no data leaves the phone.
- **Reduced motion:** no pile flight, no confetti, no dance start; Kip appears built, and the song and its lit words play. This follows the existing `reduce` behaviour.
- **Screen reader and keyboard:** focus moves to each screen's heading on arrival; the heading is read first, then the step count, then the question; tiles are one radio group with text labels; Back and Next are the last two stops; the consent screen reads the sentence and the name before the buttons. Every animation has a text equivalent ("Kip is building himself", "A song is playing").
- **Failure states:** any network failure only costs the song (N9 falls back to the starter library); the flow never waits on the network to continue, and it never shows a technical error to a child.

### 3.4 Work items the screens depend on (phase 0, found while writing this)

1. **The pile is a bench feature.** It lives in `parts/kip/viewer/kip-describe-tab.js`. The game's Workshop is meant to mount the bench modules directly (`workshop-spec.md` stage 4d; not re-checked how far that got). Either N8 mounts the bench's pile for the default Kip, or the pile is ported to the game. **Not decided which, and not checked how long the port takes.** The game's own Kip is built from STL parts (`stlRigLoader.ts`), not from the bench's recipes, so "Kip builds himself from the pile" needs a recipe for the default Kip. If neither fits tonight, N8 falls back to Kip assembling in the game with the existing drop-in of parts (a cut to be marked in the build notes). Any change under `public/kip/` needs a service-worker cache bump (`deploy-checklist.md` step 2).
2. **Song request:** the theme-song route takes `{ description, kind }`. Tonight the description is built in code from closed-list ids, plus the name only when the parent ticked it. The name goes through `kind: "prompt"`, the only kind that carries a child's own words and is screened.
3. **The toy's name** must stay empty or generic (see N8).
4. **`isPlayerId`** accepts only `[A-Za-z0-9-]{16,64}`; phase 3 ids must fit.

## 4. Phases and acceptance tests

| Phase | What | Acceptance test |
| --- | --- | --- |
| **P0 (tonight)** | The on-device onboarding N1 to N11 (3.1), the five slides (3.2), `?onboarding=1` and the Grown-ups "New player" entry, `toyventor:profile:v1` | Unit: the profile reader rejects bad shapes; the name validator accepts letters and refuses links, digits and over-length; the favourites lists are closed; the song description builder never includes the name when the box is off. Browser: from `?onboarding=1` a run to Play leaves one `toyventor:profile:v1` and **no** request to any route before N7's button; "No thanks" at N7 makes **zero** requests to `/api/theme-song`; skipping at N2 stores nothing; a fresh visit without the entry points sees the title menu unchanged; reduced motion shows no confetti; the slides contain no price, no button that buys and no input field. |
| **P1** | Grown-up accounts: `0004`, the emailed link, sessions, rate limits, sign-out, delete-my-account | A link works once and only for 15 minutes; a stale or reused link is refused; a fourth request an hour is limited; a session cookie is httpOnly and its hash only is stored; signing out ends the session; a test creates and deletes a family and finds no row left. |
| **P2** | Claim a device; sign in on a new device and see the toys | A claim makes no change to `ownership` rows; a second phone signed in to the same family lists the first phone's toys; un-claim deletes only the mapping. |
| **P3** | Child profiles with their own quota and XP | Two children on one family have separate weekly song counts and XP; the weekly quota of one child does not change the other's; a child id passes the id check. |
| **P4** | First-run default (if Dan wants it), whole-family deletion, the privacy notice, the changed entry text | A fresh device is offered the flow and can skip it; a deletion test covers **every** table keyed by a device or child id (it fails when a new one is added); the notice and the entry text match what is stored. |

## 5. Privacy and COPPA

Nothing here claims compliance. It records what each phase collects so a compliance owner can decide.

### 5.1 What is collected and what leaves the device

| Phase | Collected | Stored where | Leaves the device |
| --- | --- | --- | --- |
| Today | A device UUID; per-device settings, toys, time ledger, song counts | D1, keyed by the UUID | The UUID on every API call |
| **P0** | Parent's first name, the child's first name or nickname, three favourites, music picks, an under-13 flag, a consent timestamp | `localStorage` only | **Only at N7's "Make the song":** the favourites and music picks, and the **child's name only if the grown-up ticked the box**. They go to the text model and then to Mureka. |
| P1 | Adds a parent's email and a display name, consent records, sessions | D1, new tables | The email goes to the email provider to send a link |
| P2 | Adds the family to device mapping | D1 | |
| P3 | Adds children's first names, favourites and age bands against a family | D1 | A child's name only with the song consent |

### 5.2 Flags for the compliance owner

1. **A child's name reaches third parties in P0 if the box is ticked.** The text model that writes the lyrics is chosen by `worker/modelBackend.ts`, whose `DEFAULT_MODE` is `hosted` (Meta's hosted model); the production secret list has no `TEXT_BACKEND` or `MODEL_BACKEND`, so it is presumably Meta's (not confirmed). Meta's terms say end users must be 18 or older (`0008`). Then Mureka sings the name. That is why the box is **off by default**. With it off, nothing identifying leaves the device; the song says "you". Dan decides whether the name may ever go (open question 4).
2. **The grown-up check is not consent.** The check (a hold and a multiplication question) is an age screen. The FTC calls a math question alone "inadequate" (`coppa-readiness-spec.md`, FAQ D.7 and D.8). The N7 button is a design for a parent's choice, **not** verifiable parental consent.
3. **The age question can be answered falsely.** "Under 13" is a self-declaration; a child can tap No. The app is treated as child-directed in any case (`coppa-readiness-spec.md` section 0), so the under-13 path should be the default and 13 or over the exception, and no screen should offer the older path to a small child. Dan to decide the screen order (open question 11).
4. **P1 collects an adult's email.** That is a parent's contact information, collected for an account. Whether and how it may be used, and the verifiable-consent route for a child's data, are for a lawyer.
5. **Consent methods to decide before any child data is held on our servers** (named, not evaluated; the list is from my memory of the FTC's published methods, not read for this spec): a signed form returned by post or scan; a small card transaction; a video call; a government ID check; knowledge-based questions; "email plus" (an email, then a confirming step), which the FTC allows only when the data is not disclosed to third parties. Each has a cost and a friction.
6. **The entry text must change before P1 ships:** "It has no accounts, stores no wish text..." becomes false. It also has to say what the new flow collects. The notice that `coppa-readiness-spec.md` P2 plans has to describe this model (that is why D4 had to be settled first).
7. **P0 on a deployed build** stores personal information of a family on the device only. That is not "collection" by our servers, but the song request (5.1) is. Nothing in P0 is sent without the N7 tap.

## 6. Not done

Everything after P0 (sections 2.2 to 2.7, 4, 5); the email service; the lost-phone recovery path; the notice; the delete-family job; child profiles; the first-run default; any price, kit or subscription flow; translations of the onboarding (the game speaks seven languages in `propNames`; the onboarding is English only in P0); a check of how the pile ports to the game (3.4); the parental-consent method.

## 7. Open questions (Dan)

1. **Email sending:** is Cloudflare Email Sending available on this account, and is `toyventor.com` ready for SPF, DKIM and DMARC records? If not, which provider and who holds the key? Blocks P1.
2. **Email link or passkey first** (2.2)? My proposal is the link.
3. **Is the first-run flow the default for every fresh visitor, judges included, or opt-in only?** Tonight it is opt-in.
4. **May a child's name ever be sent to the text model and Mureka?** My proposal: only with a ticked box, off by default, and the song says "you" otherwise. The text model is presumably Meta's hosted one by default (5.2), whose terms are 18 and over.
5. **Quota per child or per family** (the 5 new songs a week): per child is fairer and needs P3; per family is simple. Today it is per device.
6. **Which of the five slides' claims may we say**, in Dan's words: the app's benefits for a parent; which "three tiers" (Starter, Tinker, Engineer or something else); what the weekly challenge is called and whether it is the weekend drop; what, if anything, we can say about STEM alignment (no standard is named in the repo); and the kit subscription (price, contents, cadence, region, provider). Tonight's slides carry only the repo's wording and no price.
7. **STEM alignment:** is there a named standard we are entitled to cite? The safe default is to name none.
8. **Monthly kits:** is it a product plan or an idea, and does it need a notice on the slide that no purchase is possible yet?
9. **Should the age answer set the existing `ageBand`** (the Learn-ladder difficulty), or stay a separate, privacy-only flag?
10. **Two phones on one family:** which phone's parent settings (time limits, PIN) win?
11. **Age 13 versus other countries:** the COPPA line is 13; other places set their own (GDPR Article 8 lets countries choose 13 to 16; the UK is 13). Which countries do we serve, and does the line move?
12. **Pile:** mount the Kip bench's pile in the game, or port it, or use the existing drop-in for tonight (3.4)?

## 8. Phase 0 as built (2026-11-04, evening): where it differs from sections 3 and 4

Code: `src/lib/newPlayer.ts` (pure: names, the closed lists, the steps, the profile, the song idea, the intro slides, the meet-Kip cards, the confetti; `tests/new-player.test.ts`), `src/features/game/world/OnboardingSheet.tsx` and `src/onboarding.css` (the screens), the world's `ONBS` (pile, build, headphones) reached through `EngineHandle.onbStage`, `holdParty` in `themeSongFlow.ts`, small hunks in `GameCanvas.tsx`, `TitleMenu.tsx`, `GrownUpsSheet.tsx` and one line of `index.css` (the title screen hides every stage overlay except its own; the sheet is now exempt). Checked in a real headless Chrome at 844 by 390 with `/api/theme-song` stubbed (nothing was spent), every step, the wrong answer and the bad name included; not tried on a phone and not with a real song.

| Section 3 says | What is built | Why |
| --- | --- | --- |
| Entry only from the Grown-ups sheet and `?onboarding=1`, so a judge sees the title menu as before | Those two, **and** a small link under the title menu's three entries, "New here? Set up a player with a grown-up". The three entries are unchanged (`TITLE_ENTRIES` is still Play, Build, Create). | Dan wants new users to find it. **It is visible to every visitor, judges included; hide it by deleting the `onNewPlayer` prop in `GameCanvas.tsx`.** |
| N2 uses the existing hold and PIN, and sets a PIN | One multiplication question (6 to 9 times 6 to 9), drawn fresh. No PIN is set or checked. | The Grown-ups sheet owns the PIN; reusing it from here needs a refactor. It is an age screen only, and the sheet says so ("a quick check, not a lock"). |
| N3 parent name is skippable, "Grown-up" by default | Required for under 13, optional for 13 and over (the same rules as the child's name: letters, up to 20). | Simpler, and an under-13 setup is meant to name the grown-up. |
| N4 child name is skippable, the song then says "you" | The name is required. | Simpler. |
| N6 pick the music (mood, instruments) | **Not built.** The song route chooses the music from the idea, as it does for the Map's Songs sheet. | Time; the route's request has no mood field today (not checked further). |
| N7 a checkbox "use the name in the song", off by default; "no" still makes a favourites-only song | Two buttons: "yes, make the song" (the grown-up's yes: the first name and the three favourites go into one request) and "no thanks, skip the song". **No means no song at all.** Under 13 the button reads "I'm the grown-up". | Simpler; a name-less song is a small follow-up (`songIdea` would drop the name). |
| N8 the real Kip workshop pile, then the Build screen | **A pile of Kip's real parts in the Toy Room** (the game's own Kip rig: every part mesh is cloned, sharing the real STL geometry and materials, and lies in a heap on the floor; the real Kip is hidden). About two seconds later **he builds himself, with no button**: each part is carried from the pile to its seat, lowest first, then the real Kip appears in the favourite colour, facing the screen. Then three tour cards (walk, props, jobs). The Build screen does not open after it. | The demo's own code (`pilePlan`, `pileFrame`) carries parts from recipes with poses from the Python validator and lives in `public/kip`; the game cannot use it without mounting the Workshop. The game's rig already has the same STL parts, so the pile is the same parts without the recipe. |
| N9 the song starts while N8 plays | The song is asked for **at the grown-up's yes on the song screen, before Kip is built**, so it is written and sung while he builds and the tour plays. The game's song flow runs with `holdParty`: it makes, measures and cuts the song and then waits (phase ready). **When the song is complete a pair of headphones appears beside Kip and a big "Pick up the headphones!" button; the player's tap carries them to his head and only then does the dance start** (`flow.again()`), with the usual dock and karaoke. The headphones go when the song is over. The song card stays out of the way until the dance starts. | The tap also unlocks audio. A song that cannot be cut to dance to shows its failure note and no headphones. |
| N10 five slides | **Six**: welcome, benefits, three tiers, the weekend challenge, STEM, make it real. Every line cites its file in `introSlides` (`source`). The "tiers" are Starter, Tinker, Engineer. There is no standards claim, no price, no "buy" and no sign-up field; the kits line says "coming soon". | Section 3.2's rules, plus a welcome slide for the name. |
| N11 profile written at the end | Written when the intro begins (everything needed is known then). Closing before that (only the Back button and the grown-up's way out of a later step; the first screen has no exit button, Dan 2026-11-04) stores nothing. | Nothing later depends on it yet. |

Not built tonight, all of it in sections 2, 4 and 5: any login, email, server storage of a name, claiming a device, per-child quota, "start over", the first-run default, and the privacy notice change (**the entry text "It has no accounts" is still what the app can truthfully say: nothing is stored on a server**; the one new disclosure is the first name and three favourites inside a song request after a grown-up's yes, which the compliance owner must look at, section 5.2).

## 9. Next: a kid version of the Kip bench for building their Kip (Dan, 2026-11-04, not built)

Dan: "a simple scene like /kip/Kip-Demo.html for the game, blueprints, different hair, a kid version of Kip-Demo.html to build their Kip", then the song and the dance, but only once the player picks up the headphones that appear when the song is complete. The headphones and the held dance are built (section 8). The kid bench is not, and it is bigger than the scene above:

- **What it needs.** The Kip bench (`parts/kip/viewer`, served from `public/kip`) has the real part pile (only inside Describe and Build, from a recipe), the blueprint (exploded) view, and the hair, head and hat choices (19 hair styles, 12 heads, 8 hats in the stack table). None of that is in the game's rig, which has a hair TONE and, as of 2026-11-04 evening, a default Kip that wears hair (another lane's commit). So a kid mode means either mounting the Workshop's Kip bench in a mode that shows only: pick a hair style and a shirt colour, watch the blueprint build with the real part pile, and a big Done button that hands the choices back; or teaching the game's rig the bench's hair parts.
- **Proposal.** Mount the existing Workshop overlay (`WorkshopLauncher.tsx`, no downloads) with a kid flag the bench reads: it hides every menu, plays the pile for a fixed kid recipe (a plain Kip with the chosen hair), and posts the chosen hair and colour back. Every change under `public/kip` needs the service-worker cache bumped (`docs/product/deploy-checklist.md` step 2) and the bench's byte-identical mirror (`parts/kip/viewer` and `public/kip`, `tests/*drift*`). A rough size: two days with the e2e, because the bench is the largest page in the app.
- **Open.** Which hair styles a child may choose from (all 19, or six), and whether the chosen hair must then show on the game's Kip (it only can if the game's rig learns the same parts).

## 10. The song: model and prompt (as built, for the compliance owner)

The onboarding asks `POST /api/theme-song` with `kind: "prompt"` and one sentence made only from the first name and three picks from closed lists: "a happy welcome song for NAME, who loves the colour COLOUR, FRUIT and ANIMALs, and has just built a Kip to play with" (`songIdea` in `src/lib/newPlayer.ts`). In the Worker (`worker/themeSong.ts`): the sentence is screened (`kidSafeText`, contact details scrubbed) and a text model is asked with `themePrompt(description, "prompt")`: a safety preamble, "A child asked for a song about an idea, and you will name the song and write it for a small child to sing along to", a JSON-only reply (name, mood and tempo and up to two instruments from closed lists, a four-line verse and a four-line chorus), rules (two to four word name, three to seven words a line, simple and joyful, no real people, places, brands or songs, nothing scary, sad or rude, the chorus must sing the name), and the sentence in quotes. The text model is Meta's hosted `muse-spark-1.3` by default (`DEFAULT_TEXT_MODEL` in `worker/modelBackend.ts`), or our own self-hosted model where `TEXT_BACKEND` selects it; decision 0008 says Meta's hosted terms are 18 and over, which is why this is a flag. The words and a style prompt built from the mood and instruments then go to Mureka (`mureka-9`, about $0.045 a song) for the sung audio. The route is metered per device and per month (`SONG_MONTHLY_BUDGET`, five new songs a week).


## 11. Accounts as built (2026-11-05): the server, the email service and the screens (OFF)

Dan chose **Cloudflare Email Sending** for the emailed link (2026-11-05). Everything below is built and verified in tests and a headless browser with stubbed routes, and **is off in production**: no `ACCOUNTS` variable is set, so every `/api/account/*` route answers 404 `{"error":"accounts are off"}` and the Account group in Grown-Ups draws nothing.

- **Server** (`worker/accounts.ts`, `shared/accounts.ts`, `migrations/0004_accounts.sql`, wired in `worker/index.ts` by one block before the final 404): sign-in by an emailed one-time link (15 minutes, once), no passwords, a session cookie (HttpOnly, Secure, SameSite=Lax; 30 days idle, 90 at most, rotated daily), a family of up to 6 children and 3 grown-ups, claim a device, delete the family. The address is never stored: its SHA-256 (optionally peppered) is the key. Limits: 3 links per address an hour, 10 per IP an hour, 5 new accounts per IP a day.
- **Email**: `wrangler.jsonc` has a `send_email` binding named `SEND_EMAIL`; `EMAIL_BACKEND=binding` and `EMAIL_FROM` (an address on the onboarded domain) select it. The call follows Cloudflare's Workers API page (`send({to, from, subject, text})` resolves `{messageId}`, rejects with a `code`); on a failure only the code is logged. The Resend sender stays as a spare. **Not run against the real service.** Cloudflare's constraints (read 2026-11-05): Email Sending is a beta; sending to ANY address needs the Workers Paid plan; until a sending domain is onboarded it can only send to verified addresses in the account (enough for a demo to the team); the daily quota starts low and grows with sending behaviour.
- **Screens** (`src/features/game/world/AccountPanel.tsx`, `src/lib/accountsClient.ts`, `src/accounts.css`): an Account group in Grown-Ups (email and "I'm the grown-up" / "I'm 13 or older", then the family, add the saved player, use this device, sign out, a two-tap delete), and a card for the page opened from the link (`?signin=...`, token removed from the address at once, one verify call per token).
- **To switch it on** (Dan's steps): (1) `npx wrangler email sending enable toyventor.com` (or the dashboard) and the Workers Paid plan; (2) `npx wrangler d1 migrations apply toyventor --remote` is optional, the Worker creates the tables itself the first time; (3) set the variables `ACCOUNTS=on`, `EMAIL_BACKEND=binding`, `EMAIL_FROM=hello@toyventor.com` (and optionally the secret `ACCOUNTS_PEPPER`); (4) deploy; (5) sign in once with a real address and read the email. The privacy notice must change at the same time (section 5): until then "it has no accounts" is the true sentence.
- **Not built**: the link between an account's child and the local profile beyond "add" and "claim" (a signed-in device does not load its family's players yet), per-child quotas, parent controls tied to the account, email change, the privacy notice, a "sign in" entry for a 13-and-over player outside Grown-Ups.
