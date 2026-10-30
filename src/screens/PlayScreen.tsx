import { useMemo } from "react";
import { buildStats } from "../../shared/build";
import { buildSignature } from "../../shared/reveal";
import { kipDemoUrl, toyContractFromBuild } from "../../shared/toycontract";
import { colorOf } from "../features/builder/engine/render";
import { GameCanvas } from "../features/game/world/GameCanvas";
import { loadBuild } from "../lib/builds";
import { partsById } from "../lib/catalog";
import { useToybox } from "../state/toybox";

export function PlayScreen({
  onBuild,
  onToybox,
}: {
  onBuild?: () => void;
  onToybox?: () => void;
}) {
  const { selected: toy } = useToybox();

  const placements = useMemo(
    () => (toy ? loadBuild(toy.id, partsById) : []),
    [toy],
  );
  const totals = useMemo(
    () => buildStats(placements, partsById).statTotals,
    [placements],
  );
  const contract = useMemo(
    () =>
      toy ? toyContractFromBuild(toy, placements, partsById, colorOf) : null,
    [toy, placements],
  );

  if (!toy) {
    return (
      <section style={{ padding: "var(--space-6) var(--space-4)" }}>
        <h1>Play</h1>
        <p className="lede">Pick a toy in the Toybox first.</p>
        {onToybox && (
          <button type="button" className="cta" onClick={onToybox}>
            Open Toybox
          </button>
        )}
      </section>
    );
  }

  const leadPart = placements[0]
    ? partsById.get(placements[0].partId)
    : undefined;
  const toyColor = leadPart ? colorOf(leadPart) : "#52b7ff";
  const statEntries = Object.entries(totals).filter(([, v]) => v > 0);
  const statSummary =
    statEntries.length > 0
      ? statEntries.map(([k, v]) => `${k} +${v}`).join(" · ")
      : undefined;

  return (
    <GameCanvas
      contract={contract}
      toyName={toy.name}
      toyColor={toyColor}
      statSummary={statSummary}
      themeSignature={
        placements.length > 0 ? buildSignature(placements) : undefined
      }
      kipUrl={contract && toy.kind === "figure" ? kipDemoUrl(contract) : undefined}
      onBuild={onBuild}
    />
  );
}
