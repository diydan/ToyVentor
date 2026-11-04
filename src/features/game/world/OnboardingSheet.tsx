// The new-player setup (Dan, 2026-11-04): who is playing (a grown-up sets up anyone under 13), the names, the favourites, a yes or no to a theme song, a pile of bricks that builds the
// child's Kip, then an intro with confetti while the song is made, and a quick word about the app. Spec: docs/specs/accounts-and-new-user-spec.md; every rule and every word list lives in
// src/lib/newPlayer.ts (pure, tested). PHASE 0: nothing here logs in or reaches a server; the profile is kept on the device, and the one request that leaves it is the song, after a yes.
import { useEffect, useMemo, useRef, useState } from "react";
import "../../../onboarding.css";
import {
  FAVOURITE_ANIMALS, FAVOURITE_COLOURS, FAVOURITE_FRUITS, NAME_PROBLEM_TEXT, animalOf, buildProfile, cleanName, colourOf, confetti, fruitOf, grownUpQuestion, introSlides, saveProfile, songIdea,
  stepsFor, type Choice, type PlayerProfile, type StepId, type Store,
} from "../../../lib/newPlayer";
import type { FlowState } from "./themeSongFlow";

export interface OnboardingSheetProps {
  /** Leave without finishing (nothing is saved unless the intro was reached). */
  onClose(): void;
  /** The favourite colour becomes Kip's shirt (the engine's `setPaintZone("c1")` then `setPaint`). */
  onPaint(hex: string): void;
  /** The intro begins: leave the title screen, so the world and the dancing Kip show behind it. Called from a tap. */
  onIntroStart(): void;
  /** Ask for the theme song (the game's own song flow, "prompt" kind). Called from a tap, only after a grown-up's yes. */
  onSong(idea: string): void;
  /** The song flow's state: the intro shows how the song is coming on. */
  song: FlowState | null;
  /** Where the profile is kept (the page's localStorage). */
  storage?: Store | null;
}

const reduced = (): boolean => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
const todayIso = (): string => new Date().toISOString();

/** One of Kip's blocks. `pile` is where it lies in the heap, `home` where it sits in the finished Kip (px in a 170 by 230 box). */
interface Brick { id: string; w: number; h: number; colour: string; home: [number, number]; pile: [number, number, number]; z: number; round?: boolean }

function kipBricks(shirt: string): Brick[] {
  return [
    { id: "legL", w: 22, h: 50, colour: "#2b4c85", home: [56, 118], pile: [18, 168, -18], z: 1 },
    { id: "legR", w: 22, h: 50, colour: "#2b4c85", home: [92, 118], pile: [62, 176, 24], z: 1 },
    { id: "shoeL", w: 30, h: 15, colour: "#ff6b4a", home: [52, 168], pile: [100, 184, 8], z: 2 },
    { id: "shoeR", w: 30, h: 15, colour: "#ff6b4a", home: [90, 168], pile: [8, 196, -6], z: 2 },
    { id: "torso", w: 70, h: 62, colour: shirt, home: [50, 56], pile: [44, 150, 12], z: 3, round: true },
    { id: "armL", w: 18, h: 56, colour: "#f3ba95", home: [28, 60], pile: [92, 150, 70], z: 2 },
    { id: "armR", w: 18, h: 56, colour: "#f3ba95", home: [124, 60], pile: [28, 150, -64], z: 2 },
    { id: "head", w: 60, h: 52, colour: "#f3ba95", home: [55, 2], pile: [70, 128, -14], z: 4, round: true },
    { id: "studL", w: 13, h: 7, colour: "#ff6b4a", home: [68, -4], pile: [4, 130, 30], z: 5 },
    { id: "studR", w: 13, h: 7, colour: "#ff6b4a", home: [90, -4], pile: [110, 156, -40], z: 5 },
  ];
}
/** Loose bricks in the heap that are not part of Kip: they tumble away when he is built. */
const SPARE: Array<{ colour: number; pile: [number, number, number]; w: number; h: number; away: [number, number] }> = [
  { colour: 0, pile: [0, 190, 14], w: 34, h: 20, away: [-70, 30] },
  { colour: 2, pile: [112, 196, -12], w: 30, h: 20, away: [90, 30] },
  { colour: 4, pile: [30, 204, 4], w: 36, h: 20, away: [-40, 60] },
  { colour: 5, pile: [76, 206, -20], w: 32, h: 20, away: [60, 60] },
  { colour: 1, pile: [138, 176, 34], w: 28, h: 20, away: [110, 10] },
  { colour: 3, pile: [-6, 168, -30], w: 30, h: 20, away: [-90, 0] },
  { colour: 6, pile: [56, 190, 0], w: 34, h: 20, away: [0, 70] },
];

