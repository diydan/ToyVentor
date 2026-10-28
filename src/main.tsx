import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { ToyboxProvider } from "./state/toybox";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("missing #root element");

// Offline app shell in production builds only; dev stays HMR-fresh.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      // No service worker support: the app still works online.
    });
  });
}

createRoot(rootEl).render(
  <StrictMode>
    <ToyboxProvider>
      <App />
    </ToyboxProvider>
  </StrictMode>,
);
