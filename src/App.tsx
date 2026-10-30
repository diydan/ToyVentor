import { useEffect, useRef, useState } from "react";
import { pullOwnership, pushOwnership } from "./lib/sync";
import { useToybox } from "./state/toybox";
import { validateToy, type Toy } from "../shared/toy";
import { BottomBar, type TabId } from "./components/BottomBar";
import { ScanScreen } from "./screens/ScanScreen";
import { AugmentScreen } from "./screens/AugmentScreen";
import { PacksScreen } from "./screens/PacksScreen";
import { PlayScreen } from "./screens/PlayScreen";
import { RevealScreen } from "./screens/RevealScreen";
import { ToyboxScreen } from "./screens/ToyboxScreen";

// The app opens on the Toybox so previous uploads and built-in assets are
// immediately available. Scan and Reveal push above the four main tabs.
export default function App() {
  const { toys, addToy } = useToybox();
  const syncedRef = useRef(false);

  // One ownership sync per load: pull server toys we do not have, push
  // local ones the server does not. Best-effort in both directions.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [tab, setTab] = useState<TabId>(() => {
    try {
      const q = new URLSearchParams(window.location.search).get("tab");
      if (q === "toybox" || q === "build" || q === "packs" || q === "play") {
        return q;
      }
      if (q === "market") return "build";
      if (q === "factory") return "toybox";
    } catch {
      /* ignore */
    }
    return "toybox";
  });
  const [scanning, setScanning] = useState(false);
  const [reveal, setReveal] = useState<{ first: boolean } | null>(null);

  const openScan = () => {
    setReveal(null);
    setScanning(true);
  };
  const closeScan = () => setScanning(false);
  const finishScan = () => {
    setScanning(false);
    setTab("build");
  };
  const goToTab = (next: TabId) => {
    setScanning(false);
    setReveal(null);
    setTab(next);
  };

  const isPlayStage = !scanning && !reveal && tab === "play";

  return (
    <div className={isPlayStage ? "app app-play" : "app"}>
      <main className={isPlayStage ? "screen screen-play" : "screen"}>
        {scanning ? (
          <ScanScreen onDone={finishScan} onCancel={closeScan} />
        ) : reveal ? (
          <RevealScreen
            firstReveal={reveal.first}
            onBack={() => setReveal(null)}
            onPlay={() => goToTab("play")}
          />
        ) : tab === "toybox" ? (
          <ToyboxScreen
            onScan={openScan}
            onBuild={() => goToTab("build")}
            onPlay={() => goToTab("play")}
            onReveal={() => setReveal({ first: false })}
          />
        ) : tab === "build" ? (
          <AugmentScreen
            onBack={() => goToTab("toybox")}
            onPlay={() => goToTab("play")}
            onFinish={(first) => setReveal({ first })}
          />
        ) : tab === "packs" ? (
          <PacksScreen
            onBuild={() => goToTab("build")}
            onPlay={() => goToTab("play")}
          />
        ) : (
          <PlayScreen
            onBuild={() => goToTab("build")}
            onToybox={() => goToTab("toybox")}
          />
        )}
      </main>
      {!reveal && <BottomBar tab={tab} onTab={goToTab} />}
    </div>
  );
}
