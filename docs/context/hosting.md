# Hosting & containerization

The app is a **static Vite SPA** today (no backend). Two ways to ship it.

## 1. GitHub Pages (free, simplest — recommended for now)
`.github/workflows/pages.yml` builds and deploys on every push to `main`.
One-time setup: repo **Settings → Pages → Source: GitHub Actions**. It builds
with `--base=/<repo>/` so a project-site subpath resolves assets. Needs the
`workflow` token scope to land (same as CI).

## 2. Docker (for self-hosting / when the Phase 5 server arrives)
Multi-stage `Dockerfile`: Node transpiles + bundles → nginx serves `dist/`.

```bash
docker build -t pixel-tabletop .
docker run --rm -p 8080:80 pixel-tabletop   # → http://localhost:8080
```

`docker/nginx.conf` hard-caches hashed `/assets/`, falls back to `index.html`
for SPA routes, and no-caches the shell. `.dockerignore` keeps `node_modules`,
`dist`, docs, and `.git` out of the build context.

**Why nginx-static and not a Node server?** There is no server process yet —
`vite build` is the whole app. When `WebSocketSync` + the authoritative server
land (roadmap Phase 5), add a second service (the Node server) and keep this
image as the web tier.

## Notes
- Local dev uses no container: `npm run dev` (see
  [dev-environment.md](dev-environment.md)).
- Vite `base` is left default for local/container (served at root); only the
  Pages build overrides it, so nothing else has to know about the subpath.
