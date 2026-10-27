import { useState } from "react";
import { BottomBar, type TabId } from "./components/BottomBar";
import { FactoryScreen } from "./screens/FactoryScreen";
import { PlaceholderScreen } from "./screens/PlaceholderScreen";
import { ScanScreen } from "./screens/ScanScreen";
import { ToyboxScreen } from "./screens/ToyboxScreen";

// Five bottom-bar tabs (wireframe) plus Scan as a pushed screen on top of
// Toybox/Factory. Shell state, no router — revisit when deep links matter.
export default function App() {
  const [tab, setTab] = useState<TabId>("factory");
  const [scanning, setScanning] = useState(false);

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
        ) : tab === "factory" ? (
          <FactoryScreen onScan={openScan} onToybox={() => setTab("toybox")} />
        ) : tab === "toybox" ? (
          <ToyboxScreen onScan={openScan} />
        ) : tab === "packs" ? (
          <PlaceholderScreen title="Packs" day="Day 7 (seeded daily pack)" />
        ) : tab === "market" ? (
          <PlaceholderScreen title="Market" day="Day 7 (fit-filtered market)" />
        ) : (
          <PlaceholderScreen title="Play" day="Day 6 (mini game + Reveal)" />
        )}
      </main>
      <BottomBar
        tab={tab}
        onTab={(next) => {
          setScanning(false);
          setTab(next);
        }}
      />
    </div>
  );
}
