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
