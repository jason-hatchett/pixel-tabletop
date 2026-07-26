/**
 * Raster decode — the one place that touches the browser's image machinery.
 *
 * Kept out of `src/domain/` (which is pure and DOM-free) and thin on purpose:
 * it turns a picked file into the RGBA pixel buffer the calibration/detection
 * step maps to mm. The bytes themselves go to the asset store; the renderer
 * loads a texture from there (ADR-0008). No mm math lives here.
 */

/** Raw RGBA pixels for analysis (grid detection). Kept plain so the analyzer
 * stays a pure function of a buffer, testable without the DOM. */
export interface PixelBuffer {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Decode a file to its RGBA pixel buffer via an offscreen canvas. */
export async function decodeImageData(file: Blob): Promise<PixelBuffer> {
  const bmp = await createImageBitmap(file);
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable for image analysis.");
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
  bmp.close();
  return { data: img.data, width: img.width, height: img.height };
}
