# Mureka API reference (read 2026-11-03)

**What this is.** The full API surface of the Mureka music API, read from
`https://platform.mureka.ai/docs/` on 2026-11-03. The reference pages are a
`vitepress-openapi` build of one **OpenAPI 3.0.0** document embedded in the
site's theme bundle (29 paths, 59 schemas); the field names, types, enums and
defaults below are that document, not inference. Guide pages (quickstart, error
codes, changelog, FAQ) were read alongside it, in English and Chinese.

**Why it is here.** `docs/specs/dance-party-spec.md` §4 (the "song maker")
names Mureka and lists what was still unknown: the price per song, the rate
limits, the turnaround, and the licence. Section 8 below says which of those
the API answers and which it does not.

**Base URL** `https://api.mureka.ai` — the only host in the OpenAPI `servers`.
The Chinese quickstart uses `https://api.mureka.cn`; no EU or other regional
host appears anywhere in the docs or the spec.

**Auth** `Authorization: Bearer $MUREKA_API_KEY`, on every request.
`Content-Type: application/json`, except the three multipart endpoints
(`/v1/files/upload`, `/v1/song/vocal-clone`, `/v1/uploads/add`).

**Errors** HTTP ≥ 400, body `{"error":{"message":"..."},"trace_id":"..."}`.
The `trace_id` is the handle to quote to support (`api-support@mureka.ai`).

## 1. The flow the song maker needs

1. `POST /v1/song/generate` (or `/v1/song/easy-generate`) → a task object with
   `id`, `status: "preparing"`.
2. `GET /v1/song/query/{task_id}` → the same task object until it is
   `succeeded`, then `choices[]` holds the audio.
3. Download the audio from `choices[].url` (or `flac_url` / `wav_url`) and
   store it. **Those URLs are valid for 30 days**, so the Worker must copy the
   bytes, not the link.

`stream: true` adds a `streaming` phase: `choices[].stream_url` is playable
while the song is still being made (changelog 2025.7.29; 2025.10.27 extends
its validity by 5 minutes after generation completes).

## 2. Task lifecycle

| Status set | Where |
| --- | --- |
| `preparing` `queued` `running` `streaming` `succeeded` `failed` `timeouted` `cancelled` | song, instrumental, track, remix, region-edit, soundtrack |
| `queued` `running` `succeeded` `failed` `cancelled` `expired` | video (no `preparing`, no `streaming`; `expired` instead of `timeouted`) |
| `preparing` `queued` `running` `succeeded` `failed` `timeouted` `cancelled` | fine-tuning (no `streaming`) |
| `pending` `completed` `cancelled` | uploads |

`SongTask` fields: `id`, `created_at`, `finished_at`, `model`, `status`,
`failed_reason`, `choices[]`. `choices[]` item: `index`, `id`, `url`,
`flac_url`, `wav_url`, `stream_url` (only with `stream`), `duration` (**ms**),
and for songs `lyrics_sections[]` (`section_type` = `intro` `verse`
`pre-chorus` `chorus` `bridge` `break` `outro`, `start`/`end` in ms, `lines[]`
with `words[]` and per-word timings).

The quickstart's sample response also carries `trace_id`, which the OpenAPI
`SongTask` schema does **not** declare. Treat it as present-but-undeclared.

## 3. Endpoints

### Song

**`POST /v1/song/generate`** — lyrics to song. Requires `lyrics`, `model`.

| Field | Type | Req | Default / limits |
| --- | --- | --- | --- |
| `lyrics` | string | ✔ | ≤ 5000 chars |
| `model` | string | ✔ | `auto` `mureka-7.6` `mureka-o2` `mureka-8` `mureka-9` `mureka-9.5` |
| `n` | int32 | | default **2**, max **3**; **charged per song** |
| `prompt` | string | | ≤ 1024 chars |
| `gender` | string | | `female` `male` |
| `duration` | int32 | | **seconds**, 120–300; **only `mureka-9.5`** |
| `reference_id` | string | | a `files/upload` id with purpose `reference` |
| `vocal_id` | string | | from `/v1/song/vocal-clone` |
| `melody_id` | string | | a `files/upload` id with purpose `melody`; **exclusive** — combines with nothing |
| `stream` | boolean | | adds the `streaming` phase |

