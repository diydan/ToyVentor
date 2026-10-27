import { defineConfig } from "vitest/config";

// Separate from vite.config.ts on purpose: unit tests cover pure shared/
// logic and must not boot the Cloudflare Workers runtime to run.
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"] },
});
