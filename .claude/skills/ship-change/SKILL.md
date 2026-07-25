---
name: ship-change
description: The end-to-end "definition of done" for shipping any code change in pixel-tabletop — verify (typecheck + scoped test + coverage), branch, commit, push, open a PR. Use WHENEVER you're about to finish and hand off a change (feature, fix, refactor) so nothing is skipped. Encodes the project's cross-platform + never-commit-to-main discipline.
---

Follow this to ship a change. It exists because shortcuts here have burned us:
testing uncommitted code, committing straight to `main`, stale docs. Don't skip steps.

## 0. Right Node
Node is pinned to **22 LTS**. Confirm before anything:
```
node -v            # must be v22+ (nvm use if not; NEVER the system v18)
```

## 1. Branch first (never work on main)
```
git switch -c feat/<short>   # or fix/ chore/ docs/
```

## 2. Do the work
- Domain change? It's pure/serializable/deterministic, **mm only**, and gets a
  vitest test. (See `domain-change` skill.)
- Geometry/LoS? Prove it against a brute-force ground-truth scan. (See
  `verify-geometry` skill.)
- Render/UI? There are no unit tests here — you must verify it **live** in the
  browser (`npm run dev`).

## 3. Verify (all must pass) — run from the repo root
```
npm run typecheck
npm test                 # scoped to src/ — should NOT be inflated by worktrees
npm run test:coverage    # core (domain+net) stays ≥ 80%
```
If a change touched commands/paths/versions, update the docs (or delegate to
`docs-maintainer`) — no drift.

## 4. Commit — against COMMITTED state
Stage explicitly; don't sweep in unrelated/worktree files.
```
git add <the files you changed>
git commit -m "type: imperative summary

Why + what. Reference issues (fixes #NN).

Co-Authored-By: Claude <noreply@anthropic.com>"
```
> Gotcha we hit: a clean-room clone tests the **committed** branch — verifying
> uncommitted edits proves nothing. Commit, then verify a fresh clone if it matters.

## 5. Push + PR (not straight to main)
```
git push -u origin <branch>
gh pr create --base main --repo jason-hatchett/pixel-tabletop --fill
```
Keep the PR single-purpose. In the body, state what you **verified** vs what's
**unverified** (e.g. "Docker path not run here"). Never claim green you didn't run.

## 6. Report
Tersely: the PR URL, what passed, and any honest caveats. Done.