`mureka-o2` supports neither `vocal_id` nor `melody_id`. `reference_id`,
`vocal_id` and `prompt` combine with each other (changelog 2025.4.18).

```shell
curl https://api.mureka.ai/v1/song/generate \
  -H "Authorization: Bearer $MUREKA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "lyrics": "[Verse]\nIn the stormy night, I wander alone\nLost in the rain, feeling like I have been thrown",
    "model": "mureka-9.5",
    "prompt": "r&b, slow, passionate, male vocal",
    "duration": 180
  }'
```

**`POST /v1/song/easy-generate`** — prompt to song, no required field. Adds
`styles[]` (`pop` `rock` `jazz` `r&b` `edm` `ambient` `folk` `latin` `k-pop`
`j-pop` `house` `gospel` `lo-fi`) and `prompt` ≤ 2000 chars.

**`POST /v1/soundtrack/generate`** — no required field. `image_id` **or**
`video_id` (mutually exclusive), `audio_start`/`audio_end` in ms (segment ≥ 3 s,
1 s fades), `n` default 2 max 3.

**`GET /v1/song/query/{task_id}`** — the task (§2).

**`POST /v1/song/vocal-clone`** — multipart. `file` **required** (mp3/m4a,
< 10 MB, vocal **15–30 s**, excess trimmed), `description` ≤ 1024 chars.
Synchronous. Returns `vocal_id`, `description`, `created_at`.

**`POST /v1/song/extend`** — requires `lyrics` (≤ 3000) and `extend_at` (ms;
8000–420000 for `mureka-7.6`). `extend_type` = `tail` `head` (**required for
`mureka-8`**; ignored for `mureka-7.6`). `song_id` (songs from the last
month) **or** `upload_audio_id` (purpose `audio`), mutually exclusive.

**`POST /v1/song/recognize`** — `upload_audio_id` required. Synchronous.
Returns `duration` (ms) and `lyrics_sections[]`.

**`POST /v1/song/describe`** — `url` required (mp3/m4a; a base64 data URL is
accepted, ≤ 10 MB). Returns `instrument[]`, `genres[]`, `tags[]`,
`description`.

**`POST /v1/song/transcribe`** — one of `song_id` / `upload_audio_id` / `url`
(url: mp3, wav, m4a, 10 s–10 min, ≤ 100 MB), plus `title` ≤ 50 chars.
Returns `zip_url` (a ZIP of `.musicxml`, `.pdf` and timestamped lyrics JSON)
and `expires_at`.

**`POST /v1/song/stem`** — `url` required (base64 data URL allowed ≤ 10 MB).
`model` = `audio-separation-1` (5 stems, wav only), `audio-separation-2`
(12 stems, wav + MIDI), `audio-separation-3` (vocals and accompaniment, wav +
MIDI). Returns `zip_url`, `expires_at`, `midi_zip_url`.

**`POST /v1/track/generate`** — requires `generate_type` (`Vocals`
`Instrumental` `Drums` `Bass` `Guitar` `Keyboard` `Percussion` `Strings`
`Synth` `FX` `Brass` `Woodwinds`) and `prompt` (≤ 1024). Optional `lyrics`
(≤ 5000), `vocal_gender`, `generate_start`/`generate_end` (ms), and one of
`song_id` / `upload_audio_id`.

**`POST /v1/song/region-edit`** — requires `lyrics` (≤ 3000). `edit_start`/
`edit_end` (ms), the rewritten region ≥ 3 s. One of `song_id` /
`upload_audio_id`.

**`POST /v1/song/remix`** — requires `prompt` (≤ 1024). `model` = `mureka-8`
(audio 10–350 s) or `mureka-9.5` (10–480 s, and the vocal-only /
accompaniment-only / instrumental kinds are supported only on 9.5). `n`
default 2 max 3. With `mureka-9.5` the prompt also sets the vocal gender.
One of `song_id` / `upload_audio_id` (purpose `remix`).

