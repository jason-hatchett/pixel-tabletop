import { describe, it, expect } from "vitest";
import { applyAction, makeInitialState, type Token } from "./state.js";
import type { TerrainPiece } from "./terrain.js";

const token = (id: string): Token => ({
  id,
  label: id,
  pos: { x: 0, y: 0 },
  base: { kind: "oval", radiusXMm: 52.5, radiusYMm: 35 },
  facing: 0,
  color: 0xffffff,
  ownerId: null,
});

const terrain = (id: string): TerrainPiece => ({
  id,
  label: "Ruins",
  pos: { x: 0, y: 0 },
  base: { kind: "rect", halfWidthMm: 40, halfHeightMm: 60 },
  facing: 0,
  losBlocking: "blocks",
  cover: "heavy",
  difficult: true,
  surface: null,
  heightMm: 0,
  pattern: "hatch",
  fill: 0x8a8f9c,
  border: 0xd8dde3,
});

describe("board reducer", () => {
  it("is pure — never mutates the input state", () => {
    const s0 = applyAction(makeInitialState(), { type: "addToken", token: token("a") });
    const s1 = applyAction(s0, { type: "rotateToken", id: "a", facing: 1.5 });
    expect(s0.tokens["a"]!.facing).toBe(0); // original untouched
    expect(s1.tokens["a"]!.facing).toBe(1.5);
    expect(s1).not.toBe(s0);
  });

  it("rotateToken sets facing and leaves position alone", () => {
    let s = applyAction(makeInitialState(), { type: "addToken", token: token("a") });
    s = applyAction(s, { type: "moveToken", id: "a", pos: { x: 10, y: 20 } });
    s = applyAction(s, { type: "rotateToken", id: "a", facing: Math.PI });
    expect(s.tokens["a"]!.facing).toBe(Math.PI);
    expect(s.tokens["a"]!.pos).toEqual({ x: 10, y: 20 });
  });

  it("ignores actions targeting an unknown token", () => {
    const s = makeInitialState();
    expect(applyAction(s, { type: "rotateToken", id: "nope", facing: 1 })).toBe(s);
  });

  it("removeToken drops the token", () => {
    let s = applyAction(makeInitialState(), { type: "addToken", token: token("a") });
    s = applyAction(s, { type: "removeToken", id: "a" });
    expect(s.tokens["a"]).toBeUndefined();
  });
});

describe("terrain actions", () => {
  it("adds, moves, rotates, and removes a terrain piece without mutating prior state", () => {
    const s0 = makeInitialState();
    const s1 = applyAction(s0, { type: "addTerrain", terrain: terrain("t1") });
    const s2 = applyAction(s1, { type: "moveTerrain", id: "t1", pos: { x: 30, y: 40 } });
    const s3 = applyAction(s2, { type: "rotateTerrain", id: "t1", facing: Math.PI / 2 });
    const s4 = applyAction(s3, { type: "removeTerrain", id: "t1" });

    expect(s0.terrain).toEqual({});
    expect(s1.terrain["t1"]!.pos).toEqual({ x: 0, y: 0 });
    expect(s2.terrain["t1"]!.pos).toEqual({ x: 30, y: 40 });
    expect(s2.terrain["t1"]!.facing).toBe(0); // moveTerrain doesn't touch facing
    expect(s3.terrain["t1"]!.facing).toBe(Math.PI / 2);
    expect(s3.terrain["t1"]!.pos).toEqual({ x: 30, y: 40 }); // rotateTerrain doesn't touch pos
    expect(s4.terrain["t1"]).toBeUndefined();
  });

  it("ignores moveTerrain/rotateTerrain/removeTerrain for an unknown id", () => {
    const s = makeInitialState();
    expect(applyAction(s, { type: "moveTerrain", id: "nope", pos: { x: 1, y: 1 } })).toBe(s);
    expect(applyAction(s, { type: "rotateTerrain", id: "nope", facing: 1 })).toBe(s);
    expect(applyAction(s, { type: "removeTerrain", id: "nope" })).toBe(s);
  });
});
