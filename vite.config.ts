import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Cloudflare plugin runs worker/index.ts in the local Workers runtime so
// `vite dev` exercises the same /api/* and legacy redirect routes as deploy.
// Vendor chunks keep stable third-party hashes across app edits; the worker
// bundle must stay a single file (verified in build output after changes).
export default defineConfig({
  plugins: [react(), cloudflare()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes("node_modules/three")) return "three-vendor";
          if (
            id.includes("node_modules/react-dom") ||
            id.includes("node_modules/react/") ||
            id.includes("node_modules/scheduler")
          )
            return "react-vendor";
          return undefined;
        },
      },
    },
  },
});
