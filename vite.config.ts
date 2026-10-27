import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Cloudflare plugin runs worker/index.ts in the local Workers runtime so
// `vite dev` exercises the same /api/* routes the deployed app uses.
export default defineConfig({
  plugins: [react(), cloudflare()],
});
