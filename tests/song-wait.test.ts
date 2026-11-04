import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BAR_CAP, WAIT_STAGES, waitProgress, waitStage } from "../src/features/game/world/songWait";

describe("the waiting display's words", () => {
  it("starts at the first line, moves on at each stage and stays on the last one until the song is ready", () => {
    expect(waitStage(0)).toBe("Thinking of the tune…");
    expect(waitStage(7.9)).toBe("Thinking of the tune…");
    expect(waitStage(8)).toBe("Picking the instruments…");
    expect(waitStage(31)).toBe("Adding the drums…");
    expect(waitStage(59)).toBe("Nearly ready…");
    expect(waitStage(10_000)).toBe("Nearly ready…");
  });
  it("never says the song is finished, and reads nonsense as the start", () => {
    for (const st of WAIT_STAGES) expect(st.text).not.toMatch(/done|finished|ready!|here/i);
    for (const bad of [-5, NaN, Infinity * 0, undefined as unknown as number]) expect(waitStage(bad)).toBe("Thinking of the tune…");
    expect(WAIT_STAGES.map((s) => s.at)).toEqual([...WAIT_STAGES.map((s) => s.at)].sort((a, b) => a - b));
  });
});

describe("the bar is honest: it eases towards done and only the song being ready fills it", () => {
  it("starts at nothing, only goes up, and never reaches the cap however long it waits", () => {
    expect(waitProgress(0)).toBe(0);
    let last = -1;
    for (let s = 0; s <= 600; s += 5) { const p = waitProgress(s); expect(p).toBeGreaterThanOrEqual(last); expect(p).toBeLessThan(BAR_CAP); last = p; }
    expect(waitProgress(1e9)).toBeLessThanOrEqual(BAR_CAP);
    expect(waitProgress(60)).toBeGreaterThan(0.6);
    expect(waitProgress(60)).toBeLessThan(0.85);
  });
  it("is full only when told the song is ready, and reads nonsense as nothing", () => {
    expect(waitProgress(3, true)).toBe(1);
    expect(waitProgress(1e9, false)).toBeLessThan(1);
    for (const bad of [-1, NaN, undefined as unknown as number]) expect(waitProgress(bad)).toBe(0);
  });
});

describe("the card wiring", () => {
  const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8");
  it("shows the display while a song is written, sung or got ready, hides it from the screen reader, and not when a song ended without a party", () => {
    const card = read("src/features/game/world/ThemeSongCard.tsx");
    expect(card).toContain('aria-hidden="true" data-testid="song-wait"');
    expect(card).toMatch(/const preparing = phase === "ready" && !!flow && !flow\.fallbackUrl && \/Getting the party ready\/\.test\(flow\.note\);/);
    expect(card).toContain('const waiting = phase === "writing" || phase === "making" || preparing;');
    expect(card).toContain("{waiting && <SongWait seconds={seconds} done={preparing} />}");
  });
  it("every animation stops for reduced motion, and the bar can only be filled by the song being ready", () => {
    const css = read("src/index.css");
    const block = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce) {\n  .tv-song-notes"));
    for (const sel of [".tv-song-notes { display: none; }", ".tv-song-eq i { animation: none;", ".tv-song-bar-fill { animation: none;", ".tv-song-stage, .tv-song-name { animation: none; }", ".tv-dots i { animation: none; }"]) expect(block, sel).toContain(sel);
  });
});
