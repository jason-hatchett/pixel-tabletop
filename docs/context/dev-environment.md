# Dev environment (WSL) — how to actually build/test

This repo runs under **WSL**. Node is **not** on the default PATH. The root
`CLAUDE.md` documents PowerShell/Windows commands — those are the Windows-side
equivalents and **do not work in this WSL shell**. Use the commands below.

## Node

A working Node lives at:

```
/mnt/c/Users/glenn/projects/.nvm/versions/node/v24.1.0/bin
```

(node v24.1.0, npm 11.3.0)

## Prefix every session

```bash
export PATH="/mnt/c/Users/glenn/projects/.nvm/versions/node/v24.1.0/bin:$PATH"
```

`.claude/settings.json` also puts this dir on PATH for tool calls.

## The three commands

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run build       # tsc --noEmit && vite build
```

Dev server: `npm run dev` → http://localhost:5173 (start in background, then use
the Browser pane). Always run **typecheck + test** before claiming done.

## CI

`.github/workflows/ci.yml` runs `npm ci`, `npm run typecheck`, `npm test`, and
`npm run build` on **Node 20** on GitHub (ubuntu-latest), on push to `main` and
on every pull request. Local Node is 24; CI's is 20 — keep to features both
support.
