import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildMapCards, CARD_SHOT_IDS, cardShotUrl } from "../src/lib/mapCards";
import { emptyProgression } from "../src/lib/progression";

const file = (id: string) => resolve(__dirname, `../public/map/cards/${id}.jpg`);

describe("Map card screenshots", () => {
  it("every id on the list has a picture, and it is small enough to load at once", () => {
    for (const id of CARD_SHOT_IDS) {
      expect(existsSync(file(id)), `${id}.jpg`).toBe(true);
      expect(statSync(file(id)).size, `${id}.jpg is under 60 KB`).toBeLessThan(60_000);
    }
  });

  it("every card a child can be shown has a picture, except the grown-up card and the Garage", () => {
    for (const ageBand of [null, 0, 1, 2, 3, 4, 5]) {
      const cards = buildMapCards({
        ageBand,
        prog: { ...emptyProgression(), sandboxUnlockAll: true },
        found: new Set(),
        missionsDone: new Set(),
        garage: { weekend: true, done: false },
      });
      for (const c of cards) {
        if (c.kind === "ask" || c.kind === "garage") expect(cardShotUrl(c.id), c.id).toBeNull();
        else expect(cardShotUrl(c.id), `${c.id} at band ${ageBand}`).toBe(`/map/cards/${c.id}.jpg`);
      }
    }
  });
});
