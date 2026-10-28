import { useMemo, useState } from "react";
import baseSetJson from "../../sets/base.json";
import { dailyPack } from "../../shared/pack";
import type { ToySet } from "../../shared/part";
import { PartCard } from "../components/PartCard";
import { useToybox } from "../state/toybox";

const baseSet = baseSetJson as ToySet;
const KEY = "toyforge:pack-claimed";

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function PacksScreen({ onBuild }: { onBuild?: () => void }) {
  const { selected: toy } = useToybox();
  const today = todayISO();
  const pack = useMemo(() => dailyPack(baseSet.parts, today), [today]);
  const [opened, setOpened] = useState<boolean>(() => {
    try { return localStorage.getItem(KEY) === today; } catch { return false; }
  });

  const open = () => {
    try { localStorage.setItem(KEY, today); } catch { /* still open below */ }
    setOpened(true);
  };

  return (
    <section>
      <h1>Packs</h1>
      <p className="lede">One pack a day. Three parts, one you can print.</p>
      {!opened ? (
        <button type="button" className="cta" onClick={open}>
          Rip today's pack
        </button>
      ) : (
        <>
          <p className="fine-print" style={{ marginTop: 0 }}>
            Today's pack. A new one lands tomorrow — same pack for everyone, seeded by date.
          </p>
          {toy
            ? pack.map((part) => <PartCard key={part.id} part={part} toy={toy} />)
            : pack.map((part) => (
                <p key={part.id}><strong>{part.name}</strong> — {part.stat.name} +{part.stat.value}</p>
              ))}
          {onBuild && toy && (
            <button type="button" className="cta" onClick={onBuild}>
              Build with today's parts
            </button>
          )}
        </>
      )}
    </section>
  );
}
