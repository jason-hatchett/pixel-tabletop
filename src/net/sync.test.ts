import { describe, it, expect } from "vitest";
import { LocalSync } from "./sync.js";
import { makeInitialState, type Token } from "../domain/state.js";
import type { Wall } from "../domain/walls.js";
import type { TerrainPiece } from "../domain/terrain.js";

const token = (id: string): Token => ({
  id,
  label: id,
  pos: { x: 0, y: 0 },
  base: { kind: "circle", radiusMm: 10 },
  facing: 0,
  color: 0xffffff,
  ownerId: null,
});

const terrainPiece = (id: string): TerrainPiece => ({
  id,
  label: "Rubble",
  pos: { x: 0, y: 0 },
  base: { kind: "rect", halfWidthMm: 30, halfHeightMm: 30 },
  facing: 0,
  losBlocking: "none",
  cover: "light",
  difficult: true,
  surface: null,
  pattern: "dots",
  fill: 0x5878a8,
  border: 0x33445e,
});

const wall = (id: string): Wall => ({
  id,
  a: { x: 0, y: 0 },
  b: { x: 100, y: 0 },
  blocksLoS: true,
  blocksMove: true,
});

describe("LocalSync undo", () => {
  it("reverts the last action", () => {
    const sync = new LocalSync(makeInitialState());
    sync.dispatch({ type: "addWall", wall: wall("w1") });
    expect(Object.keys(sync.getState().walls)).toEqual(["w1"]);
    sync.undo();
    expect(sync.getState().walls).toEqual({});
  });

  it("is a no-op when history is empty", () => {
    const sync = new LocalSync(makeInitialState());
    const s = sync.getState();
    sync.undo();
    expect(sync.getState()).toBe(s);
  });

  it("collapses a drag (many moves of one token) into a single undo step", () => {
    const sync = new LocalSync(makeInitialState());
    sync.dispatch({ type: "addToken", token: token("a") });
    // Simulate a drag: several moves of the same token.
    for (let x = 1; x <= 5; x++) sync.dispatch({ type: "moveToken", id: "a", pos: { x, y: 0 } });
    expect(sync.getState().tokens["a"]!.pos.x).toBe(5);
    // One undo returns to before the drag (pos 0), not one micro-step back.
    sync.undo();
    expect(sync.getState().tokens["a"]!.pos.x).toBe(0);
    // A second undo removes the token entirely.
    sync.undo();
    expect(sync.getState().tokens["a"]).toBeUndefined();
  });

  it("collapses a terrain drag (many moveTerrain of one id) into a single undo step", () => {
    const sync = new LocalSync(makeInitialState());
    sync.dispatch({ type: "addTerrain", terrain: terrainPiece("t1") });
    for (let x = 1; x <= 5; x++) sync.dispatch({ type: "moveTerrain", id: "t1", pos: { x, y: 0 } });
    expect(sync.getState().terrain["t1"]!.pos.x).toBe(5);
    sync.undo();
    expect(sync.getState().terrain["t1"]!.pos.x).toBe(0);
    sync.undo();
    expect(sync.getState().terrain["t1"]).toBeUndefined();
  });

  it("does not coalesce a token move followed by a terrain move of the same id", () => {
    // Different action types with the same entity id must not merge into one step.
    const sync = new LocalSync(makeInitialState());
    sync.dispatch({ type: "addToken", token: token("shared") });
    sync.dispatch({ type: "addTerrain", terrain: terrainPiece("shared") });
    sync.dispatch({ type: "moveToken", id: "shared", pos: { x: 9, y: 9 } });
    sync.dispatch({ type: "moveTerrain", id: "shared", pos: { x: 9, y: 9 } });
    sync.undo(); // undoes the moveTerrain only
    expect(sync.getState().terrain["shared"]!.pos).toEqual({ x: 0, y: 0 });
    expect(sync.getState().tokens["shared"]!.pos).toEqual({ x: 9, y: 9 });
  });

  it("notifies subscribers on undo", () => {
    const sync = new LocalSync(makeInitialState());
    let calls = 0;
    sync.subscribe(() => calls++);
    sync.dispatch({ type: "addWall", wall: wall("w1") });
    sync.undo();
    expect(calls).toBe(2);
  });
});
