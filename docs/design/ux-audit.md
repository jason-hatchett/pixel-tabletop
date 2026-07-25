# UX audit — toolbar & interaction flow (proposals)

Status: **proposals, pending owner approval.** By the ux-designer role. Grounded
in `index.html` (`#toolbar`) and the single `apply()` state model in `src/main.ts`.

## Current flows (step count)

| Task | Steps today | Controls touched |
|------|:---:|---|
| Place a token | **3** then click | Mode→Place, Type→Token, Item→pick |
| Place terrain | **3** then click | Mode→Place, Type→Terrain, Item→pick |
| Draw a wall | **2** then drag | Mode→Place, Type→Wall |
| Move/select | **1** | Mode→Move |
| Measure | **1** (overrides mode) | Measure toggle |
| Template | **2** (overrides mode) | Template→pick, Template toggle |

**Root friction:** *Mode* and *Type* are two separate dropdowns for one decision
("what am I doing right now?"). Picking a Type does **not** imply Place mode — you
set Mode separately. And Mode lives in a dropdown, so there's no persistent visual
of whether you're in move vs place → the "which mode am I in?" confusion.

## P1 — Single tool palette (highest value)
Replace the Mode dropdown + Type dropdown + Measure/Template toggles with **one row
of mutually-exclusive tool buttons**:

```
[▲ Move] [● Token] [▧ Terrain] [／ Wall] [📏 Measure] [△ Template]
```

Picking a tool sets the whole intent in **one click** (Item dropdown appears only
for Token/Terrain; Template picker only for Template). This maps 1:1 onto the
existing `apply()` inputs — `tool → {mode, type, analysis}` — so **it's a UI-only
change; `apply()`, the domain, and the render layer are untouched.**

- Place a token: **3 → 2** (Token tool → pick item → click).
- Move: a dropdown change → a single highlighted button.
- Removes mode ambiguity: the active tool is always highlighted.

Risk: low–medium (rewire `index.html` toolbar + the listeners in `main.ts`;
`apply()` unchanged). Hand to **render-engineer** to implement once approved.

## P2 — Sticky vs auto-move after placing
Today, after placing you must switch Mode→Move to adjust. Two options (owner picks):
- **Sticky place** — keep placing more of the same (good for armies).
- **Auto-move** — after a drop, switch to Move and select the new piece.
Either kills the Place→Move round-trip. Risk: low.

## P3 — Clarify Grid vs Snap (minor)
`Grid` (visibility) and `Snap` (drop behaviour) are easily conflated. Keep both but
relabel/group: `Grid: show` / `Grid: snap`. Cosmetic, low risk.

## P4 — Item picker as shape/size thumbnails (defer)
Bases carry real shapes/sizes; a visual picker beats a text dropdown — but it's a
bigger build. Bigger bet; revisit after P1.

## Recommendation
Ship **P1** first (biggest clicks-saved × frequency, zero domain risk), then decide
**P2**. P3/P4 are polish. None regress the `apply()` model or touch the mm-only domain.
