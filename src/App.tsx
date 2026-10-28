import { useEffect, useRef, useState } from "react";
import { pullOwnership, pushOwnership } from "./lib/sync";
import { useToybox } from "./state/toybox";
import { validateToy, type Toy } from "../shared/toy";
import { BottomBar, type TabId } from "./components/BottomBar";
import { FactoryScreen } from "./screens/FactoryScreen";
import { ScanScreen } from "./screens/ScanScreen";
import { AugmentScreen } from "./screens/AugmentScreen";
import { MarketScreen } from "./screens/MarketScreen";
import { PacksScreen } from "./screens/PacksScreen";
import { PlayScreen } from "./screens/PlayScreen";
import { RevealScreen } from "./screens/RevealScreen";
import { ToyboxScreen } from "./screens/ToyboxScreen";

// The app opens on the Toybox so previous uploads and built-in assets are
// immediately available. Scan remains a pushed screen above the five tabs.
export default function App() {
  const { toys, addToy } = useToybox();
  const syncedRef = useRef(false);

  // One ownership sync per load: pull server toys we don't have, push
  // local ones the server doesn't. Best-effort in both directions.
  useEffect(() => {
    if (syncedRef.current) return;
    syncedRef.current = true;
    void (async () => {
      const remote = await pullOwnership();
      if (!remote) return;
      const localIds = new Set(toys.map((t) => t.id));
      const remoteToyIds = new Set<string>();
      for (const record of remote) {
        if (record.type !== "toy") continue;
        remoteToyIds.add(record.id);
        if (!localIds.has(record.id) && validateToy(record.payload).length === 0)
          addToy(record.payload as Toy);
      }
      for (const toy of toys) {
        if (!remoteToyIds.has(toy.id))
          void pushOwnership({ type: "toy", id: toy.id, payload: toy });
      }
    })();
    // Initial toys only: this is a load-time reconcile, not a subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [tab, setTab] = useState<TabId>("toybox");
  const [scanning, setScanning] = useState(false);
  const [building, setBuilding] = useState(false);
  const [reveal, setReveal] = useState<{ first: boolean } | null>(null);

  const openScan = () => setScanning(true);
  const closeScan = () => setScanning(false);
  const finishScan = () => {
    setScanning(false);
    setTab("toybox");
  };

  return (
    <div className="app">
      <main className="screen">
        {scanning ? (
          <ScanScreen onDone={finishScan} onCancel={closeScan} />
        ) : reveal ? (
          <RevealScreen firstReveal={reveal.first} onBack={() => setReveal(null)} />
        ) : building ? (
          <AugmentScreen
            onBack={() => setBuilding(false)}
            onFinish={(first) => { setBuilding(false); setReveal({ first }); }}
          />
        ) : tab === "factory" ? (
          <FactoryScreen onScan={openScan} onToybox={() => setTab("toybox")} />
        ) : tab === "toybox" ? (
          <ToyboxScreen
            onScan={openScan}
            onBuild={() => setBuilding(true)}
            onReveal={() => setReveal({ first: false })}
          />
        ) : tab === "packs" ? (
          <PacksScreen onBuild={() => setBuilding(true)} />
        ) : tab === "market" ? (
          <MarketScreen onBuild={() => setBuilding(true)} />
        ) : (
          <PlayScreen onBuild={() => setBuilding(true)} />
        )}
      </main>
      <BottomBar
        tab={tab}
        onTab={(next) => {
          setScanning(false);
          setBuilding(false);
          setReveal(null);
          setTab(next);
        }}
      />
    </div>
  );
}
