import { describe, it, expect } from "vitest";
import { makeInitialState, applyAction, type BoardState } from "./state.js";
import type { ImagePlacement } from "./images.js";

const image = (id: string): ImagePlacement => ({
  id,
  assetRef: `asset:${id}`,
  pos: { x: 100, y: 200 },
  widthMm: 44 * 25.4,
  heightMm: 30 * 25.4,
  rotation: 0,
});

const withImage = (): BoardState => applyAction(makeInitialState(), { type: "addImage", image: image("map") });

describe("image placement reducer", () => {
  it("adds an image placement", () => {
    const s = withImage();
    expect(s.images["map"]).toEqual(image("map"));
  });

  it("updates only the patched fields", () => {
    const s = applyAction(withImage(), {
      type: "updateImage",
      id: "map",
      patch: { pos: { x: 5, y: 6 }, rotation: Math.PI / 2 },
    });
    expect(s.images["map"]!.pos).toEqual({ x: 5, y: 6 });
    expect(s.images["map"]!.rotation).toBe(Math.PI / 2);
    expect(s.images["map"]!.assetRef).toBe("asset:map"); // untouched
    expect(s.images["map"]!.widthMm).toBe(image("map").widthMm); // untouched
  });

  it("removes an image placement", () => {
    const s = applyAction(withImage(), { type: "removeImage", id: "map" });
    expect(s.images["map"]).toBeUndefined();
  });

  it("is a no-op updating or removing an unknown id", () => {
    const s = withImage();
    expect(applyAction(s, { type: "updateImage", id: "ghost", patch: { rotation: 1 } })).toBe(s);
    expect(applyAction(s, { type: "removeImage", id: "ghost" })).toBe(s);
  });

  it("never mutates its input", () => {
    const s = withImage();
    const snapshot = structuredClone(s);
    applyAction(s, { type: "updateImage", id: "map", patch: { pos: { x: 9, y: 9 } } });
    expect(s).toEqual(snapshot);
  });

  it("round-trips through JSON with no pixel field (mm-only, plain-JSON)", () => {
    const s = withImage();
    // Placement survives a serialize/replay identical (ADR-0002 determinism).
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    // Guard the mm-only invariant: no px/dpi/grid keys leak into the domain.
    const json = JSON.stringify(s.images["map"]);
    expect(json).not.toMatch(/px|dpi|pixel|grid/i);
  });
});
