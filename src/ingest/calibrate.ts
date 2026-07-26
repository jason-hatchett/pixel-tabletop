/**
 * Pixel → millimetre calibration for image placement.
 *
 * Pure and mm-out (pillar 1, ADR-0001): given the image's pixel size and a known
 * real-world span somewhere on it, produce the on-table mm extent that bakes the
 * scale in. The stored placement is mm-anchored, never pixel-anchored — the px
 * numbers stop here and never enter `BoardState`.
 *
 * v1 uses a caller-supplied span (a manual "this much of the image is N mm"
 * entry). Auto-detecting the span from the image's grid pitch is a later
 * enhancement layered on top of this same helper (ADR-0008).
 */

/**
 * @param pxWidth   image width in pixels
 * @param pxHeight  image height in pixels
 * @param spanPx    a measured span across the image, in pixels
 * @param spanMm    the real-world length of that span, in mm
 * @returns the image's on-table size in mm, aspect ratio preserved
 */
export function mmExtentFromSpan(
  pxWidth: number,
  pxHeight: number,
  spanPx: number,
  spanMm: number,
): { widthMm: number; heightMm: number } {
  if (spanPx <= 0 || spanMm <= 0) throw new Error("Calibration span must be positive.");
  const mmPerPx = spanMm / spanPx;
  return { widthMm: pxWidth * mmPerPx, heightMm: pxHeight * mmPerPx };
}

/**
 * Nudge an image edge so a detected gridline lands on the board grid.
 *
 * The board grid is anchored at 0 with pitch `cellMm`. Given a starting (e.g.
 * centered) edge position `edgeMm` and the mm offset of the image's first
 * gridline from that edge, return the nearest edge position that puts the
 * gridline exactly on a board gridline — so grid-snapped tokens land in image
 * squares. Pure.
 */
export function alignEdgeToGrid(edgeMm: number, gridlineOffsetMm: number, cellMm: number): number {
  if (cellMm <= 0) throw new Error("cellMm must be positive.");
  const gridline = edgeMm + gridlineOffsetMm;
  const snapped = Math.round(gridline / cellMm) * cellMm;
  return edgeMm + (snapped - gridline);
}
