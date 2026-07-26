/**
 * Grid-confirm modal — shows the imported image with the detected grid drawn
 * over it, so the user can see how well detection lines up and nudge the pitch /
 * offset before placing. Resolves with the (possibly adjusted) grid, "manual" to
 * fall back to typing a width, or null if cancelled.
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

const PREVIEW_MAX = 520;

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
    sub.textContent = "Green lines show the detected grid. Adjust if they don't line up, then place.";
    modal.appendChild(sub);

    // --- preview canvas ---
    const scale = Math.min(PREVIEW_MAX / opts.imgWidth, PREVIEW_MAX / opts.imgHeight, 1);
    const canvas = document.createElement("canvas");
    canvas.className = "modal-preview";
    canvas.width = Math.round(opts.imgWidth * scale);
    canvas.height = Math.round(opts.imgHeight * scale);
    modal.appendChild(canvas);
    const ctx = canvas.getContext("2d")!;
    const image = new Image();
    image.src = opts.imageUrl;

    const readout = document.createElement("div");
    readout.className = "modal-readout";
    modal.appendChild(readout);

    const redraw = (): void => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (image.complete) ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = "rgba(6, 214, 160, 0.9)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = ox; x < opts.imgWidth; x += pitch) {
        const sx = Math.round(x * scale) + 0.5;
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, canvas.height);
      }
      for (let y = oy; y < opts.imgHeight; y += pitch) {
        const sy = Math.round(y * scale) + 0.5;
        ctx.moveTo(0, sy);
        ctx.lineTo(canvas.width, sy);
      }
      ctx.stroke();
      const cells = Math.round(opts.imgWidth / pitch);
      const rows = Math.round(opts.imgHeight / pitch);
      readout.textContent = `≈ ${Math.round(pitch)}px squares · ${cells} × ${rows} cells · 1 square = ${opts.cellLabel}`;
    };
    image.onload = redraw;

    // --- adjust fields ---
    const fields = document.createElement("div");
    fields.className = "modal-fields";
    const field = (label: string, value: number, min: number, onInput: (v: number) => void): void => {
      const wrap = document.createElement("label");
      wrap.textContent = label;
      const input = document.createElement("input");
      input.type = "number";
      input.value = String(Math.round(value));
      input.min = String(min);
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
    field("Square (px)", pitch, 4, (v) => (pitch = v));
    field("Offset X (px)", ox, 0, (v) => (ox = v));
    field("Offset Y (px)", oy, 0, (v) => (oy = v));
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
