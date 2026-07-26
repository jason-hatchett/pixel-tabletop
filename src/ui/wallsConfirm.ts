/**
 * Walls-confirm modal — the staged review gate for map reconstruction
 * (ADR-0009). Shows the imported image with the extracted walls drawn over it on
 * a pan/zoom preview, so the user can check the fit before trusting the geometry.
 * A "Map style" dropdown re-extracts live (auto / blueprint / linework) so a
 * mis-detected style can be corrected. Resolves with the chosen action + style,
 * or null (cancel).
 *
 * UI-only. Walls come back from `analyze(mode)` in IMAGE PIXELS so they draw in
 * the preview's coordinate space; the caller converts to mm for the board.
 */

import { createImagePreview } from "./imagePreview.js";
import type { MapStyle } from "../ingest/mapAnalyzer.js";

export interface WallSegmentPx {
  a: { x: number; y: number };
  b: { x: number; y: number };
}

export interface WallsConfirmResult {
  action: "reconstruct" | "skin";
  mode: MapStyle;
}

export interface WallsConfirmOptions {
  imageUrl: string;
  imgWidth: number;
  imgHeight: number;
  initialMode: MapStyle;
  /** Re-extract walls (in image pixels) for a chosen style. */
  analyze: (mode: MapStyle) => WallSegmentPx[];
}

export function confirmWallsModal(opts: WallsConfirmOptions): Promise<WallsConfirmResult | null> {
  return new Promise((resolve) => {
    let mode = opts.initialMode;
    let walls = opts.analyze(mode);

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");

    const close = (v: WallsConfirmResult | null): void => {
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
    sub.textContent = "Red lines are the walls detected from the map. Scroll to zoom, drag to pan — check the fit. If they're wrong, try a different map style, then reconstruct (or place the image as a plain background).";
    modal.appendChild(sub);

    const preview = createImagePreview({
      imageUrl: opts.imageUrl,
      imgWidth: opts.imgWidth,
      imgHeight: opts.imgHeight,
      overlay: (ctx, view) => {
        ctx.strokeStyle = "rgba(255, 40, 40, 0.9)";
        ctx.lineWidth = 2 / view.z;
        ctx.beginPath();
        for (const w of walls) {
          ctx.moveTo(w.a.x, w.a.y);
          ctx.lineTo(w.b.x, w.b.y);
        }
        ctx.stroke();
      },
    });
    modal.appendChild(preview.canvas);

    const readout = document.createElement("div");
    readout.className = "modal-readout";
    const setReadout = (): void => {
      readout.textContent = `${walls.length} wall segments detected`;
    };
    setReadout();
    modal.appendChild(readout);

    // --- map-style override ---
    const fields = document.createElement("div");
    fields.className = "modal-fields";
    const wrap = document.createElement("label");
    wrap.textContent = "Map style";
    const select = document.createElement("select");
    for (const [value, text] of [
      ["auto", "Auto-detect"],
      ["blueprint", "Blueprint (colour background)"],
      ["linework", "Linework (ink on paper)"],
    ] as const) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = text;
      select.appendChild(opt);
    }
    select.value = mode;
    select.addEventListener("change", () => {
      mode = select.value as MapStyle;
      walls = opts.analyze(mode);
      setReadout();
      preview.redraw();
    });
    wrap.appendChild(select);
    fields.appendChild(wrap);
    modal.appendChild(fields);

    // --- actions ---
    const actions = document.createElement("div");
    actions.className = "modal-actions";
    const reconstruct = document.createElement("button");
    reconstruct.type = "button";
    reconstruct.className = "primary";
    reconstruct.textContent = "Reconstruct walls";
    reconstruct.addEventListener("click", () => close({ action: "reconstruct", mode }));
    const skin = document.createElement("button");
    skin.type = "button";
    skin.textContent = "Background only";
    skin.addEventListener("click", () => close({ action: "skin", mode }));
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
