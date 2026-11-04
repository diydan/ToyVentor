import { defineConfig } from "vitest/config";

// Separate from vite.config.ts on purpose: unit tests cover pure shared/
// logic and must not boot the Cloudflare Workers runtime to run.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // A test here does real numerical work, and some of it is slow: 600 generated
    // wishes each checked four ways, a tempo read from drum tracks at every tempo
    // from 75 to 160, a downbeat found in each clip, and a clip swept for feet
    // sliding on the floor. The slowest of them take 1 to 3 s on an idle machine,
    // which is well inside Vitest's 5 s default - but that default leaves no room
    // at all, and this repo is developed on a box that other work shares, so a
    // busy machine turned four passing tests into a red suite.
    //
    // 60 s is about twenty times the slowest test's idle cost: slow enough that a
    // busy machine cannot turn a passing test red (this box runs several suites at
    // once and the slowest test measured 35 s there, against 2.8 s idle), and still
    // short enough that a genuinely stuck test fails instead of hanging the suite.
    // The hook budget is larger because the forge tests spawn the real Python
    // optimizer daemon in beforeAll.
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
