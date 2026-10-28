import { useState } from "react";
import { BottomBar, type TabId } from "./components/BottomBar";
import { FactoryScreen } from "./screens/FactoryScreen";
import { ScanScreen } from "./screens/ScanScreen";
import { AugmentScreen } from "./screens/AugmentScreen";
import { MarketScreen } from "./screens/MarketScreen";
import { PacksScreen } from "./screens/PacksScreen";
import { PlayScreen } from "./screens/PlayScreen";
import { ToyboxScreen } from "./screens/ToyboxScreen";

// The app opens on the Toybox so previous uploads and built-in assets are
// immediately available. Scan remains a pushed screen above the five tabs.
export default function App() {
  const [tab, setTab] = useState<TabId>("toybox");
  const [scanning, setScanning] = useState(false);
  const [building, setBuilding] = useState(false);

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
        ) : building ? (
          <AugmentScreen onBack={() => setBuilding(false)} />
        ) : tab === "factory" ? (
          <FactoryScreen onScan={openScan} onToybox={() => setTab("toybox")} />
        ) : tab === "toybox" ? (
          <ToyboxScreen onScan={openScan} onBuild={() => setBuilding(true)} />
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
          setTab(next);
        }}
      />
    </div>
  );
}
