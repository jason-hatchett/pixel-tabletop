# ASDLC — the operating model

How a prompt becomes shipped, reviewed work. Written so a **product manager** can
drive it by describing an outcome, and a **dev lead** can invoke any stage directly.
The short version lives in `CLAUDE.md` (applied on every prompt); this is the detail.

## The universal cycle

Every request runs the same five stages — **effort scales to the ask** (a typo skips
1–2; a feature runs all five).

| Stage | What happens | Produces |
|-------|--------------|----------|
| **1. Frame** | Restate the outcome + acceptance criteria. PM-level ask → infer criteria, state the assumption. | A crisp problem statement |
| **2. Route** | Pick the lead specialist(s) from the table below. | An owner |
| **3. Build** | Smallest change that meets the criteria; match surrounding style. | A diff on a branch |
| **4. Verify** | Run the gates — all must pass. | Green checks |
| **5. Ship** | `ship-change`: branch → verify → PR; `code-reviewer` on non-trivial diffs. | A reviewed PR |

## Routing table — request → cycle

| The ask sounds like… | Lead agent(s) | Mandatory gates (beyond the base) | Artifact |
|----------------------|---------------|-----------------------------------|----------|
| New feature / behaviour in the core | `domain-guardian` (+ `architect` if cross-cutting) | vitest for the change; purity/mm-only | PR (+ ADR if precedent) |
| Support a new game/ruleset | `rules-plugin-author` (`add-rule-system` skill) | `rules.test.ts` case; core untouched | PR |
| LoS / shadow / umbra / clearance | `geometry-verifier` (`verify-geometry` skill) | **brute-force ground-truth scan** | PR |
| Canvas / camera / toolbar / input | `render-engineer` | **live browser check** (no unit tests here) | PR |
| "Too many clicks", simplify the UI | `ux-designer` → `render-engineer` | step-count before/after | audit → PR |
| "It's slow" / scale | `perf-profiler` | **measure first**; scan still passes | doc → PR |
| Stale docs/commands/versions | `docs-maintainer` | commands run; single source of truth | PR |
| Scope, priority, "should we…" | `product-manager` | acceptance criteria; non-goals respected | spec / roadmap edit |
| Track the work | `technical-pm` | issues w/ acceptance criteria + milestone | GitHub issues |
| "How should this be structured?" | `architect` | ADR (status **Proposed**) | ADR |
| Bug | reproduce as a **failing test** → fix → `qa-engineer` | regression test committed | PR |

## The gates (Definition of Done) — one source of truth

Every shipped change clears these (scale to the change):

- **Node 22** (`node -v`; never the system v18).
- `npm run typecheck` clean.
- `npm test` green; **`npm run test:coverage` keeps the core (`src/domain`+`src/net`) ≥ 80%**.
- Every `src/domain/` change ships a **vitest test**.
- Geometry/LoS proven against a **brute-force scan**, never angular heuristics.
- Domain stays **pure / serializable / deterministic / millimetres-only**.
- Render/UI changes **verified live** in the browser.
- Docs updated if commands/paths/versions/behaviour changed (no drift).
- **Never commit to `main`** — branch → PR → review.

## Who engages how

- **Product manager** — describe the *outcome* ("players should drop a JPEG map").
  The cycle infers acceptance criteria (stating assumptions), routes, builds,
  verifies, and returns a PR with what was and wasn't verified. You approve.
- **Dev lead** — invoke a stage or agent directly ("have `geometry-verifier` prove
  the new umbra", "architect an ADR for unit grouping", "`perf-profiler` measure the
  drag path"). Skip framing when the spec is already clear.

Either way the **gates are non-negotiable** — they're what makes output trustworthy.

## Parallelization (when a request has independent parts)

- Fan out **only on non-overlapping surfaces** (different files / different agents).
- Concurrent code work → **git worktree isolation** (each agent its own copy).
- **Bounded** fan-out beats a swarm — every agent starts cold and re-derives context
  (token cost). 3 focused agents > 8 colliding ones.
- The orchestrator commits/PRs; sub-agents that share a tree must not run `git`.

## Worked cadences

- **Feature (image terrain, issue #4):** PM frames → `architect` ADR for raster→mm →
  `domain-guardian` model + `render-engineer` skin, in parallel → `qa-engineer`
  tests → `code-reviewer` → PR.
- **Bug:** write the failing test first → fix → `qa-engineer` confirms green → PR.
- **Geometry change:** `geometry-verifier` writes the brute-force scan *before*
  trusting the math → PR only when the scan agrees.
- **New ruleset:** `rules-plugin-author` adds one file + registers + test; core never
  edited → PR.

## Continuous improvement
Cycles feed back: `product-manager` keeps the roadmap, `technical-pm` keeps issues,
`architect` records decisions as ADRs, `docs-maintainer` kills drift. See
[roadmap.md](roadmap.md) and [CONTRIBUTING.md](../CONTRIBUTING.md).
