/**
 * Everything in the engine is stored in MILLIMETRES of real tabletop surface.
 *
 * This is the single most important decision in the project: the domain never
 * stores pixels or grid squares. Pixels are a rendering concern (camera zoom);
 * grid squares and inches/feet are a *rule-system* interpretation of physical
 * distance. Keeping the core in mm lets one engine serve Warhammer (literal
 * inches on a physical table) and D&D 5E (abstract 5-ft grid) without forking.
 */

export const MM_PER_INCH = 25.4;

export const inchesToMm = (inches: number): number => inches * MM_PER_INCH;
export const mmToInches = (mm: number): number => mm / MM_PER_INCH;

/** A D&D "world" maps a grid cell to feet. Default: one 50 mm cell = 5 ft. */
export const DEFAULT_CELL_MM = 50;
export const DEFAULT_FEET_PER_CELL = 5;

const MM_PER_FOOT = DEFAULT_CELL_MM / DEFAULT_FEET_PER_CELL;
export const feetToMm = (feet: number): number => feet * MM_PER_FOOT;
