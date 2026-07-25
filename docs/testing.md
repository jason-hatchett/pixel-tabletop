# Testing & coverage

## The vitest suite is the regression suite

Every behavioural guarantee in the pure core is pinned by a `*.test.ts` next to
the code it exercises. This suite *is* the regression story: a bug is fixed by
first adding the failing test, and no domain change merges without a test (see
CLAUDE.md and `.claude/agents/qa-engineer.md`). Run it with:

```bash
npm test            # vitest run
npm run test:coverage   # vitest run --coverage (adds the coverage gate)
```

## Coverage is core-only, on purpose

Coverage is measured and **enforced** over the pure, deterministic core only:

- `src/domain/**` — state reducer, geometry, walls/LoS, terrain, rule plugins.
- `src/net/**` — the sync seam (`LocalSync`, undo).

Everything else is **excluded** (`vitest.config.ts` → `test.coverage.exclude`):

- `src/render/**` and `src/main.ts` — the PixiJS renderer and entry point.
  Rendering is verified **live in the browser** (the Browser pane at
  `localhost:5173`), not in unit tests. It draws in mm and dispatches actions
  through `BoardSync`; it holds no logic worth asserting in isolation, and it
  can't run headless without a canvas. This matches the architecture rule that
  `src/domain/` is the pure, testable half and `src/render/` is the live half.
- `**/*.test.ts`, `scripts/**`, `vite.config.ts`, `vitest.config.ts`,
  `**/*.config.*` — test and tooling files.

Chasing whole-repo coverage would mostly mean mocking Pixi, which proves the
mock, not the app. So the gate deliberately stops at the core.

## The threshold

`vitest.config.ts` enforces a **80% floor** on lines, functions, statements and
branches for the included files. 80% is a floor, not a target — actual core
coverage sits well above it (statements/lines ~96%, branches ~90%, functions
~91% at the time this gate landed). `npm run test:coverage` exits non-zero if
any metric drops below 80%, so a regression in coverage fails the command.

Geometry/LoS coverage is not just line count: occlusion math is proven against a
**brute-force ground-truth grid scan** (`walls-templates.test.ts`), never
angular/tangent heuristics. Line coverage is necessary but not sufficient — new
occlusion math copies that scan.

## Running on every PR

The intent is for CI to run `typecheck + test + build` (and this coverage gate)
on every pull request via `.github/workflows/ci.yml`.

> **Caveat — the CI gate is not live yet.** The workflow file requires a push
> with a `workflow`-scoped token, which is currently pending. Until that lands,
> `.github/workflows/ci.yml` is absent and the gate is **not** enforced
> automatically on PRs. Run `npm run test:coverage` locally before pushing.

## Optional: local pre-push guard

If you want the gate enforced locally until CI is live, add a pre-push hook. This
is **optional** — nothing here force-installs husky. Simplest, dependency-free:

```bash
# .git/hooks/pre-push  (chmod +x)
#!/bin/sh
npm run typecheck && npm run test:coverage
```

Or, if the team later adopts husky, put the same two commands in
`.husky/pre-push`. Either way it just runs the same commands CI will.