### Instrumental

**`POST /v1/instrumental/generate`** — requires `model` (`auto` `mureka-7.6`
`mureka-8` `mureka-9` `mureka-9.5`). `n` default 2 max 3, `prompt` ≤ 1024,
`instrumental_id` (purpose `instrumental`), `stream`. `prompt` and
`instrumental_id` each combine with nothing else.

**`GET /v1/instrumental/query/{task_id}`** — same task shape, `choices[]`
without `lyrics_sections`.

### Lyrics

**`POST /v1/lyrics/generate`** — `prompt` required. Synchronous. Returns
`title`, `lyrics`.
**`POST /v1/lyrics/extend`** — `lyrics` required. Synchronous. Returns
`lyrics`.

### Files

**`POST /v1/files/upload`** — multipart. `purpose` **required**: `reference`,
`melody`, `instrumental`, `voice`, `audio`, `remix`, `soundtrack`,
`lyrics-video`. `file` **or** `url`, mutually exclusive. Returns `id`,
`bytes`, `created_at`, `filename`, `purpose`.

| Purpose | Format | Duration window | Size |
| --- | --- | --- | --- |
| `reference` | mp3, m4a | exactly 30 s (excess trimmed) | — |
| `instrumental` | mp3, m4a | exactly 30 s | — |
| `melody` | mp3, m4a, **mid** | 5–60 s (MIDI recommended) | — |
| `voice` | mp3, m4a | 5–15 s | — |
| `audio` | mp3, m4a | general (song extension) | ≤ 10 MB |
| `remix` | mp3, m4a | 10–350 s (`mureka-8`), 10–480 s (`mureka-9.5`) | — |
| `soundtrack` | video `.mp4 .mov .avi .mkv .webm`; image `.jpg .jpeg .png .webp` | — | video ≤ 100 MB, image ≤ 50 MB |
| `lyrics-video` | `.jpg .jpeg .png .webp .gif` | — | — |

### Music video

**`POST /v1/video/generate`** — no required field. Music chain (`song_id` /
`upload_audio_id` / `url`) or video chain (`content[]`). `model` default
`doubao-seedance-2-5-260628`, also `doubao-seedance-2-0-260128`,
`doubao-seedance-2-0-fast-260128`, `doubao-seedance-2-0-mini-260615`.
`ratio` default `adaptive` (also `16:9` `4:3` `1:1` `3:4` `9:16` `21:9`),
`resolution` `480p` `720p` `1080p` `4k`, `output_format` `mp4` `mov`,
`generate_audio` default true (all generated audio is mono), `priority` 0–9,
`execution_expires_after` default 172800 s (3600–259200), `duration`,
`show_lyrics_subtitle`, `lip_sync`, `character[]`, `background`, `prompt`,
`tools[]` (`web_search`), `watermark`.

**`GET /v1/video/query/{task_id}`** — returns `content.video_url` and
`content.last_frame_url`, `usage{completion_tokens,total_tokens,
tool_usage{web_search}}`, `error{code,message}`, `framespersecond` (spelled
as the schema spells it), `draft_task_id`, `updated_at`.

**`POST /v1/lyrics-video/generate`** — synchronous, no required field.
`aspect_ratio` default `9:16` (also `16:9` `3:4` `4:3`), `layout`
`layout_1`…`layout_7` default `layout_1`, `cover`, `title`,
`show_author_name`, a background (`background_id` or `cover`), and either
`lyrics_start_row`/`lyrics_end_row` (rows from 1, paired) or
`selection_start`/`selection_end` (ms, paired) — the two cannot be combined.
Returns `url`, valid 30 days.

### Uploads (fine-tuning only)

`POST /v1/uploads/create` — `upload_name` and `purpose` (`fine-tuning`, the
only value) required. `POST /v1/uploads/add` — multipart, `upload_id` and
`file` required (≤ 10 MB per part; mp3/m4a, 30–270 s). `POST /v1/uploads/complete`
— `upload_id` required, optional ordered `part_ids[]`.

