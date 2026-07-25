# Dev environment — cross-platform (WSL + Windows + macOS)

Two developers, two OSes. The rule that keeps us in sync: **the shared command
interface is `npm run <script>`** — it runs identically on Windows PowerShell,
WSL/Linux, and macOS. `make` is optional sugar for Unix shells only.

## What works where

| Path | Windows PowerShell | WSL / Linux | macOS | Notes |
|------|:---:|:---:|:---:|-------|
| `npm run dev/test/build/typecheck` | ✅ | ✅ | ✅ | **Primary.** npm ships with Node; scripts are OS-neutral (`vite`/`tsc`/`vitest`). |
| `docker compose up dev` / `up` | ✅ | ✅ | ✅ | **Most reproducible.** Pins the whole toolchain; no local Node needed. |
| `make dev/test/up` | ❌ | ✅ | ✅ | Convenience wrapper over the above. `make` isn't on Windows. |

## Node is pinned to 22 LTS
`.nvmrc` (22) + `engines` (`>=22`) + `.npmrc` (`engine-strict=true`) so an
unsupported Node fails `npm install` loudly. Install/select it per OS:

- **WSL / macOS (nvm):** `nvm install 22 && nvm use`
- **Windows (nvm-windows):** `nvm install 22 && nvm use 22`
- **Any OS:** skip Node entirely — use `docker compose up dev`.

⚠️ On this WSL box the system `/usr/bin/node` is v18 and Vite 6 crashes on it.
If `node -v` shows v18, your shell didn't load nvm: `source ~/.bashrc` or open a
fresh terminal.

## One command from a fresh clone (any OS)
```
npm run dev
```
`predev`/`pretest`/`prebuild` run `scripts/ensure-deps.mjs`, which does `npm ci`
if `node_modules` is missing — so a clean clone bootstraps itself, portably. (No
shell operators; pure Node, so PowerShell and bash behave the same.)

## The commands
```
npm install         # explicit install (auto-runs on first dev/test/build too)
npm run dev         # http://localhost:5173
npm test            # vitest run
npm run typecheck   # tsc --noEmit
npm run build       # tsc --noEmit && vite build
```
Always run **typecheck + test** before claiming done.

## Docker (identical toolchain everywhere)
```
docker compose up dev     # Vite + HMR → http://localhost:5173
docker compose up web     # nginx production build → http://localhost:8080
docker compose run --rm dev npm test
```
See [hosting.md](hosting.md) for the compose/nginx details.

## Cross-platform hygiene (already set up)
- `.gitattributes` normalizes line endings to **LF** in the repo (no CRLF/LF
  churn between Windows and WSL).
- `.editorconfig` keeps indentation/charset/EOL consistent across editors.

## CI
`.github/workflows/ci.yml` runs `npm ci` + typecheck + test + build on **Node 22**
(ubuntu), matching the local pin, on push to `main` and every PR.
