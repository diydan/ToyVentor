// The new-player setup (Dan, 2026-11-04): who is playing (a grown-up sets up anyone under 13), the names, the favourites, a yes or no to a theme song, a pile of bricks that builds the
// child's Kip, then an intro with confetti while the song is made, and a quick word about the app. Spec: docs/specs/accounts-and-new-user-spec.md; every rule and every word list lives in
// src/lib/newPlayer.ts (pure, tested). PHASE 0: nothing here logs in or reaches a server; the profile is kept on the device, and the one request that leaves it is the song, after a yes.
import { useEffect, useMemo, useRef, useState } from "react";
import "../../../onboarding.css";
import {
  FAVOURITE_ANIMALS, FAVOURITE_COLOURS, FAVOURITE_FRUITS, HAIR_CHOICES, HAIR_COLOUR_CHOICES, HAT_CHOICES, NAME_PROBLEM_TEXT, PANTS_COLOURS, SHOE_COLOURS, SKIN_CHOICES, TAIL_CHOICES, animalOf, buildProfile, cleanKipConfig, cleanName, colourOf, confetti, defaultKipConfig, fruitOf, grownUpQuestion, introSlides, meetKipSlides, saveProfile, songIdea,
  stepsFor, type Choice, type KipConfig, type PlayerProfile, type StepId, type Store,
} from "../../../lib/newPlayer";
import type { FlowState } from "./themeSongFlow";

export interface OnboardingSheetProps {
  /** Leave without finishing (nothing is saved unless the intro was reached). */
  onClose(): void;
  /** The "meet Kip" scene in the game's world: `enter` leaves the title and goes to the Toy Room (false: there is no game to show it in), `dress` puts the real Kip in the workshop wearing the outfit in `hex` (a JSON object) and keeps him up to date, `pile` paints the shirt (the favourite colour) and lays Kip out as a pile of his real parts, `build` carries them to their seats, `abort` puts Kip back, `phonesShow` floats the headphones beside Kip. */
  onStage(op: "enter" | "dress" | "pile" | "build" | "abort" | "end" | "phonesShow", hex?: string): void | boolean;
  /** True from the grown-up's yes until the headphones are picked up: the song is made but does not dance by itself. */
  onHold(on: boolean): void;
  /** The player picked up the headphones: Kip puts them on and the dance starts. Called from a tap. */
  onPickUp(): void;
  /** The intro begins: leave the title screen, so the world and the dancing Kip show behind it. Called from a tap. */
  onIntroStart(): void;
  /** Ask for the theme song (the game's own song flow, "prompt" kind). Called from a tap, only after a grown-up's yes. */
  onSong(idea: string): void;
  /** The song flow's state: the intro shows how the song is coming on. */
  song: FlowState | null;
  /** Where the profile is kept (the page's localStorage). */
  storage?: Store | null;
}

/** The world's report of each part tapped into place (runtime/world.ts onbPlace). */
export const PROGRESS_EVENT = "tv-onb-progress";
/** How long the pile waits for a first tap, and for another after a tap, before Kip builds himself. */
export const TAP_IDLE_MS = 4500;
export const TAP_IDLE_AFTER_TAP_MS = 3500;

const reduced = (): boolean => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
const todayIso = (): string => new Date().toISOString();

/** A little Kip that wears the choices as they are made (plain blocks: the real Kip is built in the scene that follows). */
/** What the Dress step can change, one chip each; the tiles of the chosen one show below. */
const DRESS_PARTS = [["shirt", "Shirt"], ["pants", "Pants"], ["boots", "Shoes"], ["skin", "Skin"], ["hair", "Hair"], ["hairColour", "Hair colour"], ["hat", "Hat"], ["tail", "Tail"]] as const;
type DressPart = (typeof DRESS_PARTS)[number][0];

