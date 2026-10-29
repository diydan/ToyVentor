# ToyVentor: 90-second demo script

The run for the hackathon submission. One take, phone screen mirrored to a
laptop, every beat has a backup clip. The story is one kid's toy in five
minutes of play, compressed into a minute and a half.

Rules for the recording: no em dashes anywhere, no third-party brand or
trademark names on screen, the in-game model is Meta Muse, and no child
faces or names on camera. Use a grown-up hand or a toy stand-in.

## The run

| Time | Beat | On screen | Say |
| --- | --- | --- | --- |
| 0:00 | Open | Toybox, "Your uploads" and the built-in toys. Tap **Scan new**. | "This is a toy my kid already owns." |
| 0:08 | Scan | Point the camera at the toy on a table. The SAM 3.1 outline traces the toy, the size slider fills in. | "Meta SAM 3.1 finds the toy in the photo." |
| 0:16 | Build | Tap **Augment**. Drag a spoiler and a wing onto the board. The four checks turn green one by one. | "Parts snap to the board. Every part is checked before it is offered." |
| 0:26 | Print ready | Show the checks panel, then the 3D preview of the part on the toy in AR at true scale. | "It fits the toy, and it prints without supports." |
| 0:34 | Play | Tap **Play**. ToyVentor World opens with the kid's build already on the toy, "Your toy: Red racer" on the title screen. Tap Play, walk right in the Garden, a hidden part pops. | "The build comes with the kid straight into the world." |
| 0:44 | Bridge mission | The Garden bridge mission appears. Forge a beam and a triangle brace, fit them into the deck and support slots, tap **Test it**. The toy walks across. | "The mission is a real thing to solve: bridge the river." |
| 0:54 | Create mode | Back to the title, tap **Create a world**. Type "a snowy world with three snowmen and a cave to hide a part", tap **Make it**. The world appears. | "Meta Muse reads the idea and writes the world." |
| 1:04 | Print order | Back in the app, tap **Print**. The print list shows the queued parts and the checks. | "The same parts are queued to print at home." |
| 1:12 | Reveal | Tap **Reveal**. The entrance animation plays, the theme song starts, the character card slides in with the stats and the part names. | "One toy, one build, one toy that exists in the world and on the table." |
| 1:26 | End card | ToyVentor wordmark, the one line promise, the site address. | "ToyVentor. Build it, play it, make it real." |

## Shot list for the backup

Record these as separate clips, same order, before the live run. If the
live run breaks, cut the clips together. Keep each clip under 20 seconds.

1. `01-scan` : camera on the toy, outline tracing, size filled.
2. `02-build` : board with two parts placed, checks green.
3. `03-play` : ToyVentor World title screen with the kid's toy name, then
   the Garden with the part found.
4. `04-bridge` : bridge built, mission complete card.
5. `05-create` : the sentence typed, the world appearing, the word panel
   visible.
6. `06-reveal` : entrance clip, character card with stats.

## Backups, in the order they save the run

1. **Scan fails or is slow**: use the preloaded toy from the Toybox. The
   whole scan beat becomes "tap the backed-up toy".
2. **ToyVentor World does not open**: open the hosted game page directly
   and continue from the Garden. The toy contract beat is then covered by
   clip 3.
3. **Create mode does not answer**: the game falls back to its own word
   parser and still builds the world. Say "the model wrote this one" only
   if the live route answered; otherwise use clip 5.
4. **Print list stalls**: the export runs locally, so cut to clip 6.
5. **Reveal animation stutters**: the song is pre-generated, so let the
   card land and hold for two seconds before the end card.

## Check before recording

- The toy for the scan sits on a plain table, lit from the front.
- The phone is on Do Not Disturb and the screen brightness is up.
- The app is already open on the Toybox, signed in state loaded.
- ToyVentor World is warm in a second tab (so the first open is not cold).
- The print list is empty and the account has no pending order.
- 4G or 5G, not wifi, if the submission room wifi is slow.

## Where this lives

- The app flow (scan, build, print, Reveal) is the React app on
  toyventor.com.
- ToyVentor World is the 2.5D game, built from `game/engine25.js` by
  `game/build25.py` and served at `/world/ToyVentor-World.html`.
- Create mode calls the Worker route `/api/muse/spark`, which runs the
  model on Meta Muse Spark.