### Fine-tuning

`POST /v1/finetuning/create` — `upload_id` (a completed upload) and `suffix`
(≤ 32 chars, lowercase letters/numbers/hyphens) required. The docs ask for
**100–200 songs in one consistent style, 2–4 minutes each**; training time
scales with the total audio (200 songs × 4 min ≈ 3 hours). Returns
`fine_tuned_model` when it succeeds, e.g. `lora:mureka-6:4354198:my-model`.

`GET /v1/finetuning/query/{task_id}` — the task.

### Text to speech

`POST /v1/tts/generate` — `text` required (≤ 500 chars), `voice` one of
`Ethan` `Victoria` `Jake` `Luna` `Emma`, or `voice_id` from a `voice` upload
(mutually exclusive). Returns `url` and `expires_at`.
`POST /v1/tts/podcast` — `conversations[]` required (≤ 10), each with `text`
(≤ 400 chars) and `voice`.

### Account

`GET /v1/account/billing` — no parameters. Returns `account_id`, `balance`,
`total_recharge`, `total_spending` (**all in cents**) and
**`concurrent_request_limit`** — the account's own concurrent-song limit,
queryable at runtime.

## 4. Error codes

| Code | Meaning |
| --- | --- |
| 400 | Invalid request — bad parameters |
| 401 | Invalid authentication — wrong key |
| 403 | Accessing from an unsupported region |
| 429 | Rate limit reached for requests |
| 429 | Quota exceeded — check billing details |
| 451 | Unavailable for legal reasons — the parameters failed content review (**in the Chinese page only**) |
| 500 | Server error while processing the request |
| 503 | The engine is overloaded — try again later |

## 5. Limits, money and rights (what the FAQ says)

- **Prepaid**, one top-up, consumed gradually. Balance is valid **12 months
  from the last recharge**; each new recharge extends validity for all of it.
- Credits are spent **FIFO**, paid before bonus.
- **No refunds.** Website membership is **not** linked to the API platform:
  separate billing and credits.
- **Commercial authorization: yes.** Content generated through paid API calls
  carries full usage rights and commercial authorization (commercial products,
  platform distribution, ads, video).
- **Concurrent requests** = song-generation tasks running at once, counted
  from request to completion. The limit grows with the top-up tier; the
  account's number is `concurrent_request_limit`.
- **Multilingual vocals**: 10 languages — Chinese, English, Japanese, Korean,
  Portuguese, Spanish, German, Italian, French, Russian (changelog 2026.1.5).
- **Downloading is free; the multitrack (stems) feature is paid separately.**
- **A watermark is appended to every API-generated music file.** The Chinese
  FAQ states an audio watermark marker is added to the end of all generated
  music for traceability, and the changelog (2025.10.30) records **5 s of
  watermark audio** on generated songs.
- **No published turnaround time.** The FAQ gives no number.
- **No published numeric rate limit**; only "the concurrent request limit in
  the pricing plans".
- Support: `api-support@mureka.ai`, answered within 24 hours.

## 6. Changelog, newest first