function KipPreview({ cfg }: { cfg: KipConfig }) {
  const hat = HAT_CHOICES.find((h) => h.id === cfg.hat);
  const tail = TAIL_CHOICES.find((t) => t.id === cfg.tail);
  return (
    <div className="tv-onb-preview" aria-hidden="true" data-preview>
      <i className="pv-leg pv-l" style={{ background: cfg.pants }} /><i className="pv-leg pv-r" style={{ background: cfg.pants }} />
      <i className="pv-shoe pv-l" style={{ background: cfg.boots }} /><i className="pv-shoe pv-r" style={{ background: cfg.boots }} />
      <i className="pv-arm pv-l" style={{ background: cfg.skin }} /><i className="pv-arm pv-r" style={{ background: cfg.skin }} />
      <i className="pv-torso" style={{ background: cfg.shirt }} />
      <i className="pv-head" style={{ background: cfg.skin }}><b className="pv-eye pv-l" /><b className="pv-eye pv-r" /><b className="pv-mouth" /></i>
      {cfg.hair !== "none" && <i className="pv-hair" style={{ background: cfg.hairColour }} />}
      {hat && hat.id !== "none" && <span className="pv-hat">{hat.icon}</span>}
      {tail && tail.id !== "none" && <span className="pv-tail">{tail.icon}</span>}
    </div>
  );
}

