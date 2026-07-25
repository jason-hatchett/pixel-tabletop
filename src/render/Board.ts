/**
 * PixiJS presentation layer.
 *
 * The engine draws in millimetres: the `world` container is positioned/scaled to
 * act as the camera, and every child lives at raw mm coordinates. Screen<->world
 * conversion is just `world.toLocal(globalPoint)`. Rendering never writes to the
 * board state directly — it dispatches actions through the BoardSync.
 */

import {
  Application,
  Container,
  Graphics,
  Text,
  Rectangle,
  type FederatedPointerEvent,
} from "pixi.js";
import type { BoardSync } from "../net/sync.js";
import type { RuleSystem } from "../domain/rules/index.js";
import { getRuleSystem } from "../domain/rules/index.js";
import type { MeasureTarget } from "../domain/rules/types.js";
import type { Token } from "../domain/state.js";
import type { Vec2, BaseShape } from "../domain/geometry.js";
import { pointInBase, boundingRadius, dist, pointSegmentDistance, basePolygon, footprint } from "../domain/geometry.js";
import type { BaseOption } from "../domain/bases.js";
import type { Wall } from "../domain/walls.js";
import { shadowQuad, umbraQuad, umbraOfOccluder } from "../domain/walls.js";
import type { Template, TemplateSpec, TemplateResult } from "../domain/templates.js";
import { buildTemplate, templatePolygon, templateOrigin, resolveTemplate } from "../domain/templates.js";
import type { TerrainPiece, TerrainOption } from "../domain/terrain.js";
import { terrainVirtualWalls, terrainCoverAt } from "../domain/terrain.js";
import { hasLineOfSight, whollyWithin } from "../domain/los.js";
import { inchesToMm } from "../domain/units.js";

const LOS_RANGE_MM = inchesToMm(80); // Warhammer unit sightline range (per request)

const MIN_SCALE = 0.15; // screen px per mm
const MAX_SCALE = 6;
const WALL_MIN_LEN = 8; // mm; ignore accidental micro-drags

const PLACE_COLORS = [
  0xef476f, 0x06d6a0, 0x118ab2, 0xffd166, 0x8338ec, 0xfb5607, 0x3a86ff, 0x2ec4b6,
];

export class Board {
  readonly app = new Application();
  private world = new Container();
  private gridLayer = new Graphics();
  // Terrain pieces: one {fill, pattern (hatch/dots), mask} container per piece
  // so hatch/dot decoration stays clipped to the (possibly rotated) shape.
  private terrainLayer = new Container();
  private terrainGfx = new Map<
    string,
    { container: Container; fill: Graphics; pattern: Graphics; mask: Graphics }
  >();
  private wallLayer = new Graphics();
  // Line-of-sight overlay (Warhammer, selected unit): lit fill + wall shadows.
  // Rendered BELOW terrain so a feature's own footprint stays lit ("seeing in").
  private losLayer = new Container();
  private losBase = new Graphics();
  private losShadow = new Graphics();
  private losMask = new Graphics();
  private losRings = new Graphics(); // visible/blocked rings — drawn ABOVE tokens
  // Active template: affected-area fill, wall shadows (masked to the area), rings.
  private templateLayer = new Container();
  private tplArea = new Graphics();
  private tplShadow = new Graphics();
  private tplMask = new Graphics();
  private tplRings = new Graphics();
  private tokenLayer = new Container();
  private selectionLayer = new Graphics(); // selection ring + rotation handle (world space)
  private previewLayer = new Graphics(); // transient wall being drawn (world space)
  private overlay = new Graphics(); // ruler graphics (screen space)
  private overlayLabel = new Text({ text: "", style: { fill: 0xffffff, fontSize: 13 } });

  private tokenGfx = new Map<string, Graphics>();
  private showGrid = true;
  private measuring = false;
  private placeBase: BaseOption | null = null;
  private placeCount = 0;
  private wallMode = false;
  private gridSnap = true; // snap walls AND token/terrain drops to the grid when one is active
  private templateSpec: TemplateSpec | null = null;
  private activeTemplate: Template | null = null;
  private placeTerrain: TerrainOption | null = null;

  // interaction state
  private dragTokenId: string | null = null;
  private dragOffset: Vec2 = { x: 0, y: 0 };
  private panning = false;
  private panLast: Vec2 = { x: 0, y: 0 };
  private rulerStart: MeasureTarget | null = null;
  private selectedId: string | null = null;
  private selectedWallId: string | null = null;
  private selectedTerrainId: string | null = null;
  private rotatingId: string | null = null;
  private rotatingTerrainId: string | null = null;
  private dragTerrainId: string | null = null;
  private dragTerrainOffset: Vec2 = { x: 0, y: 0 };
  private wallStart: Vec2 | null = null;
  private buildingTemplate = false;

  constructor(
    private host: HTMLElement,
    private sync: BoardSync,
    private onReadout: (text: string) => void,
  ) {}

