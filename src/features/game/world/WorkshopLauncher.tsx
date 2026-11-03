import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { EngineHandle } from "./engine";

/**
 * The Workshop (the Kip and Truck benches, and the Yard) as a full-screen overlay over the world.
 * docs/specs/workshop-spec.md, "4d scope": no iframe, the shell is a plain browser module served from public/kip.
 *
 * - It is loaded only when opened. Vite cannot import a file under public/ by path (dev: "Cannot import non-asset file"; a variable path gets "?import"
 *   appended and fails), so the entry is imported by a FULL-ORIGIN URL, which works in dev and in the build (spiked 2026-11-03).
 * - The world is paused while it is open (no drawing, no keyboard), so two WebGL scenes never draw at once and WASD drives the bench, not the toy.
 * - NO DOWNLOADS: the shell is mounted with `downloads: false`, so no bench hands a file out. The viewer's own grown-up gate only engages inside a frame, and the
 *   game has no host for it yet, so a top-level mount would otherwise let a pack download with no grown-up check. The one exception is the `downloads` prop, which
 *   GameCanvas sets only while the grown-up checks are switched off (src/lib/parentControls.ts).
 */

const WORKSHOP_ENTRY = "/kip/workshop.js";

interface WorkshopShell {
  destroy: () => void;
  ready: () => Promise<unknown>;
}
interface WorkshopModule {
  mountWorkshop: (root: HTMLElement, opts?: Record<string, unknown>) => WorkshopShell;
}

/**
 * Import the shell by a full-origin URL (see above). A retry carries a query so a fetch that failed once is not answered from the module map; the shell has no
 * static imports, so a second copy of it costs nothing.
 */
function loadWorkshopModule(attempt: number): Promise<WorkshopModule> {
  const url = new URL(WORKSHOP_ENTRY, window.location.origin);
  if (attempt > 0) url.searchParams.set("retry", String(attempt));
  return import(/* @vite-ignore */ url.href) as Promise<WorkshopModule>;
}

/** Bench layers that mark themselves open with a class or attribute: the menu's phone drawer and the Describe & build side panel. */
const BENCH_LAYERS = ".km--open, .kdb-panel:not([hidden])";

/**
 * Is one of the benches' own layers open? The Workshop's Escape must not close the whole shell (and with it the loaded rig and its state) while a panel,
 * a modal or the menu drawer has the key: those close themselves. Besides the named layers, any visible `position: fixed` element that covers most of the dialog counts
 * (the selfie, photo-print and Make-from-words modals are full-screen), except the 3D canvas's own holder (`#viewport` is fixed and full-screen too).
 */
function benchLayerOpen(dialog: HTMLElement): boolean {
  if (dialog.querySelector(BENCH_LAYERS)) return true;
  const area = dialog.clientWidth * dialog.clientHeight;
  if (area <= 0) return false;
  for (const el of dialog.querySelectorAll<HTMLElement>("*")) {
    if (el.offsetWidth * el.offsetHeight < area * 0.6) continue;
    const cs = getComputedStyle(el);
    if (cs.position !== "fixed" || cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0 || cs.pointerEvents === "none") continue;
    if (el.querySelector("canvas")) continue;
    return true;
  }
  return false;
}

const overlayStyle = {
  position: "fixed",
  inset: 0,
  zIndex: 1000,
  background: "#102f5c", // the Workshop's blueprint blue: shown while it loads
  display: "flex",
  flexDirection: "column",
  // The benches were made on a plain page: light form controls and the browser's default type. The game's page is dark with its own body type (15 px, weight 500,
  // line height 1.5), and the benches inherit whatever the page gives them, so the dialog states the plain baseline once and everything inside inherits it.
  colorScheme: "light",
  color: "#000",
  fontSize: 16,
  fontWeight: 400,
  fontStyle: "normal",
  lineHeight: "normal",
  letterSpacing: "normal",
} as const;

/**
 * The game's global element rules that reach the benches: h1 to h3 (display font, sizes, margins) and p (margin). The benches' own reset is `:where(...)` (specificity 0),
 * so the game wins every tie. These undo only the properties the game sets, at specificity (0,0,2): above the game's element rules (0,0,1), below any class rule a
 * bench writes (0,1,0), so a bench that styles its own `.modal h2` keeps it. Checked by comparing computed styles with the standalone Workshop page (scripts in the 4d spec).
 */