| Date | Change |
| --- | --- |
| 2026.10.29 | Lyrics to song supports `duration` |
| 2026.8.28 | Enhanced `mureka-9.5` |
| 2026.8.14 | New API: video generation |
| 2026.7.9 | New API: music transcription; soundtrack gains `audio_start`/`audio_end`; enhanced lyrics model |
| 2026.6.25 | Stems gain a vocal+instrumental separation model; lyrics video gains aspect ratios and layouts; lyrics to song gains `gender` |
| 2026.6.15 | New API: prompt to song; **the `vocal` parameter is removed from file upload** (breaking) |
| 2026.5.22 | New APIs: lyrics video, remix |
| 2026.5.11 | New API: image/video soundtrack |
| 2026.4.9 | Enhanced `mureka-9` |
| 2026.4.8 | Single-track generation from a reference audio (`vocals`/`accompaniment`/`instrument`) |
| 2026.3.2 | Enhanced `mureka-8` |
| 2026.2.5 | Instrumental generation; `mureka-7.6` added to the model field |
| 2026.1.5 | Vocal-generated music; `vocal_id` and `prompt` together; 10 languages |
| 2025.12.9 | `wav_url` added; `mureka-7.6` and `mureka-o2` released |
| 2025.10.30 | **CN only: 5 s of watermark audio appended to generated songs** |
| 2025.10.27 | Stream URL validity extends by 5 min after generation completes |
| 2025.9.25 | New API: song describe; `mureka-7.5` replaces `mureka-7` |
| 2025.9.1 | `n` controls how many songs a call returns |
| 2025.7.29 | Streaming mode; new APIs: song recognize, song extend; `mureka-7` and `mureka-o1` released |
| 2025.6.10 | **Breaking: the lyrics structure's `breakdown` is renamed `break`** |
| 2025.6.4 | m4a uploads; the `melody` purpose takes MIDI |
| 2025.6.3 | Enhanced `mureka-6` |
| 2025.4.18 | `reference_id` and `vocal_id` can be used together |

## 7. What is *not* published

- No numeric rate limit, no per-plan concurrency table, no per-model price.
- No supported-region list (only the 403 message implies one exists).
- No absolute expiry for `stream_url` (only "+5 minutes after completion").
- `duration` on `/v1/song/generate` (120–300 s), `n` (default 2, max 3) and
  the character limits are prose only, not schema `minimum`/`maximum`.
- `mureka-o1` and `mureka-7.5` are named on the introduction page and in the
  `stream` field, but neither is in any current request `model` enum.
- `SongExtendV2Req` exists in the spec but no path uses it.

## 8. What this settles for `dance-party-spec.md` §4

| Open question in the spec | The API's answer |
| --- | --- |
| "one generation at a time is the safe assumption" (§4.1) | The account's real limit is **queryable**: `GET /v1/account/billing` → `concurrent_request_limit`. |
| "if a call is billed once however many songs it returns" | **Charged per song.** `n` is "how many songs to generate; charged per song" (default 2, max 3). A call with `n=3` bills three songs. |
| "a wrapper also reports a 429 if calls come closer than 3 seconds" | The docs publish **no** numeric rate limit. 429 carries **two** distinct messages: "rate limit reached for requests" and "you exceeded your current quota". The documented lever is the concurrency limit, not a spacing rule. |
| "plan for 5 minutes" (turnaround) | The docs publish **no** turnaround. Generation is async with a `streaming` phase, so `stream: true` gives a playable `stream_url` while it is still making the song. |
| "Mureka has no tempo control" (D9) | **Confirmed** — there is no tempo or key parameter on any endpoint. |
| "Licence allows a children's app and stored songs: yes" (D9) | **Confirmed by their FAQ**: paid API output carries full commercial authorization. Storing songs is fine. |
| Not in the spec | **Every generated song carries a 5 s audio watermark** (CN FAQ + changelog 2025.10.30). Worth raising with Mureka before a children's app ships songs. |
| Not in the spec | Song length is **not** controllable except on `mureka-9.5`, and only between 120 and 300 s. |
| Not in the spec | The 30-day life of the download URLs means the Worker must **store the audio**, not link to it. |
| Not in the spec | 429 on **quota exhaustion** is a billing state, not a throttle: the party's per-user weekly quota should be checked before the call, not retried. |

## 9. Sources

- `https://platform.mureka.ai/docs/` and `/docs/en/{quickstart,error-codes,changelog,faq,ai-music-o1-moment}.html`
- `https://platform.mureka.ai/docs/cn/{quickstart,error-codes,changelog,faq}.html`
- All 29 operation pages under `https://platform.mureka.ai/docs/api/operations/`
- The OpenAPI 3.0.0 document (`info.title` "Mureka API", version "1.0")
  embedded in `https://platform.mureka.ai/docs/assets/chunks/theme.M7F0Joug.js`

**Not read:** `en_incident-report_20250801.html`, `cn_incident-report_20250801.html`
and `open_video_api.md` are in the site's build manifest but 404 at every URL
tried.
