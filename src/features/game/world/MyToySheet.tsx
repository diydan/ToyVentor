import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  FIT_QUESTION,
  FIT_VARIANTS,
  type FitChoice,
} from "../../../../shared/calibration";
import {
  sizeClassForLength,
  toyFromScanInput,
  type Toy,
  type ToyKind,
} from "../../../../shared/toy";
import { postSamScan } from "../../../lib/api";
import { loadBuild } from "../../../lib/builds";
import { partsById } from "../../../lib/catalog";
import {
  conceptBadgesFor,
  dailyQuestsForDay,
  workshopDaysCount,
  type DailyQuest,
} from "../../../lib/dailyQuests";
import {
  nextRankProgress,
  type ProgressionState,
} from "../../../lib/progression";
import { pushOwnership } from "../../../lib/sync";
import {
  canonicalToyName,
  loadFitChoice,
  saveFitChoice,
} from "../../../lib/toyRoster";
import { revealsForToy } from "../../../state/reveals";
import { useToybox } from "../../../state/toybox";
import { colorOf } from "../../builder/engine/render";
import { downscalePhoto, submitScan } from "../../scan/scan";
import { SkinPanel } from "../../skin/SkinPanel";
import {
  resolvePhase4VehicleRoster,
  type LockedVehicleCard,
} from "../../../lib/vehicleReadiness";
import { ToyMiniIcon } from "./ToyMiniIcon";

type ObjectChipId = "car" | "figure" | "cup" | "bottle" | "other";

const OBJECT_CHIPS: ReadonlyArray<{
  id: ObjectChipId;
  label: string;
  prompt: string;
  kind: ToyKind;
}> = [
  { id: "car", label: "Car", prompt: "car", kind: "car" },
  { id: "figure", label: "Figure", prompt: "figure", kind: "figure" },
  { id: "cup", label: "Cup", prompt: "cup", kind: "other" },
  { id: "bottle", label: "Bottle", prompt: "bottle", kind: "other" },
  { id: "other", label: "Other", prompt: "toy", kind: "other" },
];

const SIZE_PRESETS: ReadonlyArray<{
  id: "S" | "M" | "L";
  label: string;
  lengthMm: number;
  widthMm: number;
}> = [
  { id: "S", label: "S", lengthMm: 75, widthMm: 45 },
  { id: "M", label: "M", lengthMm: 110, widthMm: 55 },
  { id: "L", label: "L", lengthMm: 180, widthMm: 90 },
];

function accentForRosterToy(toy: Toy, firstPartColor?: string): string {
  if (firstPartColor) return firstPartColor;
  if (toy.id === "seed-kip") return "#ffd24d";
  if (toy.id === "seed-car" || toy.kind === "car") return "#ff5a4d";
  if (toy.source === "scan") return "#5af0b0";
  return "#52b7ff";
}

function loadoutCaptionForToy(toy: Toy, partNames: readonly string[]): string {
  if (partNames.length === 1) return partNames[0]!;
  if (partNames.length === 2) return `${partNames[0]} + ${partNames[1]}`;
  if (partNames.length > 2) {
    return `${partNames[0]} + ${partNames.length - 1} more`;
  }
  if (toy.id === "seed-kip") return "Full 8-slot wardrobe";
  if (toy.id === "seed-car") return "Racer Garage roadster";
  if (toy.id === "seed-figure") return "Saved starter figure";
  return `${toy.lengthMm} mm (${toy.sizeClass}) · Ready to build`;
}

