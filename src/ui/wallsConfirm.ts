/**
 * Walls-confirm modal — the staged review gate for map reconstruction
 * (ADR-0009). Shows the imported image with the extracted walls drawn over it on
 * a pan/zoom preview, so the user can check the fit at the edges before trusting
 * the geometry. Resolves "reconstruct" (build a board from the walls), "skin"
 * (place the image as a background only, no walls), or null (cancel).
 *
 * UI-only. Walls are supplied in IMAGE PIXELS so they draw directly in the
 * preview's coordinate space; the caller converts to mm for the board.
 */

import { createImagePreview } from "./imagePreview.js";

export interface WallSegmentPx {
  a: { x: number; y: number };
  b: { x: number; y: number };
}

export type WallsConfirmResult = "reconstruct" | "skin" | null;

export interface WallsConfirmOptions {
  imageUrl: string;
  imgWidth: number;
  imgHeight: number;
  /** Extracted walls, in image-pixel coordinates. */
  walls: WallSegmentPx[];
}

export function confirmWallsModal(opts: WallsConfirmOptions): Promise<WallsConfirmResult> {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");

    const close = (v: WallsConfirmResult): void => {
      backdrop.remove();
      document.removeEventListener("keydown", onKey);
      resolve(v);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") close(null);
    };

    const h = document.createElement("h2");
    h.textContent = "Confirm extracted walls";
    modal.appendChild(h);
    const sub = document.createElement("p");
    sub.textContent = "Red lines are the walls detected from the map. Scroll to zoom, drag to pan — check the fit, then reconstruct, or place the image as a plain background instead.";
    modal.appendChild(sub);

    const preview = createImagePreview({
      imageUrl: opts.imageUrl,
      imgWidth: opts.imgWidth,
      imgHeight: opts.imgHeight,
      overlay: (ctx, view) => {
        ctx.strokeStyle = "rgba(255, 40, 40, 0.9)";
        ctx.lineWidth = 2 / view.z;
        ctx.beginPath();
        for (const w of opts.walls) {
          ctx.moveTo(w.a.x, w.a.y);
          ctx.lineTo(w.b.x, w.b.y);
        }
        ctx.stroke();
      },
    });
    modal.appendChild(preview.canvas);

    const readout = document.createElement("div");
    readout.className = "modal-readout";
    readout.textContent = `${opts.walls.length} wall segments detected`;
    modal.appendChild(readout);

    const actions = document.createElement("div");
    actions.className = "modal-actions";
    const reconstruct = document.createElement("button");
    reconstruct.type = "button";
    reconstruct.className = "primary";
    reconstruct.textContent = "Reconstruct walls";
    reconstruct.addEventListener("click", () => close("reconstruct"));
    const skin = document.createElement("button");
    skin.type = "button";
    skin.textContent = "Background only";
    skin.addEventListener("click", () => close("skin"));
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => close(null));
    actions.append(reconstruct, skin, cancel);
    modal.appendChild(actions);

    document.addEventListener("keydown", onKey);
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close(null);
    });
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
  });
}
