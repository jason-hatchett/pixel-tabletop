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

/**
 * Outline-detection controls the review gate can retune live (ADR-0012 §3). The
 * two are mutually exclusive: `adaptive` is the local-contrast detector (the
 * default), tuned by `adaptiveOffset`; `brightness` is a fixed global cutoff. The
 * user picks the mode and tunes it, so "auto" is a point on the same scale they
 * can always return to — not a different algorithm the slider can't reach.
 */
export type DetectParams =
  | { mode: "adaptive"; adaptiveOffset: number | null }
  | { mode: "brightness"; outlineBrightnessMax: number };

export interface TerrainConfirmResult {
  includeFlagged: boolean;
  /** The detection parameters the user settled on. */
  detect: DetectParams;
}

export interface TerrainConfirmOptions {
  imageUrl: string;
  imgWidth: number;
  imgHeight: number;
  /** Initial footprints (from the default adaptive detection). */
  footprints: FootprintPx[];
  /**
   * Re-run detection with the given parameters and return the new footprints in
   * image px. Enables the per-image threshold controls; omitted → no controls.
   */
  redetect?: (params: DetectParams) => FootprintPx[];
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
    let footprints = opts.footprints;
    // Detection params the user is on; defaults to the adaptive detector.
    let detect: DetectParams = { mode: "adaptive", adaptiveOffset: null };

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
        for (const f of footprints) {
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

    const readout = document.createElement("div");
    readout.className = "modal-readout";
    const setReadout = (): void => {
      const tall = footprints.filter((f) => !f.flagged && f.cls === "tall").length;
      const low = footprints.filter((f) => !f.flagged && f.cls === "low").length;
      const flagged = footprints.filter((f) => f.flagged).length;
      const placing = tall + low + (includeFlagged ? flagged : 0);
      readout.textContent =
        `${placing} pieces to place — ${tall} tall, ${low} low` + (flagged ? `, ${flagged} flagged${includeFlagged ? " (included)" : " (excluded)"}` : "");
    };
    setReadout();
    modal.appendChild(readout);

    const fields = document.createElement("div");
    fields.className = "modal-fields";
    modal.appendChild(fields);

    // --- outline-detection controls (only if the caller supports re-detection) ---
    // One mode selector + one slider that means the right thing per mode, so the
    // manual knob tunes the SAME detector as "auto" (adaptive) and can always reach
    // it — rather than silently swapping to a different algorithm (ADR-0012 §3).
    if (opts.redetect) {
      const redetect = opts.redetect;
      // Per-mode slider config; the adaptive default (offset null) sits at 16.
      const CFG = {
        adaptive: { min: 6, max: 34, def: 16, label: "Sensitivity (lower = more)" },
        brightness: { min: 40, max: 140, def: 80, label: "Outline brightness" },
      } as const;

      const row = document.createElement("div");
      row.className = "modal-field-row";

      const modeLabel = document.createElement("label");
      const mode = document.createElement("select");
      const optA = document.createElement("option");
      optA.value = "adaptive";
      optA.textContent = "Adaptive (auto)";
      const optB = document.createElement("option");
      optB.value = "brightness";
      optB.textContent = "Brightness";
      mode.append(optA, optB);
      modeLabel.append(document.createTextNode("Detection "), mode);

      const slider = document.createElement("input");
      slider.type = "range";
      slider.step = "1";
      const sliderLabel = document.createElement("label");
      const sliderText = document.createElement("span");
      const sliderVal = document.createElement("span");
      sliderLabel.append(sliderText, document.createTextNode(" "), sliderVal);

      const applySliderCfg = (m: "adaptive" | "brightness"): void => {
        const c = CFG[m];
        slider.min = String(c.min);
        slider.max = String(c.max);
        slider.value = String(c.def);
        sliderText.textContent = c.label;
        sliderVal.textContent = String(c.def);
      };
      applySliderCfg("adaptive");

      const currentParams = (): DetectParams => {
        const v = Number(slider.value);
        return mode.value === "brightness"
          ? { mode: "brightness", outlineBrightnessMax: v }
          : { mode: "adaptive", adaptiveOffset: v };
      };

      let raf = 0;
      const rerun = (): void => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          detect = currentParams();
          footprints = redetect(detect);
          setReadout();
          preview.redraw();
        });
      };
      mode.addEventListener("change", () => {
        applySliderCfg(mode.value as "adaptive" | "brightness");
        rerun();
      });
      slider.addEventListener("input", () => {
        sliderVal.textContent = slider.value;
        rerun();
      });

      row.append(modeLabel, sliderLabel, slider);
      fields.appendChild(row);
    }

    // --- include-flagged toggle ---
    const flagWrap = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.addEventListener("change", () => {
      includeFlagged = box.checked;
      setReadout();
      preview.redraw();
    });
    flagWrap.append(box, document.createTextNode(" Include flagged (red) blobs"));
    fields.appendChild(flagWrap);

    // --- actions ---
    const actions = document.createElement("div");
    actions.className = "modal-actions";
    const place = document.createElement("button");
    place.type = "button";
    place.className = "primary";
    place.textContent = "Place terrain";
    place.addEventListener("click", () => close({ includeFlagged, detect }));
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
