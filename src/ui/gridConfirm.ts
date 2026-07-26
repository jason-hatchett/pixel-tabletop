/**
 * Grid-confirm modal — shows the imported image with the detected grid drawn
 * over it, so the user can see how well detection lines up and nudge the pitch /
 * offset before placing. The preview pans (drag) and zooms (scroll) so the fit
 * can be checked at the edges, where any residual drift shows. Resolves with the
 * (possibly adjusted) grid, "manual" to fall back to typing a width, or null if
 * cancelled.
 *
 * UI-only: draws to its own canvas, touches no app state. The pixel numbers here
 * are converted to mm by the caller (pillar 1).
 */

export interface GridConfirmResult {
  pxPerCell: number;
  offsetX: number;
  offsetY: number;
}

export interface GridConfirmOptions {
  imageUrl: string;
  imgWidth: number;
  imgHeight: number;
  detection: GridConfirmResult;
  /** Label for one cell in game units, e.g. "5 ft". */
  cellLabel: string;
}

const CANVAS_W = 560;
const CANVAS_H = 460;

export function confirmGridModal(opts: GridConfirmOptions): Promise<GridConfirmResult | "manual" | null> {
  return new Promise((resolve) => {
    let pitch = opts.detection.pxPerCell;
    let ox = opts.detection.offsetX;
    let oy = opts.detection.offsetY;

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");

    const close = (v: GridConfirmResult | "manual" | null): void => {
      backdrop.remove();
      document.removeEventListener("keydown", onKey);
      resolve(v);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") close(null);
    };

    const h = document.createElement("h2");
    h.textContent = "Confirm map grid";
    modal.appendChild(h);
    const sub = document.createElement("p");
    sub.textContent = "Green lines show the detected grid. Scroll to zoom, drag to pan — check the fit at the edges, adjust if needed, then place.";
    modal.appendChild(sub);

    // --- preview canvas + viewport (image px -> canvas px: screen = (img - pan) * z) ---
    const canvas = document.createElement("canvas");
    canvas.className = "modal-preview";
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    canvas.style.cursor = "grab";
    modal.appendChild(canvas);
    const ctx = canvas.getContext("2d")!;
    const image = new Image();
    image.src = opts.imageUrl;

    const fitZoom = Math.min(CANVAS_W / opts.imgWidth, CANVAS_H / opts.imgHeight);
    let z = fitZoom;
    let panX = (opts.imgWidth - CANVAS_W / z) / 2; // center the image
    let panY = (opts.imgHeight - CANVAS_H / z) / 2;

    const readout = document.createElement("div");
    readout.className = "modal-readout";
    modal.appendChild(readout);

    const redraw = (): void => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.imageSmoothingEnabled = false;
      ctx.setTransform(z, 0, 0, z, -panX * z, -panY * z);
      if (image.complete) ctx.drawImage(image, 0, 0, opts.imgWidth, opts.imgHeight);

      // Grid in image coordinates; 1px screen lines via lineWidth / z.
      const left = panX;
      const right = panX + CANVAS_W / z;
      const top = panY;
      const bottom = panY + CANVAS_H / z;
      ctx.strokeStyle = "rgba(6, 214, 160, 0.9)";
      ctx.lineWidth = 1 / z;
      ctx.beginPath();
      for (let x = ox + Math.floor((left - ox) / pitch) * pitch; x <= right; x += pitch) {
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
      }
      for (let y = oy + Math.floor((top - oy) / pitch) * pitch; y <= bottom; y += pitch) {
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
      }
      ctx.stroke();
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      const cells = Math.round(opts.imgWidth / pitch);
      const rows = Math.round(opts.imgHeight / pitch);
      readout.textContent = `≈ ${pitch.toFixed(1)}px squares · ${cells} × ${rows} cells · 1 square = ${opts.cellLabel}`;
    };
    image.onload = redraw;

    // Zoom toward the cursor.
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const imgX = panX + cx / z;
        const imgY = panY + cy / z;
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        z = Math.max(fitZoom * 0.5, Math.min(40, z * factor));
        panX = imgX - cx / z;
        panY = imgY - cy / z;
        redraw();
      },
      { passive: false },
    );

    // Drag to pan.
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    canvas.addEventListener("pointerdown", (e) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.style.cursor = "grabbing";
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      panX -= (e.clientX - lastX) / z;
      panY -= (e.clientY - lastY) / z;
      lastX = e.clientX;
      lastY = e.clientY;
      redraw();
    });
    const endDrag = (): void => {
      dragging = false;
      canvas.style.cursor = "grab";
    };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);

    // --- adjust fields ---
    const fields = document.createElement("div");
    fields.className = "modal-fields";
    const field = (label: string, value: number, min: number, step: number, onInput: (v: number) => void): void => {
      const wrap = document.createElement("label");
      wrap.textContent = label;
      const input = document.createElement("input");
      input.type = "number";
      input.value = String(value);
      input.min = String(min);
      input.step = String(step);
      input.addEventListener("input", () => {
        const v = Number(input.value);
        if (Number.isFinite(v) && v >= min) {
          onInput(v);
          redraw();
        }
      });
      wrap.appendChild(input);
      fields.appendChild(wrap);
    };
    // Offsets accept negatives so the grid can be nudged either way.
    field("Square (px)", Math.round(pitch * 10) / 10, 4, 0.1, (v) => (pitch = v));
    field("Offset X (px)", Math.round(ox), -100000, 1, (v) => (ox = v));
    field("Offset Y (px)", Math.round(oy), -100000, 1, (v) => (oy = v));
    modal.appendChild(fields);

    // --- actions ---
    const actions = document.createElement("div");
    actions.className = "modal-actions";
    const place = document.createElement("button");
    place.type = "button";
    place.className = "primary";
    place.textContent = "Place, aligned to grid";
    place.addEventListener("click", () => close({ pxPerCell: pitch, offsetX: ox, offsetY: oy }));
    const manual = document.createElement("button");
    manual.type = "button";
    manual.textContent = "Enter width manually";
    manual.addEventListener("click", () => close("manual"));
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => close(null));
    actions.append(place, manual, cancel);
    modal.appendChild(actions);

    document.addEventListener("keydown", onKey);
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close(null);
    });
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    redraw();
  });
}