  async init(): Promise<void> {
    await this.app.init({
      background: 0x11141c,
      resizeTo: this.host,
      antialias: false,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio, 2),
    });
    this.host.appendChild(this.app.canvas);

    this.losLayer.addChild(this.losBase, this.losShadow, this.losMask);
    this.losShadow.mask = this.losMask; // shadows only render inside the LoS circle
    this.templateLayer.addChild(this.tplArea, this.tplShadow, this.tplMask, this.tplRings);
    this.tplShadow.mask = this.tplMask; // shadows only render inside the template area

    this.world.addChild(this.gridLayer);
    // LoS lit-area + shadows sit UNDER terrain so a feature's footprint isn't
    // darkened by any shadow — you can always see models inside terrain.
    this.world.addChild(this.losLayer);
    this.world.addChild(this.terrainLayer);
    this.world.addChild(this.wallLayer);
    this.world.addChild(this.templateLayer);
    this.world.addChild(this.tokenLayer);
    this.world.addChild(this.losRings); // visible/blocked rings above tokens
    this.world.addChild(this.selectionLayer);
    this.world.addChild(this.previewLayer);
    this.app.stage.addChild(this.world);
    this.app.stage.addChild(this.overlay);
    this.app.stage.addChild(this.overlayLabel);

    const st = this.sync.getState();
    this.world.scale.set(1);
    this.world.position.set(
      (this.app.screen.width - st.widthMm) / 2,
      (this.app.screen.height - st.heightMm) / 2,
    );

