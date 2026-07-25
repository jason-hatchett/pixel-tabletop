import { Board } from "./render/Board.js";
import { LocalSync } from "./net/sync.js";
import { makeInitialState, type Token } from "./domain/state.js";
import { RULE_SYSTEMS } from "./domain/rules/index.js";
import { getBaseOptions, findBaseOption } from "./domain/bases.js";
import { TEMPLATE_PRESETS, findTemplateSpec } from "./domain/templates.js";
import { getTerrainOptions, findTerrainOption } from "./domain/terrain.js";
import { inchesToMm } from "./domain/units.js";
import type { BaseShape } from "./domain/geometry.js";

// --- state + sync (swap LocalSync for WebSocketSync to go multiplayer) ---
const sync = new LocalSync(makeInitialState());

// Seed a few models so there's something to drag on first run.
function seed(): void {
  const mk = (
    id: string,
    x: number,
    y: number,
    base: BaseShape,
    color: number,
    facing = 0,
  ): Token => ({
    id,
    label: id,
    pos: { x: inchesToMm(x), y: inchesToMm(y) },
    base,
    facing,
    color,
    ownerId: null,
  });
  sync.dispatch({ type: "addToken", token: mk("A", 10, 8, { kind: "circle", radiusMm: 16 }, 0xef476f) });
  sync.dispatch({ type: "addToken", token: mk("B", 22, 14, { kind: "circle", radiusMm: 16 }, 0x06d6a0) });
  sync.dispatch({ type: "addToken", token: mk("C", 30, 20, { kind: "circle", radiusMm: 25 }, 0x118ab2) });
  // An oval "monster" base, rotated, to show non-circular edge-to-edge clearance.
  sync.dispatch({
    type: "addToken",
    token: mk("Ogre", 16, 22, { kind: "oval", radiusXMm: 52.5, radiusYMm: 35 }, 0xffd166, 0.6),
  });
}
seed();

// --- board ---
const host = document.getElementById("board-host")!;
const readout = document.getElementById("readout")!;
const board = new Board(host, sync, (t) => (readout.textContent = t));
await board.init();

// --- toolbar wiring ---
// The toolbar is organised into three sections:
//   1. Setup       — System, Mode (move vs place objects)
//   2. Objects     — in Place mode, what to place (Token / Terrain / Wall) + item
//   3. View & tools — Grid, Snap, Measure, Template (transient analysis overlays)
//
// State reduces to: a Mode, an object Type (used only in Place mode), and an
// analysis overlay (Measure/Template) that momentarily overrides the Mode. From
// those three, `apply()` derives every board setting in one place.
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const systemSelect = $<HTMLSelectElement>("system-select");
const modeSelect = $<HTMLSelectElement>("mode-select");
const objtypeSelect = $<HTMLSelectElement>("objtype-select");
const objitemSelect = $<HTMLSelectElement>("objitem-select");
const objitemLabel = $<HTMLLabelElement>("objitem-label");
const placeControls = $<HTMLSpanElement>("place-controls");
const moveHint = $<HTMLSpanElement>("move-hint");
const wallHint = $<HTMLSpanElement>("wall-hint");
const templateSelect = $<HTMLSelectElement>("template-select");
const gridToggle = $<HTMLButtonElement>("grid-toggle");
const snapToggle = $<HTMLButtonElement>("snap-toggle");
const measureToggle = $<HTMLButtonElement>("measure-toggle");
const templateToggle = $<HTMLButtonElement>("template-toggle");

let gridOn = true;
let gridSnap = true;
let analysis: "none" | "measure" | "template" = "none"; // overrides the mode

const systemId = () => sync.getState().systemId;
const currentBase = () => findBaseOption(systemId(), objitemSelect.value) ?? null;
const currentTerrain = () => findTerrainOption(systemId(), objitemSelect.value) ?? null;
const currentTemplate = () => findTemplateSpec(templateSelect.value) ?? null;

/** Repopulate the "Item" dropdown to match the current object type + system. */
function populateItemSelect(): void {
  const type = objtypeSelect.value;
  const opts =
    type === "token" ? getBaseOptions(systemId()) : type === "terrain" ? getTerrainOptions(systemId()) : [];
  objitemSelect.replaceChildren();
  for (const o of opts) {
    const el = document.createElement("option");
    el.value = o.id;
    el.textContent = o.label;
    objitemSelect.appendChild(el);
  }
}

/** Single source of truth: push Mode + Type + analysis into the board and UI. */
function apply(): void {
  const placeMode = modeSelect.value === "place";
  const type = objtypeSelect.value;
  const measuring = analysis === "measure";
  const templating = analysis === "template";

  // Analysis overlays take over the pointer; placement only runs otherwise.
  board.setMeasuring(measuring);
  board.setTemplateSpec(templating ? currentTemplate() : null);
  const placing = placeMode && analysis === "none";
  board.setPlaceBase(placing && type === "token" ? currentBase() : null);
  board.setPlaceTerrain(placing && type === "terrain" ? currentTerrain() : null);
  board.setWallMode(placing && type === "wall");

  // Section 2 visibility: object pickers in Place mode, a hint in Move mode.
  placeControls.style.display = placeMode ? "" : "none";
  moveHint.style.display = placeMode ? "none" : "";
  objitemLabel.style.display = type === "wall" ? "none" : "";
  wallHint.style.display = type === "wall" ? "" : "none";

  // Toggle labels + active highlight.
  gridToggle.textContent = `Grid: ${gridOn ? "on" : "off"}`;
  gridToggle.classList.toggle("on", gridOn);
  snapToggle.textContent = `Snap: ${gridSnap ? "on" : "off"}`;
  snapToggle.classList.toggle("on", gridSnap);
  measureToggle.textContent = `Measure: ${measuring ? "on" : "off"}`;
  measureToggle.classList.toggle("on", measuring);
  templateToggle.textContent = `Template: ${templating ? "on" : "off"}`;
  templateToggle.classList.toggle("on", templating);
}

for (const rs of Object.values(RULE_SYSTEMS)) {
  const opt = document.createElement("option");
  opt.value = rs.id;
  opt.textContent = rs.name;
  systemSelect.appendChild(opt);
}
for (const spec of TEMPLATE_PRESETS) {
  const el = document.createElement("option");
  el.value = spec.id;
  el.textContent = spec.label;
  templateSelect.appendChild(el);
}
systemSelect.value = systemId();
populateItemSelect();
apply();

systemSelect.addEventListener("change", () => {
  sync.dispatch({ type: "setSystem", systemId: systemSelect.value });
  populateItemSelect(); // bases and terrain are both system-specific
  board.setShowGrid(gridOn);
  apply();
});

// Selecting a Mode is a clean switch — cancel any analysis overlay.
modeSelect.addEventListener("change", () => {
  analysis = "none";
  apply();
});
objtypeSelect.addEventListener("change", () => {
  populateItemSelect();
  apply();
});
objitemSelect.addEventListener("change", apply);
templateSelect.addEventListener("change", apply);

gridToggle.addEventListener("click", () => {
  gridOn = !gridOn;
  board.setShowGrid(gridOn);
  apply();
});
snapToggle.addEventListener("click", () => {
  gridSnap = !gridSnap;
  board.setGridSnap(gridSnap);
  apply();
});
measureToggle.addEventListener("click", () => {
  analysis = analysis === "measure" ? "none" : "measure";
  apply();
});
templateToggle.addEventListener("click", () => {
  analysis = analysis === "template" ? "none" : "template";
  apply();
});
