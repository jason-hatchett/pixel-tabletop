import { Board } from "./render/Board.js";
import { LocalSync } from "./net/sync.js";
import { makeInitialState, type Token } from "./domain/state.js";
import { RULE_SYSTEMS, getRuleSystem } from "./domain/rules/index.js";
import { getBaseOptions, findBaseOption } from "./domain/bases.js";
import { TEMPLATE_PRESETS, findTemplateSpec } from "./domain/templates.js";
import { getTerrainOptions, findTerrainOption } from "./domain/terrain.js";
import { inchesToMm, DEFAULT_CELL_MM } from "./domain/units.js";
import type { BaseShape } from "./domain/geometry.js";
import { LocalBoardStore, localStorageKV, serialize, deserialize } from "./persist/boardStore.js";
import { SessionAssetStore } from "./ingest/assetStore.js";
import { decodeImageData } from "./ingest/decode.js";
import { mmExtentFromSpan, alignEdgeToGrid } from "./ingest/calibrate.js";
import { detectGrid } from "./ingest/gridDetect.js";
import { analyzeMap, layoutMapBoard } from "./ingest/mapAnalyzer.js";
import { chooseModal } from "./ui/modal.js";
import { confirmGridModal, type GridConfirmResult } from "./ui/gridConfirm.js";
import { confirmWallsModal, type WallsConfirmResult } from "./ui/wallsConfirm.js";
import type { BoardState } from "./domain/state.js";
import type { Wall } from "./domain/walls.js";
import type { PixelBuffer } from "./ingest/decode.js";

// Standard Warhammer 40k battlefield sizes (real inches). A 40k map is scaled to
// one of these physical rectangles rather than grid-detected (40k is gridless).
const BATTLEFIELD_SIZES = [
  { label: "Incursion", w: 44, h: 30 },
  { label: "Strike Force", w: 60, h: 44 },
  { label: "Onslaught", w: 90, h: 44 },
] as const;

// --- state + sync (swap LocalSync for WebSocketSync to go multiplayer) ---
// Restore the autosaved working board on reload; otherwise seed a demo board.
const store = new LocalBoardStore(localStorageKV());
let initialState = makeInitialState();
let restored = false;
try {
  const last = store.getLast();
  if (last) {
    initialState = last;
    restored = true;
  }
} catch {
  /* corrupt autosave — start fresh */
}
const sync = new LocalSync(initialState);

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
if (!restored) seed();

// --- board ---
const host = document.getElementById("board-host")!;
const readout = document.getElementById("readout")!;
const board = new Board(host, sync, (t) => (readout.textContent = t));
// Session-scoped raster store: BoardState holds only assetRefs (ADR-0008).
const assets = new SessionAssetStore();
board.setAssetStore(assets);
// Renderer init (PixiJS WebGL/WebGPU) can fail on machines without a usable GPU
// context. Don't let that abort the whole module — the toolbar/dropdowns below
// must still populate. Surface the reason on-page instead of a silent blank.
try {
  await board.init();
} catch (err) {
  console.error("Board renderer failed to initialise:", err);
  host.innerHTML =
    `<div style="padding:1rem;color:#ef476f;font:14px/1.5 system-ui">` +
    `Renderer failed to start (WebGL/WebGPU unavailable). ` +
    `Enable hardware acceleration in your browser and reload.<br><br>` +
    `<code style="color:#ffd166">${String((err as Error)?.message ?? err)}</code></div>`;
}

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

// --- persistence (Game section: save/load by name, export/import) ---
const gameName = $<HTMLInputElement>("game-name");
const saveBtn = $<HTMLButtonElement>("save-btn");
const loadSelect = $<HTMLSelectElement>("load-select");
const deleteBtn = $<HTMLButtonElement>("delete-btn");
const exportBtn = $<HTMLButtonElement>("export-btn");
const importBtn = $<HTMLButtonElement>("import-btn");
const importFile = $<HTMLInputElement>("import-file");

function refreshLoadList(): void {
  loadSelect.replaceChildren(new Option("Load…", ""));
  for (const n of store.list()) loadSelect.appendChild(new Option(n, n));
}
refreshLoadList();

// After a full-board load, resync the toolbar to the loaded system.
function afterLoad(): void {
  systemSelect.value = systemId();
  populateItemSelect();
  board.setShowGrid(gridOn);
  apply();
}