    this.setupInput();
    window.addEventListener("keydown", (e) => this.onKeyDown(e));
    this.sync.subscribe(() => this.redraw());
    this.redraw();
  }

  private rules(): RuleSystem {
    return getRuleSystem(this.sync.getState().systemId);
  }

  private wallsArray(): Wall[] {
    return Object.values(this.sync.getState().walls);
  }

  private terrainArray(): TerrainPiece[] {
    return Object.values(this.sync.getState().terrain);
  }

  /**
   * Real walls PLUS ALL FOUR polygon edges of LoS-blocking terrain. Correct for
   * orientation-agnostic segment-intersection checks — cover's corner count,
   * template hit/covered resolution — where a sightline crossing any edge of a
   * solid block really is blocked. Do NOT use this to construct a shadow
   * polygon for drawing; see `shadowWalls`.
   */
  private losWalls(): Wall[] {
    return [...this.wallsArray(), ...terrainVirtualWalls(this.terrainArray())];
  }

  /** LoS-blocking terrain pieces as convex occluder polygons, for shadow
   * casting (`umbraOfOccluder`). A block must be shadowed as one whole occluder,
   * not as independent edges — see `umbraOfOccluder`. */
  private terrainOccluders(): Vec2[][] {
    const out: Vec2[][] = [];
    for (const piece of this.terrainArray()) {
      if (piece.losBlocking !== "blocks") continue;
      out.push(basePolygon(piece.pos, piece.base, piece.facing));
    }
    return out;
  }

  setShowGrid(v: boolean): void {
    this.showGrid = v;
    this.redraw();
  }

  setMeasuring(v: boolean): void {
    this.measuring = v;
    this.rulerStart = null;
    this.overlay.clear();
    this.overlayLabel.text = "";
  }

  setPlaceBase(opt: BaseOption | null): void {
    this.placeBase = opt;
  }

  setPlaceTerrain(opt: TerrainOption | null): void {
    this.placeTerrain = opt;
  }

  setWallMode(v: boolean): void {
    this.wallMode = v;
    this.wallStart = null;
    this.previewLayer.clear();
  }

  setGridSnap(v: boolean): void {
    this.gridSnap = v;
  }

  /** True when grid snapping should apply (toggle on, grid shown, grid exists). */
  private gridSnapActive(): boolean {
    return this.gridSnap && this.showGrid && this.rules().grid !== null;
  }

  /** Snap a wall endpoint to the nearest grid vertex when snapping is active. */
  private snapWallPoint(p: Vec2): Vec2 {
    const grid = this.rules().grid;
    if (this.gridSnapActive() && grid) {
      const c = grid.cellMm;
      return { x: Math.round(p.x / c) * c, y: Math.round(p.y / c) * c };
    }
    return p;
  }

  /** Enter template-aiming mode with a preset, or null to leave (and clear). */
  setTemplateSpec(spec: TemplateSpec | null): void {
    this.templateSpec = spec;
    if (!spec) {
      this.activeTemplate = null;
      this.onReadout("");
    }
    this.drawTemplate();
  }

  // ---- input --------------------------------------------------------------

  private setupInput(): void {
    const stage = this.app.stage;
    stage.eventMode = "static";
    stage.hitArea = new Rectangle(0, 0, this.app.screen.width, this.app.screen.height);
    this.app.renderer.on("resize", (w: number, h: number) => {
      stage.hitArea = new Rectangle(0, 0, w, h);
    });

    stage.on("pointerdown", (e: FederatedPointerEvent) => this.onPointerDown(e));
    stage.on("pointermove", (e: FederatedPointerEvent) => this.onPointerMove(e));
    stage.on("pointerup", () => this.onPointerUp());
    stage.on("pointerupoutside", () => this.onPointerUp());

    this.app.canvas.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
  }

  private worldOf(global: { x: number; y: number }): Vec2 {
    const p = this.world.toLocal(global);
    return { x: p.x, y: p.y };
  }

  private onPointerDown(e: FederatedPointerEvent): void {
    const world = this.worldOf(e.global);

    if (this.placeBase) {
      this.placeToken(this.placeBase, world);
      return;
    }
    if (this.placeTerrain) {
      this.placeTerrainPiece(this.placeTerrain, world);
      return;
    }
    if (this.wallMode) {
      this.wallStart = this.snapWallPoint(world);
      this.lastWallEnd = this.wallStart;
      return;
    }
    if (this.templateSpec) {
      this.buildingTemplate = true;
      this.activeTemplate = buildTemplate(this.templateSpec, world, 0);
      this.drawTemplate();
      return;
    }
    if (this.measuring) {
      this.rulerStart = this.targetAt(world);
      return;
    }
    if (this.selectedId) {
      const t = this.sync.getState().tokens[this.selectedId];
      if (t && this.handleHitAt(t, e.global)) {
        this.rotatingId = this.selectedId;
        return;
      }
    }
    if (this.selectedTerrainId) {
      const tp = this.sync.getState().terrain[this.selectedTerrainId];
      if (tp && this.handleHitAt(tp, e.global)) {
        this.rotatingTerrainId = this.selectedTerrainId;
        return;
      }
    }

    const hitId = this.tokenAt(world);
    if (hitId) {
      const t = this.sync.getState().tokens[hitId]!;
      this.setSelected(hitId);
      this.dragTokenId = hitId;
      this.dragOffset = { x: world.x - t.pos.x, y: world.y - t.pos.y };
      return;
    }

    const terrainId = this.terrainAt(world);
    if (terrainId) {
      const tp = this.sync.getState().terrain[terrainId]!;
      this.setSelectedTerrain(terrainId);
      this.dragTerrainId = terrainId;
      this.dragTerrainOffset = { x: world.x - tp.pos.x, y: world.y - tp.pos.y };
      return;
    }

    const wallId = this.wallAt(world);
    if (wallId) {
      this.setSelectedWall(wallId);
      return;
    }

    this.setSelected(null);
    this.setSelectedWall(null);
    this.setSelectedTerrain(null);
    this.panning = true;
    this.panLast = { x: e.global.x, y: e.global.y };
  }

  /** Nearest terrain piece under a world point (topmost first). */
  private terrainAt(world: Vec2): string | null {
    const terrain = this.sync.getState().terrain;
    for (const id of Object.keys(terrain).reverse()) {
      const t = terrain[id]!;
      if (pointInBase(world, t.pos, t.base, t.facing)) return id;
    }
    return null;
  }

  /** Nearest wall within a small screen-space threshold of a world point. */
  private wallAt(world: Vec2): string | null {
    const threshold = 10 / this.world.scale.x; // ~10 screen px, zoom-independent
    let best: string | null = null;
    let bestD = threshold;
    for (const w of this.wallsArray()) {
      const d = pointSegmentDistance(world, w.a, w.b);
      if (d <= bestD) {
        bestD = d;
        best = w.id;
      }
    }
    return best;
  }

  private onPointerMove(e: FederatedPointerEvent): void {
    if (this.wallMode && this.wallStart) {
      this.drawWallPreview(this.wallStart, this.snapWallPoint(this.worldOf(e.global)));
      return;
    }
    if (this.buildingTemplate && this.activeTemplate && this.templateSpec) {
      const w = this.worldOf(e.global);
      const origin = this.templateSpec.kind === "cone" ? templateApex(this.activeTemplate) : w;
      const dir =
        this.templateSpec.kind === "cone"
          ? Math.atan2(w.y - origin.y, w.x - origin.x)
          : 0;
      this.activeTemplate = buildTemplate(this.templateSpec, origin, dir);
      this.drawTemplate();
      return;
    }
    if (this.measuring && this.rulerStart) {
      this.drawRuler(this.rulerStart, this.targetAt(this.worldOf(e.global)));
      return;
    }
    if (this.rotatingId) {
      const w = this.worldOf(e.global);
      const t = this.sync.getState().tokens[this.rotatingId];
      if (t) {
        let facing = Math.atan2(w.y - t.pos.y, w.x - t.pos.x);
        if (e.shiftKey) {
          const step = Math.PI / 12;
          facing = Math.round(facing / step) * step;
        }
        this.sync.dispatch({ type: "rotateToken", id: this.rotatingId, facing });
      }
      return;
    }
    if (this.rotatingTerrainId) {
      const w = this.worldOf(e.global);
      const t = this.sync.getState().terrain[this.rotatingTerrainId];
      if (t) {
        let facing = Math.atan2(w.y - t.pos.y, w.x - t.pos.x);
        if (e.shiftKey) {
          const step = Math.PI / 12;
          facing = Math.round(facing / step) * step;
        }
        this.sync.dispatch({ type: "rotateTerrain", id: this.rotatingTerrainId, facing });
      }
      return;
    }
    if (this.dragTokenId) {
      const w = this.worldOf(e.global);
      this.sync.dispatch({
        type: "moveToken",
        id: this.dragTokenId,
        pos: { x: w.x - this.dragOffset.x, y: w.y - this.dragOffset.y },
      });
      return;
    }
    if (this.dragTerrainId) {
      const w = this.worldOf(e.global);
      this.sync.dispatch({
        type: "moveTerrain",
        id: this.dragTerrainId,
        pos: { x: w.x - this.dragTerrainOffset.x, y: w.y - this.dragTerrainOffset.y },
      });
      return;
    }
    if (this.panning) {
      this.world.position.x += e.global.x - this.panLast.x;
      this.world.position.y += e.global.y - this.panLast.y;
      this.panLast = { x: e.global.x, y: e.global.y };
    }
  }

  private onPointerUp(): void {
    if (this.wallStart) {
      const end = this.lastWallEnd;
      if (end && dist(this.wallStart, end) >= WALL_MIN_LEN) {
        this.sync.dispatch({
          type: "addWall",
          wall: { id: crypto.randomUUID(), a: this.wallStart, b: end, blocksLoS: true, blocksMove: true },
        });
      }
      this.wallStart = null;
      this.previewLayer.clear();
    }
    if (this.dragTokenId) {
      const t = this.sync.getState().tokens[this.dragTokenId];
      if (t) {
        // Only snap to the grid when snapping is active; otherwise leave the
        // token exactly where it was dropped.
        const pos = this.gridSnapActive() ? this.rules().snap(t.pos, t.base) : t.pos;
        this.sync.dispatch({ type: "moveToken", id: this.dragTokenId, pos });
      }
    }
    if (this.dragTerrainId) {
      const t = this.sync.getState().terrain[this.dragTerrainId];
      if (t) {
        const pos = this.gridSnapActive() ? this.rules().snap(t.pos, t.base) : t.pos;
        this.sync.dispatch({ type: "moveTerrain", id: this.dragTerrainId, pos });
      }
    }
    this.buildingTemplate = false;
    this.dragTokenId = null;
    this.dragTerrainId = null;
    this.rotatingId = null;
    this.rotatingTerrainId = null;
    this.panning = false;
    this.rulerStart = null;
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = this.app.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const before = this.world.toLocal({ x: sx, y: sy });

    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.world.scale.x * factor));
    this.world.scale.set(next);

    const after = this.world.toLocal({ x: sx, y: sy });
    this.world.position.x += (after.x - before.x) * next;
    this.world.position.y += (after.y - before.y) * next;

    // Zoom changed: re-stroke the grid so its lines keep a constant screen width.
    this.drawGrid();
  }

  private placeToken(opt: BaseOption, world: Vec2): void {
    const pos = this.gridSnapActive() ? this.rules().snap(world, opt.shape) : world;
    const color = PLACE_COLORS[this.placeCount % PLACE_COLORS.length]!;
    this.placeCount++;
    this.sync.dispatch({
      type: "addToken",
      token: { id: crypto.randomUUID(), label: opt.label, pos, base: opt.shape, facing: 0, color, ownerId: null },
    });
  }

  private placeTerrainPiece(opt: TerrainOption, world: Vec2): void {
    const pos = this.gridSnapActive() ? this.rules().snap(world, opt.base) : world;
    const piece: TerrainPiece = {
      id: crypto.randomUUID(),
      label: opt.label,
      pos,
      base: opt.base,
      facing: 0,
      losBlocking: opt.losBlocking,
      cover: opt.cover,
      difficult: opt.difficult,
      surface: opt.surface,
      pattern: opt.pattern,
      fill: opt.fill,
      border: opt.border,
    };
    this.sync.dispatch({ type: "addTerrain", terrain: piece });
  }

  private tokenAt(world: Vec2): string | null {
    const tokens = this.sync.getState().tokens;
    for (const id of Object.keys(tokens).reverse()) {
      const t = tokens[id]!;
      if (pointInBase(world, t.pos, t.base, t.facing)) return id;
    }
    return null;
  }

  private targetAt(world: Vec2): MeasureTarget {
    const id = this.tokenAt(world);
    if (id) {
      const t = this.sync.getState().tokens[id]!;
      return { pos: t.pos, base: t.base, facing: t.facing };
    }
    return { pos: world, base: { kind: "circle", radiusMm: 0 }, facing: 0 };
  }

  // ---- selection + rotation ----------------------------------------------
  // Tokens and terrain pieces share the same {pos, base, facing} shape, so
  // selection ring / rotation handle logic is written once against that shape
  // and used for both — see `drawSelection`.

  private handlePosFor(entity: { pos: Vec2; base: BaseShape; facing: number }): Vec2 {
    const r = boundingRadius(entity.base);
    const arm = r + Math.max(12, r * 0.4);
    return { x: entity.pos.x + Math.cos(entity.facing) * arm, y: entity.pos.y + Math.sin(entity.facing) * arm };
  }

  private handleHitAt(
    entity: { pos: Vec2; base: BaseShape; facing: number },
    global: { x: number; y: number },
  ): boolean {
    const knob = this.world.toGlobal(this.handlePosFor(entity));
    return Math.hypot(knob.x - global.x, knob.y - global.y) <= 14;
  }

  private setSelected(id: string | null): void {
    this.selectedId = id;
    if (id) {
      this.selectedWallId = null;
      this.selectedTerrainId = null;
    }
    this.drawSelection();
    this.drawLoS();
    this.drawWalls();
  }

  private setSelectedTerrain(id: string | null): void {
    this.selectedTerrainId = id;
    if (id) {
      this.selectedId = null;
      this.selectedWallId = null;
    }
    this.drawSelection();
    this.drawLoS();
    this.drawWalls();
  }

  private setSelectedWall(id: string | null): void {
    this.selectedWallId = id;
    if (id) {
      this.selectedId = null;
      this.selectedTerrainId = null;
      this.drawSelection();
      this.drawLoS();
    }
    this.drawWalls();
  }

  private onKeyDown(e: KeyboardEvent): void {
    const el = document.activeElement;
    if (el && ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName)) return;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      this.sync.undo();
      e.preventDefault();
      return;
    }

    // Selected wall: Delete removes it, Esc deselects.
    if (this.selectedWallId) {
      if (e.key === "Delete" || e.key === "Backspace") {
        this.sync.dispatch({ type: "removeWall", id: this.selectedWallId });
        this.setSelectedWall(null);
        e.preventDefault();
      } else if (e.key === "Escape") {
        this.setSelectedWall(null);
      }
      return;
    }

    // Selected terrain: same rotate/delete/esc handling as a token.
    if (this.selectedTerrainId) {
      const tp = this.sync.getState().terrain[this.selectedTerrainId];
      if (!tp) return;
      const tStep = Math.PI / 12;
      switch (e.key) {
        case "[":
          this.sync.dispatch({ type: "rotateTerrain", id: tp.id, facing: tp.facing - tStep });
          e.preventDefault();
          break;
        case "]":
          this.sync.dispatch({ type: "rotateTerrain", id: tp.id, facing: tp.facing + tStep });
          e.preventDefault();
          break;
        case "Escape":
          this.setSelectedTerrain(null);
          break;
        case "Delete":
        case "Backspace":
          this.sync.dispatch({ type: "removeTerrain", id: tp.id });
          this.setSelectedTerrain(null);
          e.preventDefault();
          break;
      }
      return;
    }

    if (!this.selectedId) return;
    const t = this.sync.getState().tokens[this.selectedId];
    if (!t) return;
    const step = Math.PI / 12;
    switch (e.key) {
      case "[":
        this.sync.dispatch({ type: "rotateToken", id: t.id, facing: t.facing - step });
        e.preventDefault();
        break;
      case "]":
        this.sync.dispatch({ type: "rotateToken", id: t.id, facing: t.facing + step });
        e.preventDefault();
        break;
      case "Escape":
        this.setSelected(null);
        break;
      case "Delete":
      case "Backspace":
        this.sync.dispatch({ type: "removeToken", id: t.id });
        this.setSelected(null);
        e.preventDefault();
        break;
    }
  }

  // ---- drawing ------------------------------------------------------------

  private redraw(): void {
    const st = this.sync.getState();
    this.drawGrid();

    const seenTerrain = new Set<string>();
    for (const t of Object.values(st.terrain)) {
      seenTerrain.add(t.id);
      this.drawTerrainPiece(t);
    }
    for (const [id, entry] of this.terrainGfx) {
      if (!seenTerrain.has(id)) {
        entry.container.destroy({ children: true });
        this.terrainGfx.delete(id);
      }
    }

    this.drawWalls();

    const seen = new Set<string>();
    for (const t of Object.values(st.tokens)) {
      seen.add(t.id);
      this.drawToken(t);
    }
    for (const [id, g] of this.tokenGfx) {
      if (!seen.has(id)) {
        g.destroy();
        this.tokenGfx.delete(id);
      }
    }

    this.drawSelection();
    this.drawLoS();
    this.drawTemplate();
  }

  private drawGrid(): void {
    const st = this.sync.getState();
    const g = this.gridLayer;
    g.clear();
    // Stroke widths are in world (mm) units, but the whole `world` container is
    // scaled by the camera — so a fixed width goes sub-pixel and shimmers when
    // zoomed out. Divide by the zoom to keep lines a constant width on screen.
    // (drawGrid is re-run from onWheel so this tracks the live zoom.)
    const px = 1 / this.world.scale.x;
    g.rect(0, 0, st.widthMm, st.heightMm).fill({ color: 0x1c2230 });
    g.rect(0, 0, st.widthMm, st.heightMm).stroke({ width: 2 * px, color: 0x3a465e });

    const rs = this.rules();
    if (this.showGrid && rs.grid) {
      const cell = rs.grid.cellMm;
      for (let x = 0; x <= st.widthMm + 0.1; x += cell) g.moveTo(x, 0).lineTo(x, st.heightMm);
      for (let y = 0; y <= st.heightMm + 0.1; y += cell) g.moveTo(0, y).lineTo(st.widthMm, y);
      g.stroke({ width: px, color: 0x2f3a52, alpha: 0.9 });
    }
  }

  private drawWalls(): void {
    const g = this.wallLayer;
    g.clear();
    let selected: Wall | null = null;
    for (const w of this.wallsArray()) {
      if (w.id === this.selectedWallId) {
        selected = w;
        continue;
      }
      g.moveTo(w.a.x, w.a.y).lineTo(w.b.x, w.b.y);
    }
    g.stroke({ width: 6, color: 0x8a6d3b, cap: "round" });
    if (selected) {
      g.moveTo(selected.a.x, selected.a.y).lineTo(selected.b.x, selected.b.y);
      g.stroke({ width: 8, color: 0xffd166, cap: "round" });
    }
  }

  private drawWallPreview(a: Vec2, b: Vec2): void {
    this.lastWallEnd = b;
    const g = this.previewLayer;
    g.clear();
    g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 6, color: 0xffd166, alpha: 0.7, cap: "round" });
  }
  private lastWallEnd: Vec2 | null = null;

  /**
   * Terrain is drawn as fill + border + a decorative pattern (hatch = ruins/
   * walls, dots = rubble/foliage, solid = craters/plain ground), all in the
   * piece's LOCAL frame (centered at its own origin) so a single container
   * rotation handles facing — same trick `drawToken` uses. The pattern is
   * masked to the shape so hatch lines don't spill past a rotated rect's
   * corners.
   */
  private drawTerrainPiece(t: TerrainPiece): void {
    let entry = this.terrainGfx.get(t.id);
    if (!entry) {
      const container = new Container();
      const fill = new Graphics();
      const pattern = new Graphics();
      const mask = new Graphics();
      container.addChild(fill, pattern, mask);
      pattern.mask = mask;
      this.terrainLayer.addChild(container);
      entry = { container, fill, pattern, mask };
      this.terrainGfx.set(t.id, entry);
    }
    const { container, fill, pattern, mask } = entry;
    fill.clear();
    pattern.clear();
    mask.clear();

    const drawShape = (g: Graphics): void => {
      switch (t.base.kind) {
        case "circle":
          g.circle(0, 0, t.base.radiusMm);
          break;
        case "oval":
          g.ellipse(0, 0, t.base.radiusXMm, t.base.radiusYMm);
          break;
        case "rect":
          g.rect(-t.base.halfWidthMm, -t.base.halfHeightMm, t.base.halfWidthMm * 2, t.base.halfHeightMm * 2);
          break;
      }
    };

    drawShape(fill);
    fill.fill({ color: t.fill, alpha: 0.55 });
    drawShape(fill);
    fill.stroke({ width: 3, color: t.border, alpha: 0.9 });

    drawShape(mask);
    mask.fill({ color: 0xffffff });

    const fp = footprint(t.base);
    const halfW = fp.w / 2;
    const halfH = fp.h / 2;
    if (t.pattern === "hatch") {
      const spacing = 14;
      for (let x = -halfW - halfH; x <= halfW + halfH; x += spacing) {
        pattern.moveTo(x - halfH, -halfH).lineTo(x + halfH, halfH);
      }
      pattern.stroke({ width: 2, color: t.border, alpha: 0.5 });
    } else if (t.pattern === "dots") {
      const spacing = 16;
      for (let y = -halfH + spacing / 2; y < halfH; y += spacing) {
        for (let x = -halfW + spacing / 2; x < halfW; x += spacing) {
          pattern.circle(x, y, 2.5).fill({ color: t.border, alpha: 0.6 });
        }
      }
    }

    container.position.set(t.pos.x, t.pos.y);
    container.rotation = t.facing;
  }

  private drawToken(t: Token): void {
    let g = this.tokenGfx.get(t.id);
    if (!g) {
      g = new Graphics();
      this.tokenLayer.addChild(g);
      this.tokenGfx.set(t.id, g);
    }
    g.clear();
    switch (t.base.kind) {
      case "circle":
        g.circle(0, 0, t.base.radiusMm);
        break;
      case "oval":
        g.ellipse(0, 0, t.base.radiusXMm, t.base.radiusYMm);
        break;
      case "rect":
        g.rect(-t.base.halfWidthMm, -t.base.halfHeightMm, t.base.halfWidthMm * 2, t.base.halfHeightMm * 2);
        break;
    }
    g.fill({ color: t.color });
    g.stroke({ width: 1.5, color: 0x0b0d12 });
    g.position.set(t.pos.x, t.pos.y);
    g.rotation = t.facing;
  }

  private drawSelection(): void {
    const g = this.selectionLayer;
    g.clear();

    const st = this.sync.getState();
    const entity: { pos: Vec2; base: BaseShape; facing: number } | undefined = this.selectedId
      ? st.tokens[this.selectedId]
      : this.selectedTerrainId
        ? st.terrain[this.selectedTerrainId]
        : undefined;
    if (!entity) {
      // The selected token/terrain piece was removed out from under the selection.
      if (this.selectedId) this.selectedId = null;
      if (this.selectedTerrainId) this.selectedTerrainId = null;
      return;
    }

    const r = boundingRadius(entity.base);
    g.circle(entity.pos.x, entity.pos.y, r + 3).stroke({ width: 1.5, color: 0xffd166, alpha: 0.9 });
    const knob = this.handlePosFor(entity);
    g.moveTo(entity.pos.x, entity.pos.y).lineTo(knob.x, knob.y).stroke({ width: 1.5, color: 0xffd166 });
    g.circle(knob.x, knob.y, 5).fill({ color: 0xffd166 });
    g.circle(knob.x, knob.y, 5).stroke({ width: 1, color: 0x0b0d12 });
  }

  private drawTemplate(): void {
    this.tplArea.clear();
    this.tplShadow.clear();
    this.tplMask.clear();
    this.tplRings.clear();
    if (!this.activeTemplate) return;

    const flat = templatePolygon(this.activeTemplate)
      .map((p) => [p.x, p.y])
      .flat();
    // Affected-area fill + outline.
    this.tplArea.poly(flat).fill({ color: 0xff6b6b, alpha: 0.2 });
    this.tplArea.poly(flat).stroke({ width: 1.5, color: 0xff6b6b, alpha: 0.85 });
    // Mask so wall shadows are clipped to the area.
    this.tplMask.poly(flat).fill({ color: 0xffffff });

    // Darken the parts of the area a wall (real OR LoS-blocking terrain) blocks
    // from the origin — the space the blast/cone does NOT actually affect. The
    // origin is a single point, so a real wall's shadow is a plain shadowQuad
    // and a terrain block's is the point-shadow of the whole block.
    // hit/covered resolution below uses `losWalls()` (every terrain edge as a
    // segment) since a plain segment-intersection check doesn't care about facing.
    const origin = templateOrigin(this.activeTemplate);
    for (const w of this.wallsArray()) {
      if (!w.blocksLoS) continue;
      const q = shadowQuad(origin, w.a, w.b)
        .map((p) => [p.x, p.y])
        .flat();
      this.tplShadow.poly(q).fill({ color: 0x0b0d12, alpha: 0.6 });
    }
    for (const occ of this.terrainOccluders()) {
      const q = umbraOfOccluder([origin], occ)
        .map((p) => [p.x, p.y])
        .flat();
      if (q.length >= 6) this.tplShadow.poly(q).fill({ color: 0x0b0d12, alpha: 0.6 });
    }

    const result: TemplateResult = resolveTemplate(
      this.activeTemplate,
      Object.values(this.sync.getState().tokens),
      this.losWalls(),
    );
    const tokens = this.sync.getState().tokens;
    for (const id of result.hit) {
      const t = tokens[id]!;
      this.tplRings.circle(t.pos.x, t.pos.y, boundingRadius(t.base) + 4).stroke({ width: 2.5, color: 0x06d6a0 });
    }
    for (const id of result.covered) {
      const t = tokens[id]!;
      this.tplRings.circle(t.pos.x, t.pos.y, boundingRadius(t.base) + 4).stroke({ width: 2.5, color: 0x7a8699 });
    }
    this.onReadout(
      `${result.hit.length} hit` + (result.covered.length ? `, ${result.covered.length} in cover` : ""),
    );
  }

  /**
   * Warhammer: when a unit is selected, show what it can see out to LOS_RANGE_MM
   * and count how many other units it has line of sight to (green ring) vs. not
   * (grey ring), per the terrain rules in domain/los.ts.
   *
   * The lit circle is dimmed wherever a real wall or a LoS-blocking terrain
   * block (Ruins, dense Forest, Buildings) casts a shadow. Two rules shape this:
   *  - Seeing out: a feature the observer is wholly within casts no shadow (the
   *    unit sees out of its own ruin) — skipped below.
   *  - Seeing in: the LoS layer renders under terrain, so a feature's footprint
   *    is never darkened — you can always see models inside terrain.
   *
   * The unit's base is an AREA, not a point, so each blocker's shadow is cast
   * from its base polygon (umbraQuad / umbraOfOccluder), narrowing the blind
   * spot the way a wide base really can see around an obstruction.
   */
  private drawLoS(): void {
    this.losBase.clear();
    this.losShadow.clear();
    this.losMask.clear();
    this.losRings.clear();

    const st = this.sync.getState();
    if (st.systemId !== "warhammer" || !this.selectedId) {
      if (!this.activeTemplate) this.onReadout("");
      return;
    }
    const t = st.tokens[this.selectedId];
    if (!t) return;

    const R = LOS_RANGE_MM;
    this.losBase.circle(t.pos.x, t.pos.y, R).fill({ color: 0x06d6a0, alpha: 0.1 });
    this.losBase.circle(t.pos.x, t.pos.y, R).stroke({ width: 1, color: 0x06d6a0, alpha: 0.35 });
    this.losMask.circle(t.pos.x, t.pos.y, R).fill({ color: 0xffffff });

    const source = basePolygon(t.pos, t.base, t.facing);
    const terrain = this.terrainArray();
    const walls = this.wallsArray();

    // Real walls: area-source umbra per segment.
    for (const w of walls) {
      if (!w.blocksLoS) continue;
      const q = umbraQuad(source, w.a, w.b)
        .map((p) => [p.x, p.y])
        .flat();
      this.losShadow.poly(q).fill({ color: 0x0b0d12, alpha: 0.45 });
    }
    // Terrain blocks: umbra of the WHOLE convex block — but skip any block the
    // observer is wholly within (seeing out of its own ruin).
    for (const piece of terrain) {
      if (piece.losBlocking !== "blocks") continue;
      if (whollyWithin(source, piece)) continue;
      const q = umbraOfOccluder(source, basePolygon(piece.pos, piece.base, piece.facing))
        .map((p) => [p.x, p.y])
        .flat();
      if (q.length >= 6) this.losShadow.poly(q).fill({ color: 0x0b0d12, alpha: 0.45 });
    }

    // Ring every other unit green (visible) or grey (blocked), and count.
    let visible = 0;
    let total = 0;
    for (const other of Object.values(st.tokens)) {
      if (other.id === t.id) continue;
      total++;
      const seen = hasLineOfSight(t, other, terrain, walls);
      if (seen) visible++;
      this.losRings
        .circle(other.pos.x, other.pos.y, boundingRadius(other.base) + 4)
        .stroke({ width: 2.5, color: seen ? 0x06d6a0 : 0x7a8699 });
    }
    if (!this.activeTemplate) {
      this.onReadout(total > 0 ? `${visible}/${total} units visible` : "");
    }
  }

  private drawRuler(a: MeasureTarget, b: MeasureTarget): void {
    const rs = this.rules();
    const m = rs.measure(a, b);
    let text = m.text;

    // Corner/wall-based cover: real walls plus LoS-blocking terrain (Ruins,
    // Buildings, dense Forest) act identically here since both decompose to
    // the same wall segments.
    const walls = this.losWalls();
    if (walls.length) {
      const c = rs.cover(a, b, walls);
      if (c.level !== "none") text += `  ·  ${c.text}`;
    }

    // Intrinsic terrain cover (craters, rubble): granted just by standing on
    // or touching the feature, independent of the attacker's angle — these
    // don't have hard edges suitable for the corner-blocking check above.
    const terrainCover = terrainCoverAt(b.pos, b.base, b.facing, this.terrainArray());
    if (terrainCover.level !== "none" && terrainCover.source) {
      const label = terrainCover.level === "heavy" ? "Heavy cover" : "Light cover";
      text += `  ·  ${label} (${terrainCover.source})`;
    }

    const ga = this.world.toGlobal(a.pos);
    const gb = this.world.toGlobal(b.pos);
    this.overlay.clear();
    this.overlay.moveTo(ga.x, ga.y).lineTo(gb.x, gb.y).stroke({ width: 2, color: 0xffd166 });
    this.overlay.circle(ga.x, ga.y, 4).fill({ color: 0xffd166 });
    this.overlay.circle(gb.x, gb.y, 4).fill({ color: 0xffd166 });

    this.overlayLabel.text = text;
    this.overlayLabel.position.set((ga.x + gb.x) / 2 + 8, (ga.y + gb.y) / 2 - 8);
    this.onReadout(text);
  }
}

/** Apex of a cone template (helper for aiming during a drag). */
function templateApex(t: Template): Vec2 {
  return t.kind === "cone" ? t.apex : t.center;
}
