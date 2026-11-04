import { useEffect } from "react";
import {
  canAccessTier,
  type ProgressionState,
  type Tier,
} from "../../../lib/progression";
import type { MissionAction, MissionPanelSnapshot } from "./engine";

export interface MissionPanelProps {
  snapshot: MissionPanelSnapshot;
  missionId?: string | null;
  progression?: ProgressionState;
  onAction: (action: MissionAction) => void;
  onControl: (index: number) => void;
  onSelectTier?: (tier: Tier) => void;
}

const TIERS: Tier[] = [1, 2, 3];
const TIER_LABEL: Record<Tier, string> = {
  1: "Starter",
  2: "Tinker",
  3: "Engineer",
};

/** Resolve the highest accessible tier <= the engine's stored tier. */
export function resolveEffectiveMissionTier(
  engineTier: Tier,
  missionId?: string | null,
  progression?: ProgressionState,
): Tier {
  if (!missionId || !progression) return engineTier;
  if (progression.sandboxUnlockAll || canAccessTier(progression, missionId, engineTier)) {
    return engineTier;
  }
  if (canAccessTier(progression, missionId, 2)) return 2;
  return 1;
}

/**
 * Slim glass rail for the STEM missions that are played in the panel (the Gear lift and the Bridge
 * are played on the bench in the world instead, runtime/missionBench.ts). It is a narrow, see-through
 * strip at the left edge (game-hud.css) so the machine and Kip stay on screen, and it opens from a
 * small chip, not by itself.
 */
export function MissionPanel({
  snapshot,
  missionId,
  progression,
  onAction,
  onControl,
  onSelectTier,
}: MissionPanelProps) {
  const showTiers = Boolean(missionId && progression && onSelectTier);
  const engineTier: Tier = snapshot.tier;
  const effectiveTier = resolveEffectiveMissionTier(
    engineTier,
    missionId,
    progression,
  );
  const isReplayPrompt = snapshot.actionLabel === "Play again";

  // If XP was reset or Sandbox was turned off while a higher tier was saved in
  // engine state, clamp the active mission back down to an unlocked tier.
  useEffect(() => {
    if (showTiers && !isReplayPrompt && effectiveTier !== engineTier) {
      onSelectTier?.(effectiveTier);
    }
  }, [showTiers, isReplayPrompt, effectiveTier, engineTier, onSelectTier]);

  const groups: Array<{ name: string | undefined; controls: typeof snapshot.controls }> = [];
  for (const control of snapshot.controls) {
    const group = groups.find((entry) => entry.name === control.group);
    if (group) group.controls.push(control);
    else groups.push({ name: control.group, controls: [control] });
  }

  return (
    <section
      className="tv-sheet tv-sheet-mission"
      role="region"
      aria-label="Mission"
      data-mission={missionId ?? snapshot.missionId ?? undefined}
    >
      <div className="tv-sh-top" style={{ alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span className="kicker-label kicker-gold" style={{ marginBottom: 2 }}>
            Mission
          </span>
          <b className="tv-sh-title">{snapshot.title}</b>
        </div>
        <button
          type="button"
          className="tv-ctl"
          onClick={() => onAction("later")}
        >
          Later
        </button>
      </div>

      {snapshot.goal && (
        <p className="tv-moves tv-mp-goal" style={{ fontSize: 13 }}>
          {snapshot.goal}
        </p>
      )}

      {showTiers && (
        <div className="tv-mp-sb" role="group" aria-label="Difficulty tier">
          {TIERS.map((t) => {
            const open =
              progression!.sandboxUnlockAll ||
              canAccessTier(progression!, missionId!, t);
            const stars =
              progression!.missionStars[`${missionId}:t${t}`] ?? 0;
            return (
              <button
                key={t}
                type="button"
                disabled={!open}
                aria-pressed={effectiveTier === t}
                aria-label={`${TIER_LABEL[t]} tier${stars > 0 ? `, ${stars} stars` : ""}`}
                title={
                  open
                    ? `${TIER_LABEL[t]} tier`
                    : `Earn 2 stars on Tier ${t - 1} to open ${TIER_LABEL[t]}`
                }
                className={
                  effectiveTier === t ? "tv-ctl tv-ctl-gold-ring" : "tv-ctl"
                }
                onClick={() => {
                  onSelectTier?.(t);
                }}
              >
                {"★".repeat(t)}
                {"☆".repeat(3 - t)}
                <span className="tv-mp-tier-name"> {TIER_LABEL[t]}</span>
                {stars > 0 && <span className="tv-mp-tier-name">{` · ${stars}★`}</span>}
              </button>
            );
          })}
        </div>
      )}

      {snapshot.lines.map((line, index) => (
        <p
          key={`${line}-${index}`}
          style={{ margin: 0, fontSize: 14, fontWeight: 700 }}
        >
          {line}
        </p>
      ))}

      {snapshot.chips.length > 0 && (
        <div className="tv-pseq" aria-label="Mission sequence">
          {snapshot.chips.map((chip, index) => (
            <span
              key={`${chip.text}-${index}`}
              className={
                chip.question ? "tv-pseq-chip tv-pseq-q" : "tv-pseq-chip"
              }
              style={
                !chip.question && chip.background
                  ? { background: chip.background }
                  : undefined
              }
            >
              {chip.text}
            </span>
          ))}
        </div>
      )}

      {groups.map((group) => {
        const isNumberPad =
          !group.name &&
          group.controls.length >= 6 &&
          group.controls.every((c) => /^\d+$/.test(c.label));
        const [slotTitle, slotStatus] = group.name ? group.name.split(" · ") : [];

        const buttons = group.controls.map((control) => {
          const classes = ["tv-ctl"];
          if (control.primary && !control.active) classes.push("tv-ctl-sky");
          if (control.active) classes.push("tv-ctl-gold-ring");
          if (control.danger) classes.push("tv-ctl-danger");
          return (
            <button
              key={control.index}
              type="button"
              disabled={control.disabled}
              aria-pressed={control.active || undefined}
              className={classes.join(" ")}
              onClick={() => onControl(control.index)}
              style={
                !control.danger && control.borderColor
                  ? { borderColor: control.borderColor }
                  : undefined
              }
            >
              {control.label}
            </button>
          );
        });

        if (group.name) {
          return (
            <div key={group.name} className="tv-mp-slot">
              <div className="tv-mp-sn">
                <b>{slotTitle}</b>
                {slotStatus && (
                  <span style={{ color: "var(--gold)", fontSize: 13 }}>
                    {slotStatus}
                  </span>
                )}
              </div>
              <div className="tv-mp-sb" role="group" aria-label={group.name}>
                {buttons}
              </div>
            </div>
          );
        }

        return (
          <div
            key="mission-controls"
            className={isNumberPad ? "tv-cgrid" : "tv-mp-sb"}
            role="group"
            aria-label="Mission controls"
          >
            {buttons}
          </div>
        );
      })}

      <div className="tv-fg-b">
        <button
          type="button"
          className="tv-ctl tv-ctl-primary"
          onClick={() => onAction("test")}
        >
          {snapshot.actionLabel}
        </button>
        {snapshot.forgeAvailable && (
          <button
            type="button"
            className="tv-ctl"
            onClick={() => onAction("forge")}
          >
            Forge parts
          </button>
        )}
      </div>

      {snapshot.binText && <p className="tv-moves">{snapshot.binText}</p>}
    </section>
  );
}
