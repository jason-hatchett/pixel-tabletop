/**
 * A reusable pan/zoom image-preview canvas for the import confirm modals.
 *
 * Draws the image, then calls `overlay(ctx, view)` with the context already
 * transformed into image-pixel coordinates — the caller draws its overlay (grid
 * lines, extracted walls, …) in image space and uses `lineWidth = k / view.z`
 * for constant on-screen stroke width. Scroll zooms toward the cursor; drag
 * pans. Pointer coordinates are scaled by canvas.width/rect.width so it stays
 * correct when the canvas is CSS-shrunk on a narrow viewport.
 */

export interface PreviewView {
  z: number;
  panX: number;
  panY: number;
}

export interface ImagePreview {
  canvas: HTMLCanvasElement;
  redraw(): void;
}

export function createImagePreview(opts: {
  imageUrl: string;
  imgWidth: number;
  imgHeight: number;
  canvasWidth?: number;
  canvasHeight?: number;
  overlay: (ctx: CanvasRenderingContext2D, view: PreviewView) => void;
}): ImagePreview {
  const CW = opts.canvasWidth ?? 560;
  const CH = opts.canvasHeight ?? 460;

  const canvas = document.createElement("canvas");
  canvas.className = "modal-preview";
  canvas.width = CW;
  canvas.height = CH;
  canvas.style.cursor = "grab";
  const ctx = canvas.getContext("2d")!;
  const image = new Image();
  image.src = opts.imageUrl;

  const fit = Math.min(CW / opts.imgWidth, CH / opts.imgHeight);
  let z = fit;
  let panX = (opts.imgWidth - CW / z) / 2;
  let panY = (opts.imgHeight - CH / z) / 2;

  const redraw = (): void => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, CW, CH);
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(z, 0, 0, z, -panX * z, -panY * z);
    if (image.complete) ctx.drawImage(image, 0, 0, opts.imgWidth, opts.imgHeight);
    opts.overlay(ctx, { z, panX, panY });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  };
  image.onload = redraw;

  // Convert a client point to canvas-internal pixels (handles CSS scaling).
  const toCanvas = (clientX: number, clientY: number): { sx: number; sy: number; scale: number } => {
    const r = canvas.getBoundingClientRect();
    const scale = canvas.width / r.width;
    return { sx: (clientX - r.left) * scale, sy: (clientY - r.top) * (canvas.height / r.height), scale };
  };

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const { sx, sy } = toCanvas(e.clientX, e.clientY);
      const imgX = panX + sx / z;
      const imgY = panY + sy / z;
      z = Math.max(fit * 0.5, Math.min(40, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      panX = imgX - sx / z;
      panY = imgY - sy / z;
      redraw();
    },
    { passive: false },
  );

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let dragScale = 1;
  canvas.addEventListener("pointerdown", (e) => {
    dragging = true;
    dragScale = toCanvas(e.clientX, e.clientY).scale;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.style.cursor = "grabbing";
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    panX -= ((e.clientX - lastX) * dragScale) / z;
    panY -= ((e.clientY - lastY) * dragScale) / z;
    lastX = e.clientX;
    lastY = e.clientY;
    redraw();
  });
  const end = (): void => {
    dragging = false;
    canvas.style.cursor = "grab";
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);

  redraw();
  return { canvas, redraw };
}
