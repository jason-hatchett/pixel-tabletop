# CLAUDE.md

Pixel-art VTT (mm-based) for Warhammer 40k/AoS + D&D 5E. Vite + TS (strict) + PixiJS v8.

## Working style (important)
- **Be brief.** Short answers, minimal preamble, no recaps of what you just did unless asked.
- Don't paste large files/diffs back. Reference `path:line`. Read only the slice you need.
- Verify claims about LLM APIs/geometry with a quick test, not prose.
- Trust the harness: don't re-read a file you just edited.

## Commands
Node is pinned to **22 LTS** (`.nvmrc`; `engines` enforces `>=22`). With nvm:
```bash
nvm use              # picks up .nvmrc (22); `nvm install 22` first time
npm run typecheck    # tsc --noEmit
npm test             # vitest run
npm run dev          # http://localhost:5173
```
Do NOT use the system `/usr/bin/node` (v18) — Vite 6 crashes on it. If `node -v`
shows v18, your shell didn't load nvm: `source ~/.bashrc` or open a new terminal.
Dev server: start in background, then use the Browser pane at http://localhost:5173.
Always run typecheck + test before claiming done.

## Project docs & agents
- `docs/` — vision, game-design, roadmap, ADRs (`docs/architecture/`), context/glossary.
- `.claude/agents/` — specialist subagents; `.claude/skills/` — task workflows.
- CI: `.github/workflows/ci.yml` runs typecheck + test + build on every PR.

## Architecture (don't break these)
- **Everything is millimetres.** Never store pixels or grid squares in the domain. Pixels = camera/zoom; inches/feet/cells = a rule-system interpretation.
- `src/domain/` is pure/serializable/deterministic, no Pixi/DOM. `src/render/Board.ts` draws in mm, never mutates state — it dispatches actions through `BoardSync`.
- Rule systems are plugins (`src/domain/rules/`): one file per game.
- State is a reducer: `applyAction(state, action)` in `state.ts` (the multiplayer seam is `src/net/sync.ts`; only `LocalSync` today).
- Shadows/LoS live in `walls.ts` (`umbraQuad` for segments, `umbraOfOccluder` for whole terrain blocks) + `los.ts`. Occlusion math is done by intersection-over-source-vertices with convex clipping — no angular/tangent heuristics (they were buggy).

## Conventions
- Strict TS: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`. Prefer `x | null` over optional props on serializable state. `.js` extensions on relative imports.
- Match surrounding style; keep comments at existing density.
- Every domain change gets a vitest test; verify UI/rendering live in the Browser pane.

## Debugging geometry live
Vite serves `/src/domain/*.ts` as ES modules — `await import('/src/domain/walls.ts')` works in the browser console for ground-truth checks. Remove any temp `window.__debug` hook after.
