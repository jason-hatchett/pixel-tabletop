import { describe, it, expect } from "vitest";
import {
  serialize,
  deserialize,
  normalize,
  LocalBoardStore,
  SCHEMA_VERSION,
  type KV,
} from "./boardStore.js";
import { makeInitialState, applyAction, type BoardState, type Token } from "../domain/state.js";

const memKV = (): KV => {
  const m = new Map<string, string>();
  return {
    get: (k) => m.get(k) ?? null,
    set: (k, v) => void m.set(k, v),
    remove: (k) => void m.delete(k),
    keys: () => [...m.keys()],
  };
};

const token = (id: string): Token => ({
  id,
  label: id,
  pos: { x: 1, y: 2 },
  base: { kind: "circle", radiusMm: 16 },
  facing: 0,
  color: 0xffffff,
  ownerId: null,
});

const sample = (): BoardState => applyAction(makeInitialState(), { type: "addToken", token: token("a") });

describe("envelope serialize/deserialize", () => {
  it("round-trips a board state", () => {
    const s = sample();
    expect(deserialize(serialize(s))).toEqual(s);
  });

  it("wraps state in a versioned envelope", () => {
    const env = JSON.parse(serialize(makeInitialState()));
    expect(env.schemaVersion).toBe(SCHEMA_VERSION);
    expect(typeof env.savedAt).toBe("string");
    expect(env.state).toBeDefined();
  });

  it("refuses a save from a newer schema version", () => {
    const env = JSON.parse(serialize(makeInitialState()));
    env.schemaVersion = SCHEMA_VERSION + 1;
    expect(() => deserialize(JSON.stringify(env))).toThrow(/newer version/);
  });

  it("normalize fills missing top-level keys from a partial save", () => {
    const partial = { systemId: "dnd5e" }; // no tokens/walls/terrain/size
    const s = normalize(partial);
    expect(s.systemId).toBe("dnd5e");
    expect(s.tokens).toEqual({});
    expect(s.walls).toEqual({});
    expect(s.terrain).toEqual({});
    expect(s.widthMm).toBe(makeInitialState().widthMm);
  });
});

describe("LocalBoardStore (name-keyed)", () => {
  it("puts, gets, lists, and deletes boards by name", () => {
    const store = new LocalBoardStore(memKV());
    store.put("beta", sample());
    store.put("alpha", makeInitialState());
    expect(store.list()).toEqual(["alpha", "beta"]); // sorted
    expect(store.get("beta")).toEqual(sample());
    expect(store.get("missing")).toBeNull();
    store.delete("alpha");
    expect(store.list()).toEqual(["beta"]);
  });

  it("round-trips the autosave (last) slot", () => {
    const store = new LocalBoardStore(memKV());
    expect(store.getLast()).toBeNull();
    store.putLast(sample());
    expect(store.getLast()).toEqual(sample());
  });
});

describe("loadState reducer", () => {
  it("replaces the whole board", () => {
    const loaded = sample();
    const next = applyAction(makeInitialState(), { type: "loadState", state: loaded });
    expect(next).toEqual(loaded);
  });
});