function Tiles({ label, items, value, onPick, colour, text }: { label: string; items: readonly Choice[]; value: string; onPick(id: string): void; colour?: boolean; /** Show the name on the tile (for lists with no picture, like hairstyles). */ text?: boolean }) {
  return (
    <div className="tv-onb-row" role="group" aria-label={label}>
      <b className="tv-onb-rowlabel">{label}</b>
      <div className="tv-onb-tiles">
        {items.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`tv-onb-tile${colour ? " tv-onb-swatch" : ""}${text ? " tv-onb-tile-text" : ""}`}
            style={colour ? { background: (c as { hex?: string }).hex } : undefined}
            aria-pressed={value === c.id}
            aria-label={c.label}
            title={c.label}
            data-pick={c.id}
            onClick={() => onPick(c.id)}
          >
            {colour ? <span aria-hidden="true">{value === c.id ? "✓" : ""}</span> : text ? <span aria-hidden="true">{c.label}</span> : <span aria-hidden="true">{c.icon}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

export function OnboardingSheet({ onClose, onStage, onHold, onPickUp, onIntroStart, onSong, song, storage }: OnboardingSheetProps) {
  const [under13, setUnder13] = useState<boolean | null>(null);
  const [step, setStep] = useState<StepId>("who");
  const [kid, setKid] = useState("");
  const [parent, setParent] = useState("");
  const [colour, setColour] = useState("");
  const [fruit, setFruit] = useState("");
  const [animal, setAnimal] = useState("");
  const [consent, setConsent] = useState<boolean | null>(null);
  const [problem, setProblem] = useState("");
  // the "meet Kip" scene: wait (the Toy Room is loading) > pile (Kip is a pile of bricks) > building > built > meet (three prop cards)
  // "Dress your Kip": the shirt starts as the favourite colour, everything else as the stock Kip (the demo's skin, jeans and chestnut Swept hair)
  const [cfg, setCfg] = useState<KipConfig>(() => defaultKipConfig());
  // one row of tiles at a time (the card sits beside the real Kip and the screen is about 390 px tall): the chips choose which
  const [part, setPart] = useState<DressPart>("shirt");
  const pickId = (key: keyof KipConfig) => (id: string) => setCfg((c) => ({ ...c, [key]: id }));
  /** Colour tiles are named by id but the config holds the hex: translate both ways. */
  const pickHex = (key: keyof KipConfig, list: readonly { id: string; hex: string }[]) => (id: string) => { const hit = list.find((x) => x.id === id); if (hit) setCfg((c) => ({ ...c, [key]: hit.hex })); };
  const idOf = (list: readonly { id: string; hex: string }[], hex: string) => list.find((x) => x.hex.toLowerCase() === hex.toLowerCase())?.id ?? "";
  const [scene, setScene] = useState<"wait" | "pile" | "building" | "built" | "meet">("wait");
  const [meet, setMeet] = useState(0);
  const timers = useRef<number[]>([]);
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
  const checkFavourites = () => {
    if (!colour || !fruit || !animal) { setProblem("Pick one of each to go on."); return; }
    setCfg((c) => ({ ...c, shirt: colourOf(colour)?.hex ?? c.shirt })); // the shirt starts as the favourite colour (and can be changed on the next screen)
    setPart("shirt");
    next();
  };

  // The DRESS step shows the REAL Kip, standing in the workshop and wearing every pick at once (the kid bench, spec section 9). `staged`: the game is already showing the workshop, so the build step does
  // not enter it again. `engineOk` goes false when there is no game to show him in (the plain-blocks preview stays then); `live`: the workshop is up and picks are sent.
  const staged = useRef(false);
  const [engineOk, setEngineOk] = useState(true);
  const [live, setLive] = useState(false);
  const outfit = () => JSON.stringify(cleanKipConfig(cfg) ?? defaultKipConfig(colourOf(colour)?.hex));
  useEffect(() => {
    if (step !== "dress") return;
    if (staged.current) { setLive(true); return; }
    if (onStage("enter") === false) { setEngineOk(false); return; }
    staged.current = true;
    const t = window.setTimeout(() => setLive(true), 900); // the Toy Room is loading; the workshop goes up over it
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);
  useEffect(() => {
    if (step !== "dress" || !live) return;
    const t = window.setTimeout(() => onStage("dress", outfit()), 40);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, live, cfg]);
  const backFromDress = () => { onStage("abort"); staged.current = false; setLive(false); back(); };
  const stageDress = step === "dress" && engineOk;

  // entering the build step goes to the Toy Room (already there after Dress) and lays Kip out as a pile; leaving it any other way than forward puts Kip back
  const laid = useRef(false);
  useEffect(() => {
    if (step !== "build") return;
    const there = staged.current;
    if (!there) onStage("enter");
    staged.current = true;
    setScene("wait");
    const t = window.setTimeout(() => { onStage("pile", outfit()); laid.current = true; setPlaced(0); setTotal(0); setScene("pile"); }, there ? 350 : 1700);
    timers.current.push(t);
    return () => { window.clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);
  useEffect(() => () => { timers.current.forEach((t) => window.clearTimeout(t)); }, []);
  // Tap-to-build: the child may tap the parts of the pile (the world carries each tapped part to its seat and reports it through the window event "tv-onb-progress"). Nobody has to: Kip builds himself
  // when nothing has been tapped for a few seconds (Dan: "we should not opt in to build Kip"), carrying whatever is left, and "Build it for me" does the same at once.
  const [placed, setPlaced] = useState(0);
  const [total, setTotal] = useState(0);
  useEffect(() => {
    if (scene !== "pile") return;
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ placed?: number; total?: number; done?: boolean }>).detail;
      if (!d) return;
      setPlaced(Number(d.placed) || 0); setTotal(Number(d.total) || 0);
      if (d.done) setScene("built"); // the last part was tapped into place: the world has already shown Kip
    };
    window.addEventListener(PROGRESS_EVENT, on);
    return () => window.removeEventListener(PROGRESS_EVENT, on);
  }, [scene]);
  useEffect(() => {
    if (scene !== "pile") return;
    const t = window.setTimeout(() => buildKip(), placed > 0 ? TAP_IDLE_AFTER_TAP_MS : TAP_IDLE_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, placed]);
  // closing the sheet part-way puts Kip back (a built Kip is untouched, and a pair of headphones already on stays on)
  useEffect(() => () => { if (laid.current || staged.current) onStage("abort"); }, []);
  // the headphones: they appear when the song is complete (and Kip is built), and the player picks them up to start the dance
  const songReady = !!song && song.phase === "ready" && song.loop > 0;
  const phonesOk = songReady && (step === "intro" || (step === "build" && (scene === "built" || scene === "meet")));
  const [picked, setPicked] = useState(false);
  const shown = useRef(false);
  useEffect(() => { if (phonesOk && !shown.current) { shown.current = true; onStage("phonesShow"); } }, [phonesOk]);
  const buildKip = () => {
    setScene("building");
    onStage("build");
    timers.current.push(window.setTimeout(() => setScene("built"), 3600));
  };
  const backFromBuild = () => { onStage("abort"); laid.current = false; staged.current = false; back(); };

  /**
   * The grown-up's answer on the song screen: the profile is complete now, so it is saved (on this device), and on a yes the song is asked for RIGHT HERE, before Kip is built, so it is being
   * written and sung while he builds and the tour plays. The dance is held until the headphones are picked up (onHold), so nothing plays by itself.
   */
  const chooseConsent = (yes: boolean) => {
    setConsent(yes);
    const made = buildProfile({ under13: under13 !== false, kidName: kid, parentName: parent, favourites: { colour, fruit, animal }, songConsent: yes }, todayIso());
    if (!made.ok) { setProblem(`Something is missing (${made.problem}). Please go back.`); return; }
    saveProfile(storage === undefined ? safeStorage() : storage, made.profile);
    setProfile(made.profile);
    const idea = songIdea(made.profile);
    if (idea) { onHold(true); onSong(idea); }
    next();
  };
  /** The tour begins: the world (the Toy Room, Kip built) shows behind it. */
  const startIntro = () => { onIntroStart(); setSlide(0); go("intro"); };

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
  const meetSlides = useMemo(() => meetKipSlides(), []);
  const songNote = song?.phase === "dancing" ? `🎵 ${song.name || "Your song"} is playing!` : phonesOk && !picked ? `🎧 ${song?.name || "Your song"} is ready! Pick up the headphones to dance.` : song?.phase === "failed" ? (song.note || "The song maker is resting. You can make a song later from the Map.") : song && song.phase !== "ready" ? `Making ${profile?.kidName ?? name}'s song… ${song.note || ""}` : "";

  return (
    <section ref={rootRef} className={`tv-onb${step === "intro" ? " tv-onb-intro" : ""}${step === "build" || stageDress ? " tv-onb-stage" : ""}${stageDress ? " tv-onb-dressing" : ""}`} role="dialog" aria-modal="true" aria-label="New player setup" data-onb-step={step}>
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
        {step === "dress" && (
          <>
            {heading(`Dress ${name}'s Kip`)}
            <div className="tv-onb-dress">
              {!engineOk && <KipPreview cfg={cfg} />}
              <div className="tv-onb-dresspanel">
                <div className="tv-onb-tabs" role="tablist" aria-label="What to change">
                  {DRESS_PARTS.map(([id, label]) => (
                    <button key={id} type="button" role="tab" className="tv-onb-tab" aria-selected={part === id} onClick={() => setPart(id)} data-tab={id}>{label}</button>
                  ))}
                </div>
                {part === "shirt" && <Tiles label="Shirt" items={FAVOURITE_COLOURS} value={idOf(FAVOURITE_COLOURS, cfg.shirt)} onPick={pickHex("shirt", FAVOURITE_COLOURS)} colour />}
                {part === "pants" && <Tiles label="Pants" items={PANTS_COLOURS} value={idOf(PANTS_COLOURS, cfg.pants)} onPick={pickHex("pants", PANTS_COLOURS)} colour />}
                {part === "boots" && <Tiles label="Shoes" items={SHOE_COLOURS} value={idOf(SHOE_COLOURS, cfg.boots)} onPick={pickHex("boots", SHOE_COLOURS)} colour />}
                {part === "skin" && <Tiles label="Skin" items={SKIN_CHOICES} value={idOf(SKIN_CHOICES, cfg.skin)} onPick={pickHex("skin", SKIN_CHOICES)} colour />}
                {part === "hair" && <Tiles label="Hair" items={HAIR_CHOICES} value={cfg.hair} onPick={pickId("hair")} text />}
                {part === "hairColour" && <Tiles label="Hair colour" items={HAIR_COLOUR_CHOICES} value={idOf(HAIR_COLOUR_CHOICES, cfg.hairColour)} onPick={pickHex("hairColour", HAIR_COLOUR_CHOICES)} colour />}
                {part === "hat" && <Tiles label="Hat" items={HAT_CHOICES} value={cfg.hat} onPick={pickId("hat")} />}
                {part === "tail" && <Tiles label="Tail" items={TAIL_CHOICES} value={cfg.tail} onPick={pickId("tail")} />}
              </div>
            </div>
            <div className="tv-onb-nav">
              <button type="button" className="tv-ctl" onClick={backFromDress} data-onb-back>Back</button>
              <button type="button" className="tv-ctl tv-ctl-primary" onClick={next} data-onb-next>Next</button>
            </div>
          </>
        )}
        {step === "song" && (
          <>
            {heading(`A theme song for ${name}?`)}
            <p className="tv-onb-p">We can make a song just for {name}, using the first name and the favourite colour, fruit and animal. To do that, those words are sent to our song makers: an AI that writes the words and a service that sings them. Nothing else is sent, and the song is kept on this device.</p>
            <p className="tv-onb-p"><b>{under13 === false ? "Is that OK?" : "A grown-up must say yes."}</b></p>
            <div className="tv-onb-big">
              <button type="button" className="tv-ctl tv-ctl-primary" aria-pressed={consent === true} onClick={() => chooseConsent(true)} data-consent="yes">{under13 === false ? "Yes, make the song" : "I'm the grown-up: yes, make the song"}</button>
              <button type="button" className="tv-ctl" aria-pressed={consent === false} onClick={() => chooseConsent(false)} data-consent="no">No thanks, skip the song</button>
            </div>
            <div className="tv-onb-nav"><button type="button" className="tv-ctl" onClick={back}>Back</button></div>
          </>
        )}
        {step === "build" && (
          <div className="tv-onb-meet" data-scene={scene}>
            {scene === "wait" && (<>{heading("Kip's Toy Room")}<p className="tv-onb-p">Getting the Toy Room ready…</p></>)}
            {scene === "pile" && (
              <>
                {heading("Kip is a pile of parts!")}
                <p className="tv-onb-p" role="status">{placed > 0 ? `${placed} of ${total} parts are in place. Keep tapping!` : `Tap the parts to build Kip, ${name}! Or just wait: he builds himself.`}</p>
                <div className="tv-onb-nav">
                  <button type="button" className="tv-ctl" onClick={backFromBuild}>Back</button>
                  <button type="button" className="tv-ctl tv-ctl-primary" onClick={buildKip} data-onb-build>Build it for me</button>
                </div>
              </>
            )}
            {scene === "building" && (<>{heading("Building…")}<p className="tv-onb-p" role="status">Look! The parts are flying to their places.</p></>)}
            {scene === "built" && (
              <>
                {heading(`Meet Kip, ${name}!`)}
                <p className="tv-onb-p" role="status">Kip is built, wearing a {colourOf(colour)?.label.toLowerCase()} shirt. Kip loves {fruitOf(fruit)?.label.toLowerCase()} and {animalOf(animal)?.label.toLowerCase()}s too!</p>
                <div className="tv-onb-nav"><button type="button" className="tv-ctl tv-ctl-primary" onClick={() => { setMeet(0); setScene("meet"); }} data-onb-next>Show me around</button></div>
              </>
            )}
            {scene === "meet" && (
              <div className="tv-onb-slide" key={meetSlides[meet]?.id} data-meet={meetSlides[meet]?.id}>
                <span className="tv-onb-icon" aria-hidden="true">{meetSlides[meet]?.icon}</span>
                <h2 className="tv-onb-h" tabIndex={-1} data-focus>{meetSlides[meet]?.title}</h2>
                {meetSlides[meet]?.lines.map((l) => <p className="tv-onb-p" key={l}>{l}</p>)}
                <div className="tv-onb-dots" aria-hidden="true">{meetSlides.map((x, i) => <i key={x.id} className={i === meet ? "on" : ""} />)}</div>
                <div className="tv-onb-nav">
                  <button type="button" className="tv-ctl" disabled={meet === 0} onClick={() => setMeet((m) => Math.max(0, m - 1))}>Back</button>
                  {meet < meetSlides.length - 1
                    ? <button type="button" className="tv-ctl tv-ctl-primary" onClick={() => setMeet((m) => m + 1)} data-onb-next>Next</button>
                    : <button type="button" className="tv-ctl tv-ctl-primary" onClick={startIntro} data-onb-next>Meet your song and the app!</button>}
                </div>
              </div>
            )}
            {problem && <p className="tv-onb-err" role="alert">{problem}</p>}
          </div>
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
      {phonesOk && !picked && (
        <button type="button" className="tv-onb-phones" onClick={() => { setPicked(true); onPickUp(); }} data-onb-phones>
          <span aria-hidden="true">🎧</span>
          <b>Pick up the headphones!</b>
        </button>
      )}
    </section>
  );
}

function safeStorage(): Store | null { try { return window.localStorage; } catch { return null; } }