const WORKSHOP_RESET_CSS = `
:where(.tv-workshop) :is(h1, h2, h3, p):is(h1, h2, h3, p) {
  margin: 0;
  font-family: revert;
  font-size: revert;
  font-weight: revert;
  line-height: revert;
}`;

const closeStyle = {
  position: "absolute",
  top: 6,
  right: 10,
  zIndex: 2,
  minHeight: 34,
  padding: "0 14px",
  borderRadius: 999,
  border: "1px solid rgba(214, 235, 255, 0.5)",
  background: "rgba(12, 39, 73, 0.9)",
  color: "#fff",
  font: "inherit",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
} as const;

const noteStyle = {
  position: "absolute",
  inset: 0,
  display: "grid",
  placeItems: "center",
  alignContent: "center",
  gap: 14,
  color: "#cfe3ff",
  fontSize: 14,
  fontWeight: 700,
  textAlign: "center",
  padding: 24,
  pointerEvents: "none",
} as const;

export function WorkshopLauncher({
  engine,
  disabled = false,
  downloads = false,
}: {
  /** The world's engine (`engineRef` of GameCanvas): paused while the Workshop is open. */
  engine: RefObject<EngineHandle | null>;
  disabled?: boolean;
  /** Files may leave the Workshop. False (the default) until the grown-up download gate is wired; true only while the grown-up checks are switched off (parentControls.ts). Read when the shell mounts. */
  downloads?: boolean;
}) {
  const downloadsRef = useRef(downloads);
  downloadsRef.current = downloads;
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");
  const [attempt, setAttempt] = useState(0);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    launcherRef.current?.focus({ preventScroll: true });
  }, []);

  // The world stands still while the Workshop has the screen, and is released however the overlay goes away.
  useEffect(() => {
    if (!open) return undefined;
    const world = engine.current;
    world?.setPaused(true);
    return () => world?.setPaused(false);
  }, [open, engine]);

  // Mount the shell into the overlay; destroy it (and free its WebGL context) on close.
  useEffect(() => {
    if (!open) return undefined;
    const host = hostRef.current;
    if (!host) return undefined;
    let cancelled = false;
    let shell: WorkshopShell | null = null;
    setPhase("loading");
    void (async () => {
      try {
        const mod = await loadWorkshopModule(attempt);
        if (cancelled) return;
        shell = mod.mountWorkshop(host, { urlSync: false, downloads: downloadsRef.current });
        if (cancelled) {
          shell.destroy();
          shell = null;
          return;
        }
        setPhase("ready");
      } catch (err) {
        console.error("Workshop failed to open", err);
        if (!cancelled) setPhase("failed");
      }
    })();
    return () => {
      cancelled = true;
      shell?.destroy();
      shell = null;
    };
  }, [open, attempt]);

  // Escape closes the dialog, unless one of the benches' own layers is open (they close themselves). Registered in the CAPTURE phase and before the shell mounts, so it
  // sees a layer as still open when its own Escape handler (the menu drawer's) runs after it, and the one key press does not close both.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.isComposing) return;
      const dialog = dialogRef.current;
      if (!dialog || benchLayerOpen(dialog)) return;
      e.preventDefault();
      e.stopPropagation(); // not also the game's own Escape handling underneath
      close();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, close]);

  // Focus goes into the dialog when it opens.
  useEffect(() => {
    if (open) dialogRef.current?.focus({ preventScroll: true });
  }, [open]);

  const overlay = open
    ? createPortal(
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Workshop" className="tv-workshop" tabIndex={-1} style={{ ...overlayStyle, outline: "none" }}>
          <style>{WORKSHOP_RESET_CSS}</style>
          {/* Close comes first in the DOM, so Tab reaches it before the benches' controls; it sits at the top right. */}
          <button type="button" style={closeStyle} onClick={close}>
            ✕ Close
          </button>
          <div ref={hostRef} style={{ flex: "1 1 auto", minHeight: 0, position: "relative" }} />
          {phase === "loading" ? (
            <div style={noteStyle} role="status">
              Opening the Workshop…
            </div>
          ) : null}
          {phase === "failed" ? (
            <div style={{ ...noteStyle, pointerEvents: "auto" }} role="alert">
              <span>The Workshop could not open. Check your connection and try again.</span>
              <button type="button" style={{ ...closeStyle, position: "static" }} onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </button>
            </div>
          ) : null}
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        className="tv-ctl"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        Workshop
      </button>
      {overlay}
    </>
  );
}
