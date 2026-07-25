# Architecture Decision Records

An ADR records one architectural decision: its context, the choice made, and the
consequences. ADRs are **numbered** in order, **immutable once Accepted** (you
don't rewrite history), and **superseded, never deleted** — if a later decision
overturns an earlier one, add a new ADR and mark the old one `Superseded by
ADR-NNNN` rather than editing it away. This preserves *why* the codebase is the
way it is, including the paths we rejected.

Status values: `Proposed` → `Accepted` → (later) `Superseded` / `Deprecated`.

| ADR | Title | Status |
|-----|-------|--------|
| [0001](adr-0001-millimetres-only-domain-unit.md) | Millimetres as the only domain length unit | Accepted |
| [0002](adr-0002-deterministic-reducer-multiplayer-seam.md) | Pure deterministic reducer as the multiplayer foundation | Accepted |
| [0003](adr-0003-rule-systems-as-plugins.md) | Rule systems as plugins implementing a RuleSystem contract | Accepted |
| [0004](adr-0004-occlusion-by-intersection-over-source-vertices.md) | Occlusion/LoS by intersection-over-source-vertices, verified against brute force | Accepted |

## Related
- Design pillars these decisions serve → [../vision.md](../vision.md)
- Game-term detail → [../game-design.md](../game-design.md)
- Sequencing → [../roadmap.md](../roadmap.md)
