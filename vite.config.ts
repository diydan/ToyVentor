import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Cloudflare plugin runs worker/index.ts in the local Workers runtime so
// `vite dev` exercises the same /api/* routes the deployed app uses.
export default defineConfig({
  plugins: [
    react(),
    cloudflare(),
    {
      name: "legacy-world-redirect",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.startsWith("/world/ToyVentor-World.html")) {
            res.writeHead(302, { location: "/" });
            res.end();
            return;
          }
          next();
        });
      },
    },
  ],
});