function Tiles({ label, items, value, onPick, colour }: { label: string; items: readonly Choice[]; value: string; onPick(id: string): void; colour?: boolean }) {
  return (
    <div className="tv-onb-row" role="group" aria-label={label}>
      <b className="tv-onb-rowlabel">{label}</b>
      <div className="tv-onb-tiles">
        {items.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`tv-onb-tile${colour ? " tv-onb-swatch" : ""}`}
            style={colour ? { background: (c as { hex?: string }).hex } : undefined}
            aria-pressed={value === c.id}
            aria-label={c.label}
            title={c.label}
            data-pick={c.id}
            onClick={() => onPick(c.id)}
          >
            {colour ? <span aria-hidden="true">{value === c.id ? "✓" : ""}</span> : <span aria-hidden="true">{c.icon}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

export function OnboardingSheet({ onClose, onPaint, onIntroStart, onSong, song, storage }: OnboardingSheetProps) {
  const [under13, setUnder13] = useState<boolean | null>(null);
  const [step, setStep] = useState<StepId>("who");
  const [kid, setKid] = useState("");
  const [parent, setParent] = useState("");
  const [colour, setColour] = useState("");
  const [fruit, setFruit] = useState("");
  const [animal, setAnimal] = useState("");
  const [consent, setConsent] = useState<boolean | null>(null);
  const [problem, setProblem] = useState("");
  const [built, setBuilt] = useState(false);
  const [slide, setSlide] = useState(0);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [answer, setAnswer] = useState("");
  const [tries, setTries] = useState(0);
  const question = useMemo(() => grownUpQuestion(), []);
  const calm = useMemo(reduced, []);
  const steps = stepsFor(under13 ?? true);
  const rootRef = useRef<HTMLElement>(null);

  // each screen takes focus on its heading, so a keyboard or a screen reader starts at the top of the new screen
  useEffect(() => { rootRef.current?.querySelector<HTMLElement>("[data-focus]")?.focus({ preventScroll: true }); }, [step]);

  const go = (to: StepId) => { setProblem(""); setStep(to); };
  const next = () => { const i = steps.indexOf(step); const to = steps[Math.min(steps.length - 1, i + 1)]; if (to) go(to); };
  const back = () => { const i = steps.indexOf(step); const to = steps[Math.max(0, i - 1)]; if (to && i > 0) go(to); };

  const askWho = (u13: boolean) => { setUnder13(u13); setProblem(""); setStep(u13 ? "grownup" : "names"); };
  const checkGrownUp = () => {
    if (Number(answer.trim()) === question.answer) { setProblem(""); next(); return; }
    setTries((t) => t + 1);
    setProblem("That is not right. Please hand the device to a grown-up.");
  };
  const checkNames = () => {
    const k = cleanName(kid);
    if (!k.ok) { setProblem(`Player's name: ${NAME_PROBLEM_TEXT[k.problem]}`); return; }
    if (under13 !== false || parent.trim()) {
      const p = cleanName(parent);
      if (!p.ok) { setProblem(`Grown-up's name: ${NAME_PROBLEM_TEXT[p.problem]}`); return; }
    }
    setKid(k.ok ? k.name : kid);
    next();
  };
  const checkFavourites = () => { if (!colour || !fruit || !animal) { setProblem("Pick one of each to go on."); return; } next(); };

  const buildKip = () => { setBuilt(true); const c = colourOf(colour); if (c) onPaint(c.hex); };

  /** The intro: the profile is saved (on this device), the world shows behind, and the song, if a grown-up said yes, is asked for. All from one tap. */
  const startIntro = () => {
    const made = buildProfile({ under13: under13 !== false, kidName: kid, parentName: parent, favourites: { colour, fruit, animal }, songConsent: consent === true }, todayIso());
    if (!made.ok) { setProblem(`Something is missing (${made.problem}). Please go back.`); return; }
    saveProfile(storage === undefined ? safeStorage() : storage, made.profile);
    setProfile(made.profile);
    onIntroStart();
    const idea = songIdea(made.profile);
    if (idea) onSong(idea);
    setSlide(0);
    go("intro");
  };

  const slides = useMemo(() => introSlides(profile?.kidName ?? kid ?? ""), [profile, kid]);
  const pieces = useMemo(() => confetti(70), []);
  // the tour moves on by itself every five seconds (a still page for reduced motion), and the child can go through it faster or back
  useEffect(() => {
    if (step !== "intro" || calm) return;
    const t = window.setInterval(() => setSlide((s) => Math.min(slides.length - 1, s + 1)), 5200);
    return () => window.clearInterval(t);
  }, [step, calm, slides.length]);

  const heading = (text: string) => <h2 className="tv-onb-h" tabIndex={-1} data-focus>{text}</h2>;
  const nav = (onNext: () => void, label = "Next", canBack = true) => (
    <div className="tv-onb-nav">
      {canBack && <button type="button" className="tv-ctl" onClick={back}>Back</button>}
      <button type="button" className="tv-ctl tv-ctl-primary" onClick={onNext} data-onb-next>{label}</button>
    </div>
  );
  const name = kid.trim() || "your player";
  const shirt = colourOf(colour)?.hex ?? "#ff6b4a";
  const bricks = kipBricks(shirt);
  const songNote = song?.phase === "ready" || song?.phase === "dancing" ? `🎵 ${song.name || "Your song"} is playing!` : song?.phase === "failed" ? (song.note || "The song maker is resting. You can make a song later from the Map.") : song ? `Making ${profile?.kidName ?? name}'s song… ${song.note || ""}` : "";

  return (
    <section ref={rootRef} className={`tv-onb${step === "intro" ? " tv-onb-intro" : ""}`} role="dialog" aria-modal="true" aria-label="New player setup" data-onb-step={step}>
      {step === "intro" && !calm && (
        <div className="tv-onb-confetti" aria-hidden="true">
          {pieces.map((p, i) => (
            <i key={i} style={{ left: `${p.left}%`, width: p.size, height: p.size * 1.5, background: p.colour, animationDelay: `${p.delay}s`, animationDuration: `${p.duration}s`, ["--spin" as string]: `${p.spin}deg`, ["--dx" as string]: `${p.drift}px` }} />
          ))}
        </div>
      )}
      <div className="tv-onb-card">
        {step === "who" && (
          <>
            {heading("Let's set up a new player!")}
            <p className="tv-onb-p">Is the player under 13? A grown-up sets up anyone under 13.</p>
            <div className="tv-onb-big">
              <button type="button" className="tv-ctl tv-ctl-primary" onClick={() => askWho(true)} data-who="under13">Yes, under 13</button>
              <button type="button" className="tv-ctl" onClick={() => askWho(false)} data-who="13plus">No, 13 or older</button>
            </div>
          </>
        )}
        {step === "grownup" && (
          <>
            {heading("Grown-up check")}
            <p className="tv-onb-p">Please hand the device to a grown-up. What is {question.a} × {question.b}?</p>
            <input className="tv-onb-input" inputMode="numeric" autoComplete="off" aria-label={`What is ${question.a} times ${question.b}?`} value={answer} onChange={(e) => setAnswer(e.target.value)} onKeyDown={(e) => e.key === "Enter" && checkGrownUp()} data-onb-answer />
            <p className="tv-onb-note">This is a quick check, not a lock: a grown-up stays with the player for the rest of the setup.{tries > 2 ? " Still stuck? Tap Back and choose again." : ""}</p>
            {problem && <p className="tv-onb-err" role="alert">{problem}</p>}
            {nav(checkGrownUp, "Continue")}
          </>
        )}
        {step === "names" && (
          <>
            {heading("Who is playing?")}
            <div className="tv-onb-fields">
              <label className="tv-onb-field"><span>Player's first name or nickname</span>
                <input className="tv-onb-input" value={kid} maxLength={24} autoComplete="off" onChange={(e) => setKid(e.target.value)} onKeyDown={(e) => e.key === "Enter" && checkNames()} data-onb-kid />
              </label>
              <label className="tv-onb-field"><span>{under13 === false ? "Grown-up's name (optional)" : "Grown-up's name"}</span>
                <input className="tv-onb-input" value={parent} maxLength={24} autoComplete="off" onChange={(e) => setParent(e.target.value)} onKeyDown={(e) => e.key === "Enter" && checkNames()} data-onb-parent />
              </label>
            </div>
            <p className="tv-onb-note">Letters only. Names stay on this device.</p>
            {problem && <p className="tv-onb-err" role="alert">{problem}</p>}
            {nav(checkNames)}
          </>
        )}
        {step === "favourites" && (
          <>
            {heading(`What does ${name} love?`)}
            <Tiles label="Favourite colour" items={FAVOURITE_COLOURS} value={colour} onPick={setColour} colour />
            <Tiles label="Favourite fruit" items={FAVOURITE_FRUITS} value={fruit} onPick={setFruit} />
            <Tiles label="Favourite animal" items={FAVOURITE_ANIMALS} value={animal} onPick={setAnimal} />
            {problem && <p className="tv-onb-err" role="alert">{problem}</p>}
            {nav(checkFavourites)}
          </>
        )}
        {step === "song" && (
          <>
            {heading(`A theme song for ${name}?`)}
            <p className="tv-onb-p">We can make a song just for {name}, using the first name and the favourite colour, fruit and animal. To do that, those words are sent to our song makers: an AI that writes the words and a service that sings them. Nothing else is sent, and the song is kept on this device.</p>
            <p className="tv-onb-p"><b>{under13 === false ? "Is that OK?" : "A grown-up must say yes."}</b></p>
            <div className="tv-onb-big">
              <button type="button" className="tv-ctl tv-ctl-primary" aria-pressed={consent === true} onClick={() => { setConsent(true); next(); }} data-consent="yes">{under13 === false ? "Yes, make the song" : "I'm the grown-up: yes, make the song"}</button>
              <button type="button" className="tv-ctl" aria-pressed={consent === false} onClick={() => { setConsent(false); next(); }} data-consent="no">No thanks, skip the song</button>
            </div>
            <div className="tv-onb-nav"><button type="button" className="tv-ctl" onClick={back}>Back</button></div>
          </>
        )}
        {step === "build" && (
          <>
            {heading(built ? `Meet Kip, ${name}!` : "Let's build your Kip")}
            <div className="tv-onb-buildrow">
              <div className={`tv-onb-pile${built ? " is-built" : ""}`} aria-hidden="true" data-built={built}>
                {SPARE.map((s, i) => (
                  <i key={`s${i}`} className="tv-onb-brick tv-onb-spare" style={{ width: s.w, height: s.h, background: FAVOURITE_COLOURS[s.colour]!.hex, transform: built ? `translate(${s.pile[0] + s.away[0]}px, ${s.pile[1] + s.away[1] + 60}px) rotate(${s.pile[2] + 90}deg)` : `translate(${s.pile[0]}px, ${s.pile[1]}px) rotate(${s.pile[2]}deg)`, opacity: built ? 0 : 1, transitionDelay: built ? `${i * 60}ms` : "0ms" }} />
                ))}
                {bricks.map((b, i) => (
                  <i key={b.id} className={`tv-onb-brick${b.round ? " is-round" : ""}`} style={{ width: b.w, height: b.h, background: b.colour, zIndex: b.z, transform: built ? `translate(${b.home[0]}px, ${b.home[1]}px) rotate(0deg)` : `translate(${b.pile[0]}px, ${b.pile[1]}px) rotate(${b.pile[2]}deg)`, transitionDelay: built ? `${300 + i * 110}ms` : "0ms" }} />
                ))}
                <span className="tv-onb-face" style={{ opacity: built ? 1 : 0, transform: `translate(${55}px, ${2}px)` }}><i /><i /><b /></span>
              </div>
              <div className="tv-onb-buildtext">
                {built ? (
                  <>
                    <p className="tv-onb-p" role="status">Kip is built, wearing a {colourOf(colour)?.label.toLowerCase()} shirt. Kip loves {fruitOf(fruit)?.label.toLowerCase()} and {animalOf(animal)?.label.toLowerCase()}s too!</p>
                    {nav(startIntro, "Meet your song and the app!", false)}
                  </>
                ) : (
                  <>
                    <p className="tv-onb-p">A pile of bricks is waiting. Tap to build Kip, in {name}'s favourite colour.</p>
                    <button type="button" className="tv-ctl tv-ctl-primary tv-onb-buildbtn" onClick={buildKip} data-onb-build>Build my Kip!</button>
                    <div className="tv-onb-nav"><button type="button" className="tv-ctl" onClick={back}>Back</button></div>
                  </>
                )}
                {problem && <p className="tv-onb-err" role="alert">{problem}</p>}
              </div>
            </div>
          </>
        )}
        {step === "intro" && (
          <div className="tv-onb-tour" data-slide={slides[slide]?.id}>
            <div className="tv-onb-slide" key={slides[slide]?.id}>
              <span className="tv-onb-icon" aria-hidden="true">{slides[slide]?.icon}</span>
              <h2 className="tv-onb-h" tabIndex={-1} data-focus>{slides[slide]?.title}</h2>
              {slides[slide]?.lines.map((l) => <p className="tv-onb-p" key={l}>{l}</p>)}
            </div>
            {songNote && <p className="tv-onb-song" role="status" data-onb-song>{songNote}</p>}
            <div className="tv-onb-dots" aria-hidden="true">{slides.map((s, i) => <i key={s.id} className={i === slide ? "on" : ""} />)}</div>
            <div className="tv-onb-nav">
              <button type="button" className="tv-ctl" disabled={slide === 0} onClick={() => setSlide((s) => Math.max(0, s - 1))}>Back</button>
              {slide < slides.length - 1
                ? <button type="button" className="tv-ctl tv-ctl-primary" onClick={() => setSlide((s) => Math.min(slides.length - 1, s + 1))} data-onb-next>Next</button>
                : <button type="button" className="tv-ctl tv-ctl-primary" onClick={onClose} data-onb-play>Let's play!</button>}
              {slide < slides.length - 1 && <button type="button" className="tv-ctl" onClick={onClose}>Skip</button>}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function safeStorage(): Store | null { try { return window.localStorage; } catch { return null; } }
