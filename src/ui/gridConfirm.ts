/**
 * Grid-confirm modal — shows the imported image with the detected grid drawn
 * over it (on a pan/zoom preview so the fit can be checked at the edges) and
 * lets the user nudge pitch / offset before placing. Resolves with the (possibly
 * adjusted) grid, "manual" to fall back to typing a width, or null if cancelled.
 *
 * UI-only: touches no app state. The pixel numbers here are converted to mm by
 * the caller (pillar 1).
 */

import { createImagePreview } from "./imagePreview.js";

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

    const readout = document.createElement("div");
    readout.className = "modal-readout";

    const preview = createImagePreview({
      imageUrl: opts.imageUrl,
      imgWidth: opts.imgWidth,
      imgHeight: opts.imgHeight,
      overlay: (ctx, view) => {
        const left = view.panX;
        const right = view.panX + ctx.canvas.width / view.z;
        const top = view.panY;
        const bottom = view.panY + ctx.canvas.height / view.z;
        ctx.strokeStyle = "rgba(6, 214, 160, 0.9)";
        ctx.lineWidth = 1 / view.z;
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
        const cells = Math.round(opts.imgWidth / pitch);
        const rows = Math.round(opts.imgHeight / pitch);
        readout.textContent = `≈ ${pitch.toFixed(1)}px squares · ${cells} × ${rows} cells · 1 square = ${opts.cellLabel}`;
      },
    });
    modal.appendChild(preview.canvas);
    modal.appendChild(readout);

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
          preview.redraw();
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
  });
}
