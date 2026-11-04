import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { nameObject, overlayPoints, scanPhoto } from "../../../../shared/photoPrintFlow";
import {
  SCAVENGER_REWARD_GLB,
  scavengerHint,
  scavengerMissText,
  scavengerVerdictFromNames,
  type ScavengerQuest,
} from "../../../lib/scavenger";
import { PartPreview } from "../../ar/PartPreview";
import "../../../scavenger-cam.css";
import { makeGatedFetch } from "../../../lib/grownUpGate";

/** The Scavenger camera's photo goes to SAM and then to the phone's AR viewer: a grown-up proof at most 5 minutes old (worker/hostedGate.ts "ar"). Nothing is asked while the Worker's switch is off. */
const arFetch = makeGatedFetch({ purpose: "ar" });

/** The photo the helper gets: about 512 px on the long side is all it needs (the print panel shrinks the same way). */
const SEND_SIDE = 512;

type Phase = "starting" | "live" | "looking" | "found" | "miss" | "problem";

interface Frame {
  dataUrl: string;
  w: number;
  h: number;
}

export interface ScavengerCameraProps {
  quest: ScavengerQuest;
  /** XP the chore pays, for the line on a find. */
  xp: number;
  /** A verified find: the game pays the chore here. Called once per find. */
  onFound: (questId: string) => void;
  onClose: () => void;
}

/** A canvas of the picture, shrunk, as a JPEG data URL. The picture lives in this component's memory only: no storage, no file, nothing kept. */
function shrinkToFrame(source: CanvasImageSource, sw: number, sh: number): Frame | null {
  if (!(sw > 0) || !(sh > 0)) return null;
  const k = Math.min(1, SEND_SIDE / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * k));
  const h = Math.max(1, Math.round(sh * k));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, w, h);
  return { dataUrl: canvas.toDataURL("image/jpeg", 0.82), w, h };
}

/**
 * "Find a wheel!": a full-screen camera for the scavenger chores. The child photographs something at home; the online helper names it; if the name is one of
 * the quest's closed words the chore is found, and the helper's SAM then draws the object's outline as a glow over the frozen picture. A find of a gear or a
 * wheel can then be put in the room with the phone's own AR viewer (a real 3D part through model-viewer).
 *
 * Privacy (docs/specs/sam-physical-to-digital-spec.md §7.2): the picture goes to /api/scan only, is held in memory only, and is dropped when the view closes. The one
 * sentence on screen promises only what we do ("we throw away our copy"), nothing about the provider (spec Q7 is still open).
 */
