// Builds docs/product/spec-for-review.md from the canonical spec.
//
// The spec artifact and the review copy must never drift apart, so the
// review copy is generated, not hand-edited. Relative links are turned
// into plain file names because the copy is read outside the repo, in a
// document viewer that cannot resolve repo paths.
//
// Run: npm run spec:review
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const spec = readFileSync(join(root, "docs/product/spec.md"), "utf8");

const headerFor = (date: string) =>
  `> Review copy, generated ${date} from \`docs/product/spec.md\`. Do not
> edit this file by hand: run \`npm run spec:review\` after changing the spec.
> The block below is for reviewers. Delete it before publishing.

## What changed since the Oct 27 spec

| Section | Change | Why |
| --- | --- | --- |
| Whole spec, Oct 29 review pass | Demo table, model table, contract, Create mode, Pro, STEM, and Forge Club claims corrected to match the code as built. Dates updated. | A code review against the running app found rows that overstated what is live (Mureka, voice model, pin and gear set, gear ratio challenge, KV). |
| Roadmap | Added the React port decision for ToyVentor World: wrap the engine behind a typed facade, do not rewrite it, three.js upgrade last. All five steps are in locally, ending with three.js 0.160 ES modules and a 12-level screenshot comparison; the standalone page remains the demo path. | The port had been reviewed separately. The decision belongs in the spec, recorded with its actual progress. |
| ToyVentor World | New section. The app and the 2.5D world are now one toy: the Play button opens the world already wearing the kid's build, through the \`toyventor.toy/1\` contract in the page URL. | The hand-off between app and game was undefined. It is now a documented contract with a stated mapping rule and a stated failure behaviour. |
| Create mode | New section. The model route, the kid-facing rules it holds, and the recipe check. | Create mode now runs on Meta Muse Spark through the Worker's \`/api/muse/spark\` route, with the game's word parser as the fallback. The spec should say so. |
| Where we use Meta models | Added the Create mode row. | The model list was missing the one place a model writes game content. |
| Demo (90 seconds) | Now points at the full run in demo-script.md, and the beat list covers opening the world with the kid's build. | The old beat list did not include the world or Create mode. |
| ToyVentor Pro | "on ToyVentor's own 12.5 mm hole grid". The example part is renamed from SU05 to TU05 everywhere it appears, including the part id, the source file and the download files. | The part naming now matches the canonical interface standard, which uses TU. |
| Opening line | "brick-building fanatic" instead of naming a construction toy brand. | Public copy carries no third-party brand names. |
| Vision, snap and Pro cross-references | Kept as file names rather than links. | This copy is read outside the repo. |
| Nov 1 sync & stretch goals | Synced shipped five-set bridge (\`modular-craft\`, \`mech-robotics\`), live STL hero rigs, connected 6-district Town Slice 1, STEM XP + Maker Ranks 1-6 + Daily Quests + Real-Life Routines, and Kip \`Describe & Build\` + \`.3mf\` Plate Print; added dedicated \`Stretch goals\` section for Town Phases B-E and \`SAM 3.1\` + \`Muse\` physical-to-digital loops. | Aligns canonical spec with shipped code while keeping post-freeze generative and Town items clearly separated as stretch goals. |

## How to review

Five things are worth your attention, in this order.

1. **The demo claims are honest.** The "What is real in the demo" table says which
   features are live and which are pre-made or mocked. Check it against what the
   demo actually runs. If a row overstates, that row is the finding. This revision
   already corrected several rows after a code review; check the corrections too.
2. **The toy contract is the load-bearing new piece.** It claims the world comes
   up wearing the kid's build, that a bad contract cannot break the game, and that
   the two part libraries stay separate. Verify in the app: build a toy, press
   Play, and check the title screen shows the toy and the parts land as the
   mapping rule predicts. Sharing the link also unlocks those parts on the
   receiving device; that is now documented. Say so if it reads as a surprise.
3. **The kid-facing rules in Create mode.** The spec now says which rules the
   route's filter enforces and which are prompts to the model only (brands,
   names), and splits the recipe check between the route and the game. Check both
   halves, not the claim. The route also has no rate limit yet; the spec says so.
4. **The React port is complete locally, including three.js 0.160.** The
   Roadmap records a wrap-don't-rewrite decision for moving ToyVentor World into
   React. The facade, canvas host, HUD, Factory/customizer, mission panels,
   Create mode, and level editor exist locally in the Play tab, and the engine
   page now loads three 0.160 ES modules. Nothing in the demo depends on the
   React host. If any section reads as if the upgraded page were published,
   that is a finding: publishing is still the manual republish in Open questions.
5. **The open questions are still open.** The section at the end lists what the
   spec asserts but has not earned. If something in that list has since been
   answered, it should be updated rather than left as a question.

Two things are deliberately not in this spec: the toy contract format table, which
lives with the code that implements it, and the interface standard, which lives
in the PartSpec lane and is canonical there.

---
`;

// A relative markdown link becomes a plain file name. Absolute links and
// anchors stay as they are.
function flattenLinks(body: string): string {
  return body.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (whole, label: string, target: string) => {
    if (/^[a-z]+:\/\//i.test(target) || target.startsWith("#")) return whole;
    if (target.includes(" ")) return whole;
    const file = target.split("#")[0];
    if (!file) return whole;
    return file === label ? label : `${label} (${file})`;
  });
}

// The spec keeps its own title. The review note goes under it, clearly
// marked, so publishing is a delete of one block. Exported so the deploy
// preflight can rebuild the copy with a pinned date instead of duplicating
// the transformation.
export function buildReviewCopy(specText: string, date: string): string {
  const titleMatch = specText.match(/^# .+$/m);
  const title = titleMatch ? titleMatch[0] : "# ToyVentor: Spec (toyventor.com)";
  const body = flattenLinks(specText).replace(/^# .+\n/, "");
  return `${title}\n\n${headerFor(date)}\n${body.trimStart()}`;
}

if (process.argv[1]?.endsWith("export-spec.ts")) {
  const out = buildReviewCopy(spec, new Date().toISOString().slice(0, 10));
  writeFileSync(join(root, "docs/product/spec-for-review.md"), out);

  const emDashes = (out.match(/\u2014/g) ?? []).length;
  console.log(`spec-for-review.md written (${out.length} bytes, em dashes: ${emDashes})`);
}
