/**
 * A flat raster image (JPEG/PNG) placed on the board as a visual skin at true
 * physical scale — a battlemap background or a piece of terrain art.
 *
 * Millimetres only: the image's real-world size is baked into `widthMm`/
 * `heightMm` at import, so a known span measures correctly under any
 * `RuleSystem` ruler. No pixel, DPI, or grid field ever lives here (ADR-0001).
 * The bytes live in an out-of-domain asset store; state carries only an opaque
 * `assetRef`, so `BoardState` stays plain-JSON and portable (ADR-0008).
 *
 * An image placement is a *skin*: it carries no occlusion. LoS/cover come only
 * from real `Wall`/`TerrainPiece` geometry associated with it (hand-authored, or
 * extracted at import per ADR-0009), never inferred from pixels (pillar 4).
 */

import type { Vec2 } from "./geometry.js";

export interface ImagePlacement {
  id: string;
  /** Opaque reference into the asset store (id or URL). Never the raster bytes. */
  assetRef: string;
  /** Center of the image, in mm, in board space. */
  pos: Vec2;
  /** On-table size in mm, real-world scale baked in at import. */
  widthMm: number;
  heightMm: number;
  /** Rotation in radians (0 = upright, +x axis). */
  rotation: number;
}

/** The mutable fields a placement edit (drag/resize/rotate) may set. */
export type ImagePlacementPatch = Partial<Pick<ImagePlacement, "pos" | "widthMm" | "heightMm" | "rotation">>;
