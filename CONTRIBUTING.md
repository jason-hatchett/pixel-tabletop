# Contributing

Two developers, two platforms (WSL + Windows). This is the shared "how we work"
so anyone can clone and be productive in minutes. Keep it honest — if a step here
drifts from reality, fix it (see the `docs-maintainer` agent).

## 1. Get running (any OS)

**The portable interface is `npm run …`** — identical on Windows PowerShell, WSL,
and macOS. Node is pinned to **22 LTS** (`.nvmrc` + `engines`).

```bash
# WSL / macOS:            nvm install 22 && nvm use
# Windows (nvm-windows):  nvm install 22 && nvm use 22
npm run dev        # → http://localhost:5173  (auto-installs deps on first run)
```

Zero-Node option (any OS with Docker): `docker compose up dev`.

| | Windows PS | WSL/Linux | macOS |
|--|:--:|:--:|:--:|
| `npm run …` | ✅ | ✅ | ✅ |
| `docker compose …` | ✅ | ✅ | ✅ |
| `make …` (optional) | ❌ | ✅ | ✅ |

Full detail: [docs/context/dev-environment.md](docs/context/dev-environment.md).

## 2. Definition of Done (every change)

- [ ] `npm run typecheck` clean
- [ ] `npm test` green; `npm run test:coverage` holds the core ≥ 80%
- [ ] Every `src/domain/` change ships a vitest test
- [ ] Geometry/LoS changes proven against a **brute-force ground-truth scan**, not
      angular heuristics (see [`verify-geometry`](.claude/skills/verify-geometry) skill)
- [ ] Domain stays pure/serializable/deterministic, **millimetres only** (no pixels/
      grid in state; no Pixi/DOM in `src/domain/`)
- [ ] UI/render changes verified **live** in the browser (render has no unit tests)
- [ ] Docs updated if behaviour/commands/paths changed (no drift)

The `ship-change` skill walks this end-to-end.

## 3. Branch & PR flow

**Never commit straight to `main`.** Branch → verify → PR → review → merge.

```bash
git switch -c feat/<short-name>       # or fix/… , chore/… , docs/…
# …work; run the DoD checks…
git push -u origin feat/<short-name>
gh pr create --base main --fill
```

Keep PRs single-purpose. Reference issues (`fixes #NN`). CI runs typecheck + test
+ build on every PR (**once the `workflow` token scope is granted** — see
[dev-environment.md](docs/context/dev-environment.md)).

## 4. The agent team (`.claude/agents/`)

Delegate to the specialist; each enforces one part of the DoD.

| Agent | Owns |
|-------|------|
| product-manager | what/why, roadmap priority, specs |
| architect | cross-cutting structure, ADRs |
| technical-pm | GitHub issues & milestones |
| domain-guardian | `src/domain/` purity + tests |
| rules-plugin-author | new game rulesets (`src/domain/rules/`) |
| geometry-verifier | LoS/occlusion/clearance vs brute-force scans |
| render-engineer | PixiJS canvas, camera, input (`src/render/`) |
| ux-designer | interaction design — fewer clicks/steps |
| qa-engineer | tests, coverage gate, change validation |
| code-reviewer | critical diff review vs the pillars |
| perf-profiler | measured hot-path optimization |
| docs-maintainer | keeps docs/config in sync with the code |

Skills (`.claude/skills/`): `add-rule-system`, `verify-geometry`, `domain-change`,
`ship-change`.

## 5. Where things live
- Product/architecture: [docs/vision.md](docs/vision.md),
  [docs/game-design.md](docs/game-design.md), [docs/roadmap.md](docs/roadmap.md),
  [docs/architecture/](docs/architecture/) (ADRs), [docs/specs/](docs/specs/).
- The one rule that makes it all work: **everything is millimetres.** Pixels are
  camera; inches/feet/cells are a rule-system interpretation.

## 6. Cross-platform hygiene (already enforced)
- `.gitattributes` → LF in the repo (no CRLF churn between Windows and WSL).
- `.editorconfig` → consistent indent/charset/EOL across editors.
- Keep npm scripts OS-neutral (no bashisms/PowerShell cmdlets).
