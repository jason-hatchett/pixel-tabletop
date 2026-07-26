# Test fixtures — sample map images

Drop sample map images here (PNG/JPG) to use when testing or tuning the
map-ingestion analyzer (`src/ingest/mapAnalyzer.ts`, ADR-0009). Reference them by
filename when asking to re-run detection, e.g. "test the analyzer on
`blueprint-dungeon.png`".

Guidance:
- Use descriptive names (`blueprint-dungeon.png`, `parchment-grid.jpg`, …).
- Note the map style if it's unusual (solid-background blueprint vs. photo vs.
  hand-drawn), since v1 targets the stylized blueprint class.
- These are inputs for manual/eyeball verification and future automated
  regression tests; they are not loaded by the app at runtime.
