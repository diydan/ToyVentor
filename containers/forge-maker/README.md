# forge-maker: Make from words, in a Cloudflare Container

The maker that builds and checks a part (`scripts/forge_optimizer_daemon.py`, **unchanged**) runs here, in a container, behind a Worker with no public
address. The main Worker (`toyventor`) calls it through a service binding named `FORGE_MAKER` (`worker/forgeOptimizer.ts`), so nothing runs on a laptop and
the daemon is never on the internet. Written 2026-11-04. **Built and tested locally; not deployed yet** (see "Deploy").

```
child -> toyventor Worker (/api/forge/make) -> service binding -> toyventor-forge-maker Worker -> Durable Object "forge" -> container (daemon, port 8791)
```

## What is here

| File | What it is |
| --- | --- |
| `Dockerfile`, `requirements.txt` | Python 3.9, packages pinned to `parts/partspec/.venv` (the environment the 40-wish runs and the print gates were checked in) |
| `stage.mjs` | copies an explicit list of repo files into `context/` (276 files, 14 MB). `wrangler deploy` runs it first (`build` in `wrangler.jsonc`) |
| `src/index.ts` | the Worker: refuses without its token, forwards only `/health` and `/v1/*`, adds the daemon's Bearer token, one named instance |
| `wrangler.jsonc` | `standard-2` (1 vCPU, 6 GiB), `max_instances` 2, `workers_dev` and preview URLs off |

## Deploy (order matters)

Docker must be running. Run from the repo root. **Always pass `--config`**: after `npm run build` the repo root holds a `.wrangler/deploy/config.json`, and without `--config`
Wrangler refuses to choose between it and this folder's config.

1. `(cd containers/forge-maker && ../../node_modules/.bin/wrangler deploy --config wrangler.jsonc)` builds the image for linux/amd64, pushes it, creates the Worker `toyventor-forge-maker`.
   (The folder needs its own `node_modules`: `npm ci` inside it, once.)
2. The token, a secret of **this** Worker: `printf %s "$(openssl rand -hex 32)" | (cd containers/forge-maker && ../../node_modules/.bin/wrangler secret put FORGE_OPTIMIZER_TOKEN --config wrangler.jsonc)`.
   Until it exists the maker answers 503 "disabled" (fail closed). To rotate, put a new one; the container restarts with it when it next starts.
3. Then deploy the main Worker as usual (a clean export of HEAD). Its `wrangler.jsonc` names this Worker in `services`, so that deploy **fails until step 1 is done**.
   Do not set `FORGE_OPTIMIZER_URL` in production: a URL wins over the binding.
4. Check: Make from words in the app; `wrangler tail toyventor-forge-maker` shows the requests.

Turn it off: remove the `services` entry (or the Worker); the routes then answer 503 and the app offers a ready-made hat or head.

## How it was checked (2026-11-04)

- **Which files the daemon reads** came from an audit, not a guess: the daemon ran with a Python audit hook that logged every repo file it opened while it made a crown, a head and a back part.
  `stage.mjs` copies those, plus whole folders where a lazily imported module might need a neighbour.
- **Same results as the Mac:** the same three recipes through the amd64 image gave the same triangle counts and file sizes, and the final STL and GLB for the crown and the back have
  **identical SHA-256** to the Mac's. Cold start to a healthy daemon: 2 s (under emulation). A request without the token gets 401.
- **A mistake the comparison caught:** the first requirements list held only the packages I had spotted and left out `matplotlib`. The fast preview worked; the background print check
  failed with `No module named 'matplotlib'`, so no printable file would ever have been made. The list is now the venv's full `pip freeze`.
  If you change a pin or add an import, rerun the comparison (health, three recipes, wait 30 s, look for `.stl` files in `/data/forge-cache`).
- `tests/forge-maker-binding.test.ts` (5 tests) covers the main Worker's side with stubs. The full suite was not run (paused until beta).

## Know before relying on it

- **Not tested live.** Nothing here has run on Cloudflare yet. First live request: cold start, the 90 s port wait, `max_instances`, and the real price of `standard-2` are unmeasured.
- **Jobs live in the container's memory.** One instance on purpose (a job started by one request is polled by the next). A restart (idle sleep after 10 minutes, a deploy, a crash) drops running jobs; the client falls back to a ready-made part.
- **A pathological recipe can stall a background job.** My crude 3-slice "head" never finished its print check on the Mac or in the container (the daemon logs divide-by-zero warnings in `toyventor_parts.py:3939`).
  The fast preview still answers. Two stuck jobs would hold both worker threads until the container restarts. Not new, and not changed here.
- **No slicer**, as on the Mac: `preprint_check.py` looks for PrusaSlicer and skips that stage when it is absent. Results match the Mac because the Mac has none either.
- **The image is built from the working tree.** `stage.mjs` copies from the repo as it is. At the time of writing every staged file was identical to the commit; check `git status` on them before a deploy, or deploy from a clean export.
- **Local dev:** `npm run dev` / `wrangler dev` print a warning that the `FORGE_MAKER` service cannot be resolved. Set `FORGE_OPTIMIZER_URL` in `.dev.vars` to keep using the daemon on your machine (`npm run forge:optimizer`).