function LabBotAvatarSvg() {
  return (
    <svg viewBox="0 0 36 36" width="34" height="34" aria-hidden="true">
      <rect
        x="7"
        y="9"
        width="22"
        height="18"
        rx="6"
        fill="#1b2b6b"
        stroke="#5af0b0"
        strokeWidth="2"
      />
      <line
        x1="18"
        y1="4"
        x2="18"
        y2="9"
        stroke="#5af0b0"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <circle cx="18" cy="3.8" r="2.2" fill="#ffd24d" />
      <circle cx="13.5" cy="17.5" r="2.3" fill="#5af0b0" />
      <circle cx="22.5" cy="17.5" r="2.3" fill="#5af0b0" />
      <path
        d="M14 22.2 H22"
        stroke="#bfe3ff"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function LabPrinterAvatarSvg() {
  return (
    <svg viewBox="0 0 36 36" width="34" height="34" aria-hidden="true">
      <rect
        x="6"
        y="6"
        width="24"
        height="24"
        rx="5"
        fill="#1b2b6b"
        stroke="#52b7ff"
        strokeWidth="2"
      />
      <line x1="10" y1="12" x2="26" y2="12" stroke="#8fa8ff" strokeWidth="1.8" />
      <polygon points="16,12 20,12 18,16.5" fill="#ffd24d" />
      <rect x="12.5" y="18.5" width="11" height="5.5" rx="1.6" fill="#ff5a4d" />
      <line x1="9.5" y1="25.5" x2="26.5" y2="25.5" stroke="#5af0b0" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export function MyToySheet({
  open,
  initialStep = "shelf",
  progression,
  localDayKey,
  missionsDoneCount = 0,
  skinVersion = 0,
  onClose,
  onSkinChange,
  onOpenBuild,
  onPlayLab,
  onJumpToWorld,
  onOpenCharacterCard,
}: {
  open: boolean;
  initialStep?: "shelf" | "scan";
  progression?: ProgressionState;
  localDayKey?: string;
  missionsDoneCount?: number;
  skinVersion?: number;
  onClose: () => void;
  onSkinChange?: () => void;
  onOpenBuild?: () => void;
  onPlayLab?: (card: LockedVehicleCard) => void;
  onJumpToWorld?: (worldId: string) => void;
  onOpenCharacterCard?: () => void;
}) {
  const { uploadedToys, builtInToys, selected, addToy, selectToy } = useToybox();
  const [step, setStep] = useState<"shelf" | "scan">(initialStep);
  const [fitChoice, setFitChoice] = useState<FitChoice>(() => loadFitChoice());

  useEffect(() => {
    if (open) {
      setStep(initialStep);
      setFitChoice(loadFitChoice());
    }
  }, [open, initialStep]);

  const [chipId, setChipId] = useState<ObjectChipId>("car");
  const [customNoun, setCustomNoun] = useState("toy");
  const [name, setName] = useState("");
  const [lengthMm, setLengthMm] = useState(110);
  const [widthMm, setWidthMm] = useState(55);
  const [photo, setPhoto] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const renderLockedCard = (card: LockedVehicleCard) => (
    <div
      key={card.entry.id}
      className="tv-roster-card tv-roster-card-lock"
      role="option"
      aria-selected={false}
      aria-disabled="true"
      aria-label={`${card.entry.name}, locked. ${card.guidance}`}
    >
      <div className="tv-roster-card-main">
        <ToyMiniIcon
          toy={card.toy}
          accentColor={accentForRosterToy(card.toy)}
          skinVersion={skinVersion}
          size="tile"
        />
        <span className="tv-roster-card-copy">
          <span className="tv-roster-card-head">
            <span className="tv-toy-tile-name">{card.entry.name}</span>
            <span className="tv-toy-tag tv-roster-inline-tag">
              {card.entry.xpThreshold} XP · Rank {card.entry.rank}
            </span>
          </span>
          <span className="tv-toy-tile-sub">{card.guidance}</span>
        </span>
      </div>
      {onPlayLab && (
        <button
          type="button"
          className="tv-ctl tv-roster-card-act"
          onClick={() => onPlayLab(card)}
        >
          Play a STEM Lab
        </button>
      )}
    </div>
  );

  // Hooks must all sit above the early return: any hook placed below
  // `if (!open) return null` runs only when the sheet opens, which
  // changes the hook count between renders and unmounts the app.
  const phase4 = useMemo<{
    unlockedVehicles: Toy[];
    lockedVehicles: LockedVehicleCard[];
  }>(
    () =>
      progression
        ? resolvePhase4VehicleRoster(progression, {
            activeToyId: selected?.id,
          })
        : { unlockedVehicles: [], lockedVehicles: [] },
    // selected?.id seeds grandfathering; the object identity is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [progression, selected?.id],
  );
  const phase4Unlocked = useMemo(
    () =>
      phase4.unlockedVehicles.filter(
        (v) => !builtInToys.some((t) => t.id === v.id),
      ),
    [phase4, builtInToys],
  );
  const dailyQuests = useMemo<DailyQuest[]>(
    () =>
      progression && localDayKey
        ? dailyQuestsForDay(localDayKey, progression)
        : [],
    [progression, localDayKey],
  );
  const conceptBadges = useMemo(
    () => (progression ? conceptBadgesFor(progression) : []),
    [progression],
  );

  if (!open) return null;

  const activeChip =
    OBJECT_CHIPS.find((c) => c.id === chipId) ?? OBJECT_CHIPS[0]!;
  const kind: ToyKind = activeChip.kind;
  const prompt = (chipId === "other" ? customNoun : activeChip.prompt).trim() || "toy";
  const sizeClass = sizeClassForLength(lengthMm);

  const starterCharacters = builtInToys.filter((t) => t.kind !== "car");
  const starterVehicles = builtInToys.filter((t) => t.kind === "car");
  const allEnabledToys = [...starterCharacters, ...starterVehicles, ...uploadedToys];

  let totalSavedParts = 0;
  let savedBuildsCount = 0;
  for (const t of allEnabledToys) {
    const count = loadBuild(t.id, partsById).length;
    if (count > 0) {
      totalSavedParts += count;
      savedBuildsCount += 1;
    }
  }

  const activeFitVariant =
    FIT_VARIANTS.find((v) => v.id === fitChoice) ?? FIT_VARIANTS[1];

  const handleChooseFit = (choice: FitChoice) => {
    setFitChoice(choice);
    saveFitChoice(choice);
  };

  const saveScannedToy = (toy: Toy) => {
    addToy(toy);
    void pushOwnership({ type: "toy", id: toy.id, payload: toy });
  };

  const onPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setPhoto(await downscalePhoto(file));
      setError(null);
    } catch {
      setError("Could not read that photo. You can still save without AI outline.");
    }
  };

  const outlineWithSam = async () => {
    if (!photo) return;
    setBusy(true);
    setError(null);
    try {
      const result = await postSamScan({
        id: crypto.randomUUID(),
        name: name.trim() || "My toy",
        kind,
        lengthMm,
        prompt,
        imageDataUrl: photo,
      });
      if (result.toy && result.sam.applied) {
        saveScannedToy({ ...result.toy, imageDataUrl: photo });
        setBusy(false);
        onClose();
        return;
      }
      setError(
        result.sam.status === "no-match"
          ? `Meta SAM 3.1 found no "${prompt}" in that photo. Try another chip or save without AI outline.`
          : result.sam.status === "not-configured"
            ? "Meta SAM 3.1 is not configured on this server yet. Save without AI outline below."
            : `Meta SAM 3.1 could not outline that photo${result.sam.message ? `: ${result.sam.message}` : ""}. Save without AI outline below.`,
      );
    } catch {
      setError("Meta SAM 3.1 request did not reach the server. Save without AI outline below.");
    }
    setBusy(false);
  };

  const saveManual = async () => {
    setBusy(true);
    setError(null);
    const toy = toyFromScanInput({
      id: crypto.randomUUID(),
      name: name.trim() || "My toy",
      kind,
      lengthMm,
      widthMm,
      source: "manual",
      imageDataUrl: photo,
    });
    await submitScan(toy, prompt);
    saveScannedToy(toy);
    setBusy(false);
    onClose();
  };

  const pickStarterBackup = (toyId: string) => {
    const found = builtInToys.find((t) => t.id === toyId);
    if (found) {
      selectToy(found.id);
      onClose();
    }
  };

  const renderToyCard = (toy: Toy, sectionKind: "character" | "vehicle" | "my-toy") => {
    const isSelected = toy.id === selected?.id;
    const placements = loadBuild(toy.id, partsById);
    const partNames = placements
      .map((pl) => partsById.get(pl.partId)?.name)
      .filter((n): n is string => Boolean(n));
    const firstPart = placements[0]
      ? partsById.get(placements[0].partId)
      : undefined;
    const firstPartColor = firstPart ? colorOf(firstPart) : undefined;
    const accent = accentForRosterToy(toy, firstPartColor);
    const earnedCards = sectionKind === "character" ? revealsForToy(toy.id) : [];
    const ownerTag =
      sectionKind === "my-toy"
        ? toy.source === "scan"
          ? "SAM Scan"
          : "My Toy"
        : earnedCards.length > 0
          ? "Card Earned"
          : null;
    const displayName = canonicalToyName(toy);

    return (
      <div
        key={toy.id}
        className={
          isSelected
            ? "tv-roster-card tv-roster-card-on"
            : "tv-roster-card"
        }
      >
        <button
          type="button"
          role="option"
          aria-selected={isSelected}
          className="tv-roster-card-main"
          onClick={() => selectToy(toy.id)}
        >
          <ToyMiniIcon
            toy={toy}
            accentColor={accent}
            skinVersion={skinVersion}
            size="tile"
          />
          <span className="tv-roster-card-copy">
            <span className="tv-roster-card-head">
              <span className="tv-toy-tile-name">{displayName}</span>
              {isSelected && (
                <span className="tv-toy-tag tv-toy-tag-gold tv-roster-inline-tag">
                  Active
                </span>
              )}
              {!isSelected && ownerTag && (
                <span className="tv-toy-tag tv-roster-inline-tag">
                  {ownerTag}
                </span>
              )}
            </span>
            <span className="tv-toy-tile-sub">
              {loadoutCaptionForToy(toy, partNames)}
            </span>
          </span>
        </button>
        {earnedCards.length > 0 && onOpenCharacterCard && (
          <button
            type="button"
            className="tv-ctl tv-roster-card-act"
            onClick={() => {
              selectToy(toy.id);
              onClose();
              onOpenCharacterCard();
            }}
          >
            Card
          </button>
        )}
      </div>
    );
  };

  return (
    <section
      className="tv-sheet"
      role="dialog"
      aria-label={step === "scan" ? "Scan Real Toy" : "Toy Box"}
    >
      {step === "shelf" ? (
        <>
          <div className="tv-sh-top">
            <b className="tv-sh-title">Toy Box</b>
            <button
              type="button"
              className="tv-ctl tv-ctl-primary"
              onClick={onClose}
            >
              Done
            </button>
          </div>

          {progression &&
            (() => {
              const progress = nextRankProgress(progression.totalXp);
              return (
                <div className="tv-rank-progress">
                  <span>
                    ★ {progress.rank.title}
                    {progress.next
                      ? ` · ${progress.into}/${progress.span} to ${progress.next.title}`
                      : " · Top rank"}
                  </span>
                  <div className="theme-progress" aria-hidden="true">
                    <div
                      className="theme-progress-fill"
                      style={{ width: `${progress.pct}%` }}
                    />
                  </div>
                </div>
              );
            })()}

          {progression && dailyQuests.length > 0 && (
            <div className="tv-roster-group" aria-label="Daily Quest Board">
              <div className="tv-roster-group-head">
                <span className="tv-roster-group-k">Today&apos;s Jobs</span>
                <span className="tv-roster-group-meta">
                  {dailyQuests.filter((q) => q.completed).length}/
                  {dailyQuests.length} done
                  {workshopDaysCount(progression) > 0
                    ? ` · Workshop Day ${workshopDaysCount(progression)}`
                    : ""}
                </span>
              </div>
              <div className="tv-quest-board">
                {dailyQuests.map((quest) => (
                  <div
                    key={quest.id}
                    className={
                      quest.completed
                        ? "tv-quest-card tv-quest-card-done"
                        : "tv-quest-card"
                    }
                  >
                    <span className="tv-quest-check" aria-hidden="true">
                      {quest.completed ? "✓" : "•"}
                    </span>
                    <span className="tv-quest-copy">
                      <span className="tv-roster-card-head">
                        <span className="tv-toy-tile-name">{quest.title}</span>
                        <span className="tv-toy-tag tv-roster-inline-tag">
                          {quest.completed
                            ? `+${quest.xpBonus} XP earned`
                            : `+${quest.xpBonus} XP`}
                        </span>
                      </span>
                      <span className="tv-toy-tile-sub">{quest.goal}</span>
                    </span>
                    {!quest.completed && onJumpToWorld && (
                      <button
                        type="button"
                        className="tv-ctl tv-roster-card-act"
                        onClick={() => onJumpToWorld(quest.worldId)}
                      >
                        Go · {quest.worldLabel}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div
            className="tv-roster-sections"
            role="listbox"
            aria-label="Owned toys"
          >
            <div className="tv-roster-group">
              <span className="tv-roster-group-k">Characters</span>
              <div className="tv-roster-grid">
                {starterCharacters.map((toy) => renderToyCard(toy, "character"))}
              </div>
            </div>

            <div className="tv-roster-group">
              <span className="tv-roster-group-k">Vehicles</span>
              <div className="tv-roster-grid">
                {starterVehicles.map((toy) => renderToyCard(toy, "vehicle"))}
                {phase4Unlocked.map((toy) => renderToyCard(toy, "vehicle"))}
              </div>
            </div>

            {phase4.lockedVehicles.length > 0 && (
              <div className="tv-roster-group">
                <span className="tv-roster-group-k">Locked</span>
                <div className="tv-roster-grid">
                  {phase4.lockedVehicles.map((card) => renderLockedCard(card))}
                </div>
              </div>
            )}

            <div className="tv-roster-group">
              <div className="tv-roster-group-head">
                <span className="tv-roster-group-k">My Toys</span>
                <span className="tv-roster-group-meta">
                  {uploadedToys.length > 0
                    ? `${uploadedToys.length} scanned`
                    : "Bring a real toy in"}
                </span>
              </div>
              {uploadedToys.length > 0 && (
                <div className="tv-roster-grid">
                  {uploadedToys.map((toy) => renderToyCard(toy, "my-toy"))}
                </div>
              )}
              <button
                type="button"
                className="cta"
                style={{ margin: 0, minHeight: 46, fontSize: 15 }}
                onClick={() => {
                  setError(null);
                  setStep("scan");
                }}
              >
                Scan a Real Toy (Meta SAM 3.1)
              </button>
            </div>
          </div>

          {selected?.imageDataUrl && (
            <details className="tv-disclosure">
              <summary>
                <span>Paint photo skin (Meta Muse)</span>
                <span className="tv-disclosure-meta">4 styles</span>
              </summary>
              <SkinPanel
                key={selected.id}
                toy={selected}
                onSkinChange={onSkinChange}
              />
            </details>
          )}

          <div className="tv-companion-grid" aria-label="Workshop status">
            <div className="tv-companion-card">
              <span className="tv-companion-avatar">
                <LabBotAvatarSvg />
              </span>
              <div className="tv-companion-copy">
                <b className="tv-toy-tile-name">Lab Bots</b>
                <span className="tv-toy-tile-sub">
                  {missionsDoneCount > 0
                    ? `${missionsDoneCount} lab${missionsDoneCount === 1 ? "" : "s"} solved`
                    : "6 STEM labs ready"}
                </span>
              </div>
            </div>

            {onOpenBuild ? (
              <button
                type="button"
                className="tv-companion-card"
                onClick={() => {
                  onClose();
                  onOpenBuild();
                }}
              >
                <span className="tv-companion-avatar">
                  <LabPrinterAvatarSvg />
                </span>
                <span className="tv-companion-copy">
                  <b className="tv-toy-tile-name">Lab Kit Printer</b>
                  <span className="tv-toy-tile-sub">
                    {totalSavedParts > 0
                      ? `${totalSavedParts} part${totalSavedParts === 1 ? "" : "s"} in ${savedBuildsCount} build${savedBuildsCount === 1 ? "" : "s"}`
                      : "Snap-fit STL kit · Build"}
                  </span>
                </span>
              </button>
            ) : (
              <div className="tv-companion-card">
                <span className="tv-companion-avatar">
                  <LabPrinterAvatarSvg />
                </span>
                <div className="tv-companion-copy">
                  <b className="tv-toy-tile-name">Lab Kit Printer</b>
                  <span className="tv-toy-tile-sub">
                    {totalSavedParts > 0
                      ? `${totalSavedParts} part${totalSavedParts === 1 ? "" : "s"} in ${savedBuildsCount} build${savedBuildsCount === 1 ? "" : "s"}`
                      : "Snap-fit STL kit ready"}
                  </span>
                </div>
              </div>
            )}
          </div>

          {progression && conceptBadges.length > 0 && (
            <details
              className="tv-disclosure"
              open={conceptBadges.some((b) => b.earned)}
            >
              <summary>
                <span>STEM Concept Badges</span>
                <span className="tv-disclosure-meta">
                  {conceptBadges.filter((b) => b.earned).length}/
                  {conceptBadges.length} earned
                </span>
              </summary>
              <div
                className="tv-badge-strip"
                style={{ marginTop: 8 }}
                aria-label="STEM Concept Badges"
              >
                {conceptBadges.map((badge) => {
                  const cls = !badge.earned
                    ? "tv-badge-pill tv-badge-pill-locked"
                    : badge.bestStars >= 3
                      ? "tv-badge-pill tv-badge-pill-master"
                      : "tv-badge-pill";
                  const starsLabel = badge.earned
                    ? "★".repeat(badge.bestStars)
                    : "☆";
                  return onJumpToWorld ? (
                    <button
                      key={badge.id}
                      type="button"
                      className={cls}
                      title={`${badge.title} (${badge.tierLabel})`}
                      onClick={() => onJumpToWorld(badge.worldId)}
                    >
                      <span>{badge.shortLabel}</span>
                      <span className="tv-badge-stars">{starsLabel}</span>
                    </button>
                  ) : (
                    <span
                      key={badge.id}
                      className={cls}
                      title={`${badge.title} (${badge.tierLabel})`}
                    >
                      <span>{badge.shortLabel}</span>
                      <span className="tv-badge-stars">{starsLabel}</span>
                    </span>
                  );
                })}
              </div>
            </details>
          )}

          <details className="tv-disclosure tv-forge-mount-row">
            <summary>
              <span>Forge Mount fit</span>
              <span className="tv-disclosure-meta">
                {activeFitVariant.label} · {"•".repeat(activeFitVariant.dots)}
              </span>
            </summary>
            <div className="tv-forge-mount-body">
              <p className="tv-moves">{FIT_QUESTION}</p>
              <div className="tv-chips" role="group" aria-label="Forge Mount fit">
                {FIT_VARIANTS.map((variant) => (
                  <button
                    key={variant.id}
                    type="button"
                    className="tv-sc"
                    aria-pressed={fitChoice === variant.id}
                    onClick={() => handleChooseFit(variant.id)}
                  >
                    {"•".repeat(variant.dots)} {variant.label}
                  </button>
                ))}
              </div>
              <a
                className="tv-link"
                href="/parts-stl/forge-mount-first-print.stl"
                download="forge-mount-first-print.stl"
              >
                Download Forge Mount test strip (.stl)
              </a>
            </div>
          </details>
        </>
      ) : (
        <>
          <div className="tv-sh-top">
            <b className="tv-sh-title">Scan Real Toy</b>
            <button
              type="button"
              className="tv-ctl"
              onClick={() => setStep("shelf")}
            >
              Toy Box
            </button>
          </div>

          <label className="scan-cam tv-scan-cam">
            <input
              type="file"
              accept="image/*"
              capture="environment"
              aria-label="Toy photo"
              onChange={onPhoto}
              style={{
                position: "absolute",
                width: 1,
                height: 1,
                opacity: 0,
                pointerEvents: "none",
              }}
            />
            {photo ? (
              <>
                <img src={photo} alt="Your toy" />
                <span
                  className="tv-ctl"
                  style={{ position: "absolute", right: 8, bottom: 8 }}
                >
                  Retake
                </span>
              </>
            ) : (
              <>
                <div className="scan-reticle" style={{ width: 156, height: 62 }}>
                  Tap to snap toy photo
                </div>
                <span className="tv-moves">
                  Meta SAM 3.1 finds the outline automatically
                </span>
              </>
            )}
          </label>

          <div className="tv-chips" role="group" aria-label="Object type">
            {OBJECT_CHIPS.map((chip) => (
              <button
                key={chip.id}
                type="button"
                className="tv-sc"
                aria-pressed={chipId === chip.id}
                onClick={() => setChipId(chip.id)}
              >
                {chip.label}
              </button>
            ))}
          </div>

          {chipId === "other" && (
            <input
              className="tv-input"
              value={customNoun}
              maxLength={32}
              placeholder="One-word object noun (e.g. dinosaur, train)"
              aria-label="Object noun"
              onChange={(e) => setCustomNoun(e.target.value)}
            />
          )}

          <div className="tv-scan-size-row">
            <input
              className="tv-input tv-grow"
              value={name}
              maxLength={48}
              placeholder="Toy name (optional)"
              aria-label="Toy name"
              onChange={(e) => setName(e.target.value)}
            />
            <div className="tv-seg" role="group" aria-label="Size preset">
              {SIZE_PRESETS.map((preset) => {
                const active =
                  Math.abs(lengthMm - preset.lengthMm) <= 12 &&
                  sizeClassForLength(preset.lengthMm) === sizeClass;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className="tv-sc"
                    style={{ minWidth: 38, padding: "0 10px" }}
                    aria-pressed={active}
                    onClick={() => {
                      setLengthMm(preset.lengthMm);
                      setWidthMm(preset.widthMm);
                    }}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          <details className="tv-disclosure">
            <summary>
              <span>Exact size in mm</span>
              <span className="tv-disclosure-meta">
                {lengthMm}×{widthMm} mm ({sizeClass})
              </span>
            </summary>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
              <label className="tv-moves" style={{ display: "block" }}>
                Longest side: <strong style={{ color: "var(--ink)" }}>{lengthMm} mm</strong>
                <input
                  type="range"
                  min={40}
                  max={300}
                  step={5}
                  value={lengthMm}
                  onChange={(e) => setLengthMm(Number(e.target.value))}
                  style={{ width: "100%", accentColor: "var(--sky-500)" }}
                />
              </label>
              <label className="tv-moves" style={{ display: "block" }}>
                Width: <strong style={{ color: "var(--ink)" }}>{widthMm} mm</strong>
                <input
                  type="range"
                  min={20}
                  max={200}
                  step={5}
                  value={widthMm}
                  onChange={(e) => setWidthMm(Number(e.target.value))}
                  style={{ width: "100%", accentColor: "var(--sky-500)" }}
                />
              </label>
            </div>
          </details>

          {error && <p className="error" style={{ margin: 0, fontSize: 13 }}>{error}</p>}

          <button
            type="button"
            className="cta"
            style={{ margin: 0, minHeight: 48, fontSize: 16 }}
            disabled={busy || !photo}
            onClick={outlineWithSam}
          >
            {busy
              ? "Outlining with Meta SAM 3.1..."
              : photo
                ? "Outline with Meta SAM 3.1"
                : "Snap a photo to outline with Meta SAM 3.1"}
          </button>

          <button
            type="button"
            className="cta cta-quiet"
            style={{ margin: 0, minHeight: 38, fontSize: 13 }}
            disabled={busy}
            onClick={saveManual}
          >
            Save without AI outline
          </button>

          <div className="tv-backup-strip">
            <span>No camera handy?</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {builtInToys.map((starter) => (
                <button
                  key={starter.id}
                  type="button"
                  className="tv-ctl"
                  style={{ minHeight: 32, padding: "0 9px", fontSize: 12 }}
                  onClick={() => pickStarterBackup(starter.id)}
                >
                  {canonicalToyName(starter)}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