// Debounced autosave of the current working board.
let saveTimer: number | undefined;
sync.subscribe(() => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      store.putLast(sync.getState());
    } catch {
      /* storage full/unavailable — ignore */
    }
  }, 400);
});

saveBtn.addEventListener("click", () => {
  const name = gameName.value.trim();
  if (!name) return gameName.focus();
  store.put(name, sync.getState());
  refreshLoadList();
  loadSelect.value = name;
});

loadSelect.addEventListener("change", () => {
  const name = loadSelect.value;
  if (!name) return;
  const s = store.get(name);
  if (s) {
    sync.dispatch({ type: "loadState", state: s });
    gameName.value = name;
    afterLoad();
  }
});

deleteBtn.addEventListener("click", () => {
  const name = loadSelect.value || gameName.value.trim();
  if (!name) return;
  store.delete(name);
  refreshLoadList();
});

exportBtn.addEventListener("click", () => {
  const name = gameName.value.trim() || "board";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([serialize(sync.getState())], { type: "application/json" }));
  a.download = `${name}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

importBtn.addEventListener("click", () => importFile.click());
importFile.addEventListener("change", async () => {
  const file = importFile.files?.[0];
  if (file) {
    try {
      sync.dispatch({ type: "loadState", state: deserialize(await file.text()) });
      afterLoad();
    } catch (e) {
      alert(`Import failed: ${(e as Error).message}`);
    }
  }
  importFile.value = "";
});

// --- map image (Slice A: import + calibrate + place a raster skin) ---
const imageBtn = $<HTMLButtonElement>("image-btn");
const imageFile = $<HTMLInputElement>("image-file");

/** Resolve to the picked file (or null); clears the input for reuse. */
function pickFile(input: HTMLInputElement): Promise<File | null> {
  return new Promise((resolve) => {
    const onChange = (): void => {
      input.removeEventListener("change", onChange);
      const f = input.files?.[0] ?? null;
      input.value = "";
      resolve(f);
    };
    input.addEventListener("change", onChange);
    input.click();
  });
}

/** Place an imported image, sized in mm; centered on the board unless `pos` given. */
function placeImage(file: File, widthMm: number, heightMm: number, pos?: { x: number; y: number }): void {
  const ref = assets.add(file);
  const st = sync.getState();
  sync.dispatch({
    type: "addImage",
    image: {
      id: crypto.randomUUID(),
      assetRef: ref,
      pos: pos ?? { x: st.widthMm / 2, y: st.heightMm / 2 },
      widthMm,
      heightMm,
      rotation: 0,
    },
  });
}

/** Place the image as an aligned background skin (no walls). */
function placeAlignedSkin(file: File, img: PixelBuffer, res: GridConfirmResult, mmPerPx: number, cellMm: number): void {
  const widthMm = img.width * mmPerPx;
  const heightMm = img.height * mmPerPx;
  const st = sync.getState();
  const leftMm = alignEdgeToGrid(st.widthMm / 2 - widthMm / 2, res.offsetX * mmPerPx, cellMm);
  const topMm = alignEdgeToGrid(st.heightMm / 2 - heightMm / 2, res.offsetY * mmPerPx, cellMm);
  placeImage(file, widthMm, heightMm, { x: leftMm + widthMm / 2, y: topMm + heightMm / 2 });
}

/**
 * Reconstruct a whole board from the map: a fresh BoardState with the extracted
 * walls plus the source image as a grid-aligned skin beneath them, loaded via
 * `loadState` (one undoable step, ADR-0009). Replaces the current board.
 */
function reconstructMapBoard(
  file: File,
  img: PixelBuffer,
  res: GridConfirmResult,
  mmPerPx: number,
  cellMm: number,
  analysis: ReturnType<typeof analyzeMap>,
): void {
  const layout = layoutMapBoard(analysis, {
    imgWidth: img.width,
    imgHeight: img.height,
    mmPerPx,
    cellMm,
    gridOffsetXpx: res.offsetX,
    gridOffsetYpx: res.offsetY,
  });
  const ref = assets.add(file);
  const imgId = crypto.randomUUID();
  const walls: Record<string, Wall> = {};
  for (const w of layout.walls) walls[w.id] = w;
  const board: BoardState = {
    widthMm: layout.widthMm,
    heightMm: layout.heightMm,
    systemId: systemId(),
    tokens: {},
    walls,
    terrain: {},
    images: {
      [imgId]: {
        id: imgId,
        assetRef: ref,
        pos: { x: layout.imageTopLeftMm.x + layout.widthMm / 2, y: layout.imageTopLeftMm.y + layout.heightMm / 2 },
        widthMm: layout.widthMm,
        heightMm: layout.heightMm,
        rotation: 0,
      },
    },
  };
  sync.dispatch({ type: "loadState", state: board });
  afterLoad();
}

/**
 * D&D placement: detect the image grid, infer scale (1 image square = 1 board
 * cell), and align the image so its gridlines fall on the board grid. On accept,
 * offer wall reconstruction (staged preview) or a plain aligned background.
 * Falls back to manual width if detection fails or is rejected. Returns true if
 * the image was placed.
 */
async function placeDndImage(file: File): Promise<boolean> {
  const img = await decodeImageData(file);
  const cellMm = getRuleSystem(systemId()).grid?.cellMm ?? DEFAULT_CELL_MM;
  const det = detectGrid(img);

  if (det) {
    // Show the detected grid over the image so the user can verify/adjust the fit.
    const url = URL.createObjectURL(file);
    let res: GridConfirmResult | "manual" | null;
    try {
      res = await confirmGridModal({
        imageUrl: url,
        imgWidth: img.width,
        imgHeight: img.height,
        detection: det,
        cellLabel: "5 ft",
      });
    } finally {
      URL.revokeObjectURL(url);
    }
    if (res === null) return false;
    if (res !== "manual") {
      const mmPerPx = cellMm / res.pxPerCell;
      // Extract walls and show the staged review gate: reconstruct, skin-only, or cancel.
      const analysis = analyzeMap(img, { mmPerPx });
      const wallsUrl = URL.createObjectURL(file);
      let choice: WallsConfirmResult;
      try {
        choice = await confirmWallsModal({
          imageUrl: wallsUrl,
          imgWidth: img.width,
          imgHeight: img.height,
          walls: analysis.walls.map((w) => ({
            a: { x: w.a.x / mmPerPx, y: w.a.y / mmPerPx },
            b: { x: w.b.x / mmPerPx, y: w.b.y / mmPerPx },
          })),
        });
      } finally {
        URL.revokeObjectURL(wallsUrl);
      }
      if (choice === null) return false;
      if (choice === "reconstruct") reconstructMapBoard(file, img, res, mmPerPx, cellMm, analysis);
      else placeAlignedSkin(file, img, res, mmPerPx, cellMm);
      return true;
    }
    // "manual" falls through
  }

  const answer = prompt(
    `${det ? "" : "No grid detected. "}Real-world width of this image, in inches?\n(image is ${img.width}×${img.height}px)`,
    "44",
  );
  if (answer === null) return false;
  const inches = Number(answer);
  if (!Number.isFinite(inches) || inches <= 0) {
    alert("Enter a positive number of inches.");
    return false;
  }
  const { widthMm, heightMm } = mmExtentFromSpan(img.width, img.height, img.width, inchesToMm(inches));
  placeImage(file, widthMm, heightMm);
  return true;
}

imageBtn.addEventListener("click", async () => {
  try {
    // Ask game type first (no file needed), then pick the image.
    const game = await chooseModal<"dnd" | "40k">(
      "Import map image",
      [
        { label: "Dungeons & Dragons 5E", value: "dnd", sub: "Match the image grid to the board grid" },
        { label: "Warhammer 40k / AoS", value: "40k", sub: "Scale to a standard battlefield size" },
      ],
      { subtitle: "What is this map for?" },
    );
    if (!game) return;

    const file = await pickFile(imageFile);
    if (!file) return;

    if (game === "40k") {
      const size = await chooseModal(
        "Battlefield size",
        BATTLEFIELD_SIZES.map((s) => ({ label: s.label, value: s, sub: `${s.w}" × ${s.h}"` })),
        { subtitle: "The image is scaled to this physical size." },
      );
      if (!size) return;
      placeImage(file, inchesToMm(size.w), inchesToMm(size.h));
    } else {
      await placeDndImage(file);
    }
  } catch (e) {
    alert(`Image import failed: ${(e as Error).message}`);
  }
});
