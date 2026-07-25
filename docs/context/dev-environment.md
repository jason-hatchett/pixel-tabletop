# Dev environment — how to actually build/test

## Node is pinned to 22 LTS

The project standardizes on **Node 22 LTS** — pinned in `.nvmrc`, enforced by
`engines` in `package.json` (`>=22`) with `engine-strict=true` in `.npmrc` so an
unsupported Node fails `npm install` loudly.

```bash
nvm install 22   # first time
nvm use          # thereafter — reads .nvmrc (22)
node -v          # must be v22.x
```

### Do NOT use the system node
`/usr/bin/node` on this WSL box is **v18.19.1** — Vite 6 crashes on it
(`SyntaxError: Unexpected identifier` from Vite's ESM). nvm's node must win. If
`node -v` shows v18, your shell didn't load nvm: `source ~/.bashrc` or open a
fresh terminal (nvm is sourced in `~/.bashrc`).

## The commands

```bash
npm install         # blocked on Node < 22 by engine-strict
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run build       # tsc --noEmit && vite build
npm run dev         # http://localhost:5173
```

Always run **typecheck + test** before claiming done.

## CI & hosting

- `.github/workflows/ci.yml` — `npm ci` + typecheck + test + build on **Node 22**
  (ubuntu-latest), on push to `main` and every PR. Matches the local pin.
- `.github/workflows/pages.yml` — builds on Node 22, deploys to GitHub Pages.
- `Dockerfile` — `node:22-alpine` build stage → nginx. See
  [hosting.md](hosting.md).

## Two-dev note
Both machines run `nvm use` in the repo to converge on Node 22. This pin exists
because version drift (18 vs 24 vs 26 across machines) was the root cause of
early "app won't run" issues.
