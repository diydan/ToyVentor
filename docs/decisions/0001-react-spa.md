# 0001 — React SPA, no SSR

Oct 27, 2026.

Decided: the app is React + TypeScript + Vite, built as a single-page app on
Cloudflare Workers with Static Assets. `src/App.tsx` is the shell,
`worker/index.ts` is the API Worker, and client routes fall back to the SPA
instead of hitting the Worker.

Why not SSR: camera, WebXR/AR, and the mini game are client-only, so
server-rendering buys nothing here and costs hackathon days.

Rule that comes with React: anything with a frame loop (builder 3D view, AR,
mini game) lives in imperative TypeScript under `src/features/*/engine/` and
never imports React. A thin component mounts it on a canvas and reads coarse
snapshots. No per-frame React state.
