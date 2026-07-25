/**
 * Measurement templates: area-of-effect shapes (blast circles, cones) used to
 * work out which models are affected. Unlike walls, a template is a transient
 * measuring aid (like the ruler), not persistent board state.
 *
 * Walls interact with templates here: a model whose base is under the template
 * but whose center is hidden from the template's origin (blast center / cone
 * apex) by a line-of-sight wall is treated as behind total cover and excluded
 * from the affected set.
 */

import type { Vec2, BaseShape } from "./geometry.js";
import { basePolygon, convexIntersect } from "./geometry.js";
import type { Wall } from "./walls.js";
import { lineOfSightBlocked } from "./walls.js";
import { inchesToMm } from "./units.js";

export type Template =
  | { kind: "circle"; center: Vec2; radiusMm: number }
  | { kind: "cone"; apex: Vec2; dirRad: number; lengthMm: number; halfAngleRad: number };

/** The point templates radiate from — used for line-of-sight blocking. */
export function templateOrigin(t: Template): Vec2 {
  return t.kind === "circle" ? t.center : t.apex;
}

const ARC_STEPS = 32;

/** Convex polygon outlining the template's area (for drawing and overlap). */
export function templatePolygon(t: Template): Vec2[] {
  if (t.kind === "circle") {
    const pts: Vec2[] = [];
    for (let i = 0; i < ARC_STEPS * 2; i++) {
      const a = (2 * Math.PI * i) / (ARC_STEPS * 2);
      pts.push({ x: t.center.x + Math.cos(a) * t.radiusMm, y: t.center.y + Math.sin(a) * t.radiusMm });
    }
    return pts;
  }
  // Cone: apex plus an arc of radius `lengthMm` spanning ±halfAngle around dir.
  // Convex as long as halfAngle < 90° (all our presets are ~26.6°).
  const pts: Vec2[] = [{ x: t.apex.x, y: t.apex.y }];
  for (let i = 0; i <= ARC_STEPS; i++) {
    const a = t.dirRad - t.halfAngleRad + (2 * t.halfAngleRad * i) / ARC_STEPS;
    pts.push({ x: t.apex.x + Math.cos(a) * t.lengthMm, y: t.apex.y + Math.sin(a) * t.lengthMm });
  }
  return pts;
}

export interface Placed {
  id: string;
  pos: Vec2;
  base: BaseShape;
  facing: number;
}

export interface TemplateResult {
  /** In the area with clear line-of-sight from the origin. */
  hit: string[];
  /** In the area but hidden from the origin by a wall (total cover). */
  covered: string[];
}

export function resolveTemplate(
  t: Template,
  tokens: Iterable<Placed>,
  walls: Iterable<Wall>,
): TemplateResult {
  const area = templatePolygon(t);
  const origin = templateOrigin(t);
  const wallArr = [...walls];
  const hit: string[] = [];
  const covered: string[] = [];
  for (const tok of tokens) {
    if (!convexIntersect(area, basePolygon(tok.pos, tok.base, tok.facing))) continue;
    if (lineOfSightBlocked(origin, tok.pos, wallArr)) covered.push(tok.id);
    else hit.push(tok.id);
  }
  return { hit, covered };
}

// ---- presets ----------------------------------------------------------------

export type TemplateSpec =
  | { id: string; label: string; kind: "circle"; radiusMm: number }
  | { id: string; label: string; kind: "cone"; lengthMm: number; halfAngleRad: number };

// D&D cones are as wide as they are long => half-angle = atan(0.5) ≈ 26.57°.
const DND_CONE_HALF_ANGLE = Math.atan(0.5);

export const TEMPLATE_PRESETS: TemplateSpec[] = [
  { id: "blast3", label: 'Blast 3"', kind: "circle", radiusMm: inchesToMm(1.5) },
  { id: "blast5", label: 'Blast 5"', kind: "circle", radiusMm: inchesToMm(2.5) },
  { id: "fireball", label: "Fireball (20 ft radius)", kind: "circle", radiusMm: 200 },
  { id: "cone15", label: "Cone 15 ft", kind: "cone", lengthMm: 150, halfAngleRad: DND_CONE_HALF_ANGLE },
  { id: "cone30", label: "Cone 30 ft", kind: "cone", lengthMm: 300, halfAngleRad: DND_CONE_HALF_ANGLE },
];

export function findTemplateSpec(id: string): TemplateSpec | undefined {
  return TEMPLATE_PRESETS.find((s) => s.id === id);
}

/** Build a concrete template from a preset, an origin, and an aim direction. */
export function buildTemplate(spec: TemplateSpec, origin: Vec2, dirRad: number): Template {
  return spec.kind === "circle"
    ? { kind: "circle", center: origin, radiusMm: spec.radiusMm }
    : { kind: "cone", apex: origin, dirRad, lengthMm: spec.lengthMm, halfAngleRad: spec.halfAngleRad };
}