export function ScavengerCamera({ quest, xp, onFound, onClose }: ScavengerCameraProps) {
  const [phase, setPhase] = useState<Phase>("starting");
  const [message, setMessage] = useState("");
  const [frame, setFrame] = useState<Frame | null>(null);
  const [points, setPoints] = useState<[number, number][] | null>(null);
  const [seen, setSeen] = useState<string | null>(null);
  const [showAr, setShowAr] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const runRef = useRef(0); // a newer try (or a close) makes an older one stop touching the screen
  const onFoundRef = useRef(onFound);
  onFoundRef.current = onFound;
  const reward = SCAVENGER_REWARD_GLB[quest.concept] ?? null;

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const startCamera = useCallback(async () => {
    const run = ++runRef.current;
    setFrame(null);
    setPoints(null);
    setSeen(null);
    setShowAr(false);
    setMessage("");
    setPhase("starting");
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraOff(true);
      setPhase("problem");
      setMessage("This screen cannot open a camera. Choose a photo instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      if (run !== runRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      setCameraOff(false);
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        await v.play().catch(() => undefined);
      }
      setPhase("live");
    } catch {
      if (run !== runRef.current) return;
      setCameraOff(true);
      setPhase("problem");
      setMessage("The camera is off. Ask a grown-up to allow it, or choose a photo instead.");
    }
  }, []);

  useEffect(() => {
    void startCamera();
    return () => {
      runRef.current++;
      stopCamera();
    };
  }, [startCamera, stopCamera]);

  /** The picture is taken: name it, check the name against the quest's closed words, then (on a find) trace its outline. */
  const check = useCallback(
    async (f: Frame) => {
      const run = ++runRef.current;
      stopCamera();
      setFrame(f);
      setPoints(null);
      setPhase("looking");
      setMessage("Looking at what it is…");
      const named = await nameObject(arFetch, { imageDataUrl: f.dataUrl });
      if (run !== runRef.current) return;
      if (!named.ok) {
        setPhase("problem");
        setMessage(named.message);
        return;
      }
      const verdict = scavengerVerdictFromNames(quest, named.names);
      if (!verdict.found || !verdict.name) {
        setSeen(named.names[0] ?? null);
        setPhase("miss");
        setMessage(scavengerMissText(quest, named.names[0] ?? null));
        return;
      }
      setSeen(verdict.name);
      setPhase("found");
      setMessage(`That is a ${verdict.name}: a ${quest.concept}!`);
      onFoundRef.current(quest.id);
      // The glow is a bonus: a slow or failed trace never takes the find away.
      const traced = await scanPhoto(arFetch, { imageDataUrl: f.dataUrl, word: verdict.name });
      if (run !== runRef.current) return;
      if (traced.ok) {
        const pts = overlayPoints(traced.scan);
        if (pts.length >= 3) setPoints(pts);
      }
    },
    [quest, stopCamera],
  );

  const shoot = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const f = shrinkToFrame(v, v.videoWidth, v.videoHeight);
    if (!f) {
      setPhase("problem");
      setMessage("That picture could not be read. Try again.");
      return;
    }
    void check(f);
  }, [check]);

  const onFile = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const f = shrinkToFrame(img, img.naturalWidth, img.naturalHeight);
        URL.revokeObjectURL(url);
        if (!f) {
          setPhase("problem");
          setMessage("That picture could not be read. Try another one.");
          return;
        }
        void check(f);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        setPhase("problem");
        setMessage("That picture could not be read. Try another one.");
      };
      img.src = url;
    },
    [check],
  );

  const busy = phase === "looking";
  const showFrame = frame && phase !== "live" && phase !== "starting";
  return (
    <div className="tv-scav" role="dialog" aria-modal="true" aria-label={quest.title}>
      <video
        ref={videoRef}
        className="tv-scav-video"
        autoPlay
        playsInline
        muted
        hidden={Boolean(showFrame) || cameraOff}
      />
      {showFrame && frame && (
        <div className="tv-scav-photo" aria-hidden="true">
          <img className="tv-scav-img" src={frame.dataUrl} alt="" draggable={false} />
          {points && (
            <svg className="tv-scav-glow" viewBox={`0 0 ${frame.w} ${frame.h}`} preserveAspectRatio="xMidYMid meet">
              <polygon points={points.map(([x, y]) => `${x},${y}`).join(" ")} />
            </svg>
          )}
          {busy && <div className="tv-scav-sweep" />}
        </div>
      )}

      <div className="tv-scav-top">
        <div className="tv-scav-title">
          <strong>{quest.title}!</strong>
          <span>{scavengerHint(quest)}</span>
        </div>
        <button type="button" className="tv-scav-x" aria-label="Close the camera" onClick={onClose}>
          ✕
        </button>
      </div>

      {message && (
        <p
          className={`tv-scav-say tv-scav-say-${phase}`}
          role="status"
          aria-live="polite"
        >
          {message}
          {phase === "found" && <span className="tv-scav-xp"> +{xp} XP</span>}
        </p>
      )}

      <div className="tv-scav-bottom">
        {(phase === "live" || phase === "starting") && (
          <>
            <label className="tv-scav-pick">
              🖼️ Photo
              <input type="file" accept="image/*" hidden onChange={onFile} />
            </label>
            <button
              type="button"
              className="tv-scav-shutter"
              aria-label="Take the picture"
              disabled={phase !== "live"}
              onClick={shoot}
            >
              ●
            </button>
            <span className="tv-scav-spacer" />
          </>
        )}
        {phase === "problem" && (
          <>
            <label className="tv-scav-pick">
              🖼️ Choose a photo
              <input type="file" accept="image/*" hidden onChange={onFile} />
            </label>
            {!cameraOff && (
              <button type="button" className="tv-scav-btn" onClick={() => void startCamera()}>
                ↩ Try again
              </button>
            )}
          </>
        )}
        {phase === "miss" && (
          <button type="button" className="tv-scav-btn tv-scav-btn-main" onClick={() => void startCamera()}>
            ↩ Try something else
          </button>
        )}
        {phase === "found" && (
          <>
            {reward && (
              <button type="button" className="tv-scav-btn" aria-pressed={showAr} onClick={() => setShowAr((v) => !v)}>
                {showAr ? "Hide the 3D" : `🪄 See a ${reward.name} in your room`}
              </button>
            )}
            <button type="button" className="tv-scav-btn tv-scav-btn-main" onClick={onClose}>
              ✓ Done
            </button>
          </>
        )}
      </div>
      <p className="tv-scav-privacy">We check the photo, then we throw away our copy. We only keep the count.</p>

      {phase === "found" && showAr && reward && (
        <div className="tv-scav-ar">
          <PartPreview glbFile={reward.glb} partName={reward.name} fill />
          <p>If your phone can do AR, a button appears in the corner. Tap it to put the {reward.name} in your room.</p>
        </div>
      )}
    </div>
  );
}
