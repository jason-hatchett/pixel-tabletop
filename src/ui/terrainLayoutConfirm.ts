/**
 * Terrain-layout confirm modal — the review gate for Warhammer terrain-layout
 * import (ADR-0011). Draws every detected area-terrain footprint over the source
 * image on a pan/zoom preview, coloured by height (grey = tall, teal = low), with
 * ambiguous blobs (merged / L-shaped) outlined in red dashes. The user checks the
 * fit, decides whether to include the flagged blobs, then places — nothing is
 * committed until they do (pillar 4: geometry verified, never asserted).
 *
 * UI-only. Footprints arrive in IMAGE PIXELS so they draw in the preview's space;
 * the caller converts the accepted ones to mm for the board.
 */

import { createImagePreview } from "./imagePreview.js";

export interface FootprintPx {
  cx: number;
  cy: number;
  /** Long / short extents in image px. */
  long: number;
  short: number;
  /** Long-axis angle in radians. */
  angle: number;
  cls: "tall" | "low";
  /** Ambiguous blob (not a clean rectangle) — off by default. */
  flagged: boolean;
}

export interface TerrainConfirmResult {
  includeFlagged: boolean;
}

export interface TerrainConfirmOptions {
  imageUrl: string;
  imgWidth: number;
  imgHeight: number;
  footprints: FootprintPx[];
}

const TALL = "rgba(180, 190, 205, 0.95)";
const LOW = "rgba(90, 150, 210, 0.95)";
const FLAG = "rgba(255, 60, 60, 0.95)";

function corners(f: FootprintPx): [number, number][] {
  const ux = Math.cos(f.angle);
  const uy = Math.sin(f.angle);
  const vx = -uy;
  const vy = ux;
  const hl = f.long / 2;
  const hs = f.short / 2;
  return ([
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const).map(([sx, sy]) => [f.cx + sx * hl * ux + sy * hs * vx, f.cy + sx * hl * uy + sy * hs * vy]);
}

export function confirmTerrainLayoutModal(opts: TerrainConfirmOptions): Promise<TerrainConfirmResult | null> {
  return new Promise((resolve) => {
    let includeFlagged = false;

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");

    const close = (v: TerrainConfirmResult | null): void => {
      backdrop.remove();
      document.removeEventListener("keydown", onKey);
      resolve(v);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") close(null);
    };

    const h = document.createElement("h2");
    h.textContent = "Confirm detected terrain";
    modal.appendChild(h);
    const sub = document.createElement("p");
    sub.textContent =
      "Boxes are the area terrain detected from the layout — grey is tall (>4\"), teal is low (≤2\"). Scroll to zoom, drag to pan to check the fit. Red dashed boxes are ambiguous (touching or non-rectangular) and are left out unless you include them.";
    modal.appendChild(sub);

    const preview = createImagePreview({
      imageUrl: opts.imageUrl,
      imgWidth: opts.imgWidth,
      imgHeight: opts.imgHeight,
      overlay: (ctx, view) => {
        ctx.lineWidth = 2 / view.z;
        for (const f of opts.footprints) {
          const skip = f.flagged && !includeFlagged;
          const c = corners(f);
          ctx.beginPath();
          ctx.moveTo(c[0]![0], c[0]![1]);
          for (let i = 1; i < c.length; i++) ctx.lineTo(c[i]![0], c[i]![1]);
          ctx.closePath();
          ctx.setLineDash(f.flagged ? [8 / view.z, 6 / view.z] : []);
          ctx.strokeStyle = f.flagged ? FLAG : f.cls === "tall" ? TALL : LOW;
          ctx.globalAlpha = skip ? 0.35 : 1;
          if (!skip) {
            ctx.fillStyle = f.cls === "tall" ? "rgba(180,190,205,0.18)" : "rgba(90,150,210,0.18)";
            ctx.fill();
          }
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        ctx.setLineDash([]);
      },
    });
    modal.appendChild(preview.canvas);

    const tall = opts.footprints.filter((f) => !f.flagged && f.cls === "tall").length;
    const low = opts.footprints.filter((f) => !f.flagged && f.cls === "low").length;
    const flagged = opts.footprints.filter((f) => f.flagged).length;

    const readout = document.createElement("div");
    readout.className = "modal-readout";
    const setReadout = (): void => {
      const placing = tall + low + (includeFlagged ? flagged : 0);
      readout.textContent =
        `${placing} pieces to place — ${tall} tall, ${low} low` + (flagged ? `, ${flagged} flagged${includeFlagged ? " (included)" : " (excluded)"}` : "");
    };
    setReadout();
    modal.appendChild(readout);

    // --- include-flagged toggle (only if there are any) ---
    if (flagged > 0) {
      const fields = document.createElement("div");
      fields.className = "modal-fields";
      const wrap = document.createElement("label");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.addEventListener("change", () => {
        includeFlagged = box.checked;
        setReadout();
        preview.redraw();
      });
      wrap.append(box, document.createTextNode(" Include flagged (red) blobs"));
      fields.appendChild(wrap);
      modal.appendChild(fields);
    }

    // --- actions ---
    const actions = document.createElement("div");
    actions.className = "modal-actions";
    const place = document.createElement("button");
    place.type = "button";
    place.className = "primary";
    place.textContent = "Place terrain";
    place.addEventListener("click", () => close({ includeFlagged }));
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => close(null));
    actions.append(place, cancel);
    modal.appendChild(actions);

    document.addEventListener("keydown", onKey);
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close(null);
    });
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
  });
}
