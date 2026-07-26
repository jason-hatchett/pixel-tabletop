/**
 * Raster decode — the one place that touches the browser's image machinery.
 *
 * Kept out of `src/domain/` (which is pure and DOM-free) and thin on purpose:
 * it turns a picked file into its intrinsic pixel dimensions so the calibration
 * step can map pixels → mm. The bytes themselves go to the asset store; the
 * renderer loads a texture from there (ADR-0008). No mm math lives here.
 */

export interface DecodedImage {
  /** Intrinsic image size in pixels. */
  width: number;
  height: number;
}

/** Decode just enough of an image file to learn its pixel dimensions. */
export async function decodeImageFile(file: Blob): Promise<DecodedImage> {
  const bmp = await createImageBitmap(file);
  const dims = { width: bmp.width, height: bmp.height };
  bmp.close();
  return dims;
}
