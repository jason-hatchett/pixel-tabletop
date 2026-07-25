# ADR-0001: Millimetres as the only domain length unit

## Status
Accepted

## Context
The engine must serve two games with incompatible spatial models: Warhammer
40k/AoS (gridless, edge-to-edge inches on a physical table) and D&D 5E (abstract
5-ft square grid). Generic VTTs pick one native unit — usually the grid cell —
and every other game fights it. We need one representation both games agree on.

Pixels are the wrong choice: they're a function of camera zoom, so a stored
pixel position is meaningless once the user scrolls. Grid cells are the wrong
choice: they don't exist in gridless 40k, and they discard sub-cell precision
that edge-to-edge measurement depends on. Inches vs feet is a false dichotomy —
both are just labels on a physical length.

## Decision
The domain stores **all lengths in millimetres of real tabletop surface**, and
nothing else. See `src/domain/units.ts` for the rationale in code and the
conversion helpers (`MM_PER_INCH`, `inchesToMm`, `feetToMm`, `DEFAULT_CELL_MM`).
`Token.pos`, `BoardState.widthMm/heightMm`, wall endpoints, and terrain
footprints are all mm (`src/domain/state.ts:14`, `:26`).

Two coordinate lenses sit on either side of mm and never leak into it:

```
screen pixels ──(camera zoom)──► world millimetres ──(rule system)──► 6" / 30 ft / cells
```

- **Pixels** are a render-only concern (`src/render/`). The domain has no `import`
  of Pixi or the DOM.
- **Game units** (inches, feet, grid cells) are produced on demand by the active
  `RuleSystem` (`measure()` returns both raw `mm` and a native-unit `text`;
  `rules/types.ts:22`). One 50 mm cell = 5 ft by default (`units.ts`).

## Consequences
- A single engine is correct for a gridless 40k measurement and a 5-ft D&D
  square without forking geometry. This is the project's moat.
- Every render path multiplies by the camera scale; every rules path divides by
  the system's unit. mm never has to be re-derived — it is ground truth.
- Serialized state is portable and zoom-independent: a saved board reopens
  identically at any zoom, on any screen.
- Cost: contributors must resist storing "convenient" pixel or cell values in
  the domain. This is enforced by convention and code review, not the type
  system (a `number` is a `number`). CLAUDE.md calls it out as a hard rule.
- The choice of 50 mm per D&D cell (not the true ~38 mm of a 1.5-in printed
  square) is a rendering/ergonomics convenience decoupled from real GW base
  sizes, which are stored at their true mm.
