// Deploy preflight: fails loudly on the known placeholder states so
// deploy day is not spent debugging them. Run: npm run preflight
// Local checks only — Cloudflare auth, remote D1 and Worker secrets can
// only be confirmed by Dan's `wrangler login` session; the exact commands
// are printed at the end either way.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.error(`preflight FAIL: ${msg}`);
};
const ok = (msg: string) => console.log(`preflight ok: ${msg}`);

// 1. Real D1 database id (all-zero placeholder works locally only).
const wrangler = readFileSync(join(root, "wrangler.jsonc"), "utf8");
const dbId = wrangler.match(/"database_id"\s*:\s*"([^"]*)"/)?.[1];
if (!dbId) fail("wrangler.jsonc has no d1 database_id");
else if (/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(dbId))
  fail("wrangler.jsonc database_id is the all-zero local placeholder — run `npx wrangler d1 create toyventor` and paste the returned id");
else ok(`D1 database_id set (${dbId.slice(0, 8)}…)`);

// 2. Local dev secret present (proves the value exists to upload remotely).
const devVars = join(root, ".dev.vars");
if (!existsSync(devVars)) fail(".dev.vars missing — MODEL_API_KEY has nowhere to be read from");
else if (!/^MODEL_API_KEY=\S+/m.test(readFileSync(devVars, "utf8")))
  fail(".dev.vars has no non-empty MODEL_API_KEY");
else ok(".dev.vars carries MODEL_API_KEY (value not shown)");

// 3. Migrations present for the remote apply step.
if (!existsSync(join(root, "migrations/0001_ownership.sql")))
  fail("migrations/0001_ownership.sql missing");
else ok("ownership migration present");

if (!existsSync(join(root, "migrations/0002_parent_time.sql")))
  fail("migrations/0002_parent_time.sql missing");
else ok("parent time migration present");

// 4. Built client exists or the deploy script will build it.
if (existsSync(join(root, "dist/client/index.html"))) ok("dist/ build present");
else console.log("preflight note: no dist/ yet — `npm run deploy` builds first, this is fine");

// 5. ToyVentor World is in the client build and current: the Play button
// opens it, and a stale page would ship the old game next to a new app.
const worldPage = join(root, "public/world/ToyVentor-World.html");
if (!existsSync(worldPage)) {
  fail("public/world/ToyVentor-World.html missing: run `npm run build:world`");
} else {
  const scratch = mkdtempSync(join(tmpdir(), "toyventor-preflight-"));
  try {
    execFileSync("python3", [join(root, "game/build25.py")], {
      env: { ...process.env, TOYVENTOR_OUT: scratch, TOYVENTOR_TEST_OUT: scratch },
      stdio: "pipe",
    });
    const fresh = readFileSync(join(scratch, "ToyVentor-World.html"));
    if (fresh.equals(readFileSync(worldPage)))
      ok("ToyVentor World page present and current (public/world/ToyVentor-World.html)");
    else fail("public/world/ToyVentor-World.html is stale vs game/engine25.js: run `npm run build:world`");
  } catch {
    fail("could not rebuild the world page to check freshness: run `npm run build:world` by hand");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (failures > 0) {
  console.log(`
First-deploy remediation (Dan, needs your Cloudflare login):
  npx wrangler login
  npx wrangler d1 create toyventor        # only if the database does not exist
  npx wrangler secret put MODEL_API_KEY   # value from .dev.vars, never committed
  npx wrangler d1 migrations apply toyventor --remote
  npm run deploy`);
  console.error(`preflight: ${failures} blocking item(s) above`);
  process.exit(1);
}
console.log("preflight: local checks pass — redeploy with `npm run deploy`");
