# ToyForge — Wireframe (12 pages, rough)

Mobile PWA. Bottom bar: Factory, Toybox, Packs, Market, Play.

1. Factory Home: station map, 8 dots, resume card, daily nudge. CTA: Continue.
2. Toybox: toys + printed parts + donors. Filter chips. Cards show mount + size. CTA: Scan new.
3. Scan: camera, auto mount detect, size slider, save. Push-to-talk:
   "Hold and say what this is" ("toy car") → SAM text prompt. CTA: Save. Next: Augment.
4. Augment: 3D preview, parts tray, AR toggle. Push-to-talk: "Describe the look"
   ("red racer with yellow lightning") → Muse Image skin prompt. CTA: Preview in AR.
5. Pack Rip: pack art, tap to rip, 3-item reveal. CTA: Equip / Print.
6. Merge Forge: 2-3 donor slots, 3 options, adapter note. CTA: Forge. Next: Reveal.
7. Market Browse: search with mic ("big wheels that fit my car" → search query),
   My Toys fit filter, cards with fit + print time. CTA: Open detail.
8. Part Detail: AR preview, fit list, stat, unlock state. CTA: Unlock / Print / Equip.
9. Print: STL preview, mount check, profile, fail tips. CTA: Export STL.
10. Color: AR color preview, mask export, pen mode. CTA: Save look.
11. Play: AR stage, companion stats, song replay. Push-to-talk: "Hold to tell the story"
    ("danger", "attack", "start adventure", "play my theme") → mood, boost, music.
    CTA: Play in AR / Open game.
12. Reveal: entrance minimo clip, theme song, character card, share. Push-to-talk:
    "Name your character" ("Bobo the Brave Bear"). CTA: Save + Replay.

## Push-to-talk (Muse Voice Transcribe)
- One hold-to-record mic button per screen above. Records only while held; release submits.
- Show the transcript briefly before acting. Parent can redo or type instead.
- Never always-on. Parent starts and stops every listening session.
- The model returns text only; the app maps it to a SAM prompt, a skin prompt,
  a search query, a character name, or a small Live Play command vocabulary.

## Animation contract
Tagged minimo clips only. Fields: id, rig, duration, loop or once, trigger. Rigs: car, figure, build.
Triggers: finish, equip, win, idle. Same tag in AR + game.

## Notes
- True-scale AR preview everywhere before print.
- Fit promise from mount class + size class only.
- Hero set: car + figure, 24 parts, 6 merges, 3-day packs.
