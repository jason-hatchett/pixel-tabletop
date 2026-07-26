/**
 * Board persistence — save/load a whole `BoardState` by game name.
 *
 * A durable save is a snapshot (not the action log), wrapped in a versioned
 * envelope so future BoardState growth stays loadable. All I/O goes through the
 * `BoardStore` seam: `LocalBoardStore` (localStorage) ships Phase A; a later
 * `ServerBoardStore`/IndexedDB backend is a drop-in behind the same interface
 * (ADR-0007). Nothing here mutates board state — loading dispatches a
 * `loadState` action through the reducer.
 */

import type { BoardState } from "../domain/state.js";
import { makeInitialState } from "../domain/state.js";

export const SCHEMA_VERSION = 1;

export interface SavedBoard {
  schemaVersion: number;
  savedAt: string; // ISO
  state: BoardState;
}

/** Fill any missing top-level keys so older/partial saves stay loadable. */
export function normalize(raw: Partial<BoardState>): BoardState {
  const base = makeInitialState();
  return {
    widthMm: raw.widthMm ?? base.widthMm,
    heightMm: raw.heightMm ?? base.heightMm,
    systemId: raw.systemId ?? base.systemId,
    tokens: raw.tokens ?? base.tokens,
    walls: raw.walls ?? base.walls,
    terrain: raw.terrain ?? base.terrain,
    images: raw.images ?? base.images,
  };
}

export function serialize(state: BoardState): string {
  const env: SavedBoard = { schemaVersion: SCHEMA_VERSION, savedAt: new Date().toISOString(), state };
  return JSON.stringify(env);
}

export function deserialize(json: string): BoardState {
  const env = JSON.parse(json) as { schemaVersion?: number; state?: unknown };
  const v = env.schemaVersion ?? 0;
  if (v > SCHEMA_VERSION) {
    throw new Error(`Save is from a newer version (v${v}) than this app supports (v${SCHEMA_VERSION}).`);
  }
  // (migrations for v < SCHEMA_VERSION would run here — none yet.)
  if (!env.state || typeof env.state !== "object") throw new Error("Save contains no board state.");
  return normalize(env.state as Partial<BoardState>);
}

/** Named board storage. Name-keyed per ADR-0007. */
export interface BoardStore {
  put(name: string, state: BoardState): void;
  get(name: string): BoardState | null;
  list(): string[];
  delete(name: string): void;
  /** Autosave slot for the current working board (restored on reload). */
  putLast(state: BoardState): void;
  getLast(): BoardState | null;
}

/** Minimal key-value backing (localStorage implements this shape via the adapter). */
export interface KV {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  keys(): string[];
}

const PREFIX = "ptt:board:";
const LAST = "ptt:last";

export class LocalBoardStore implements BoardStore {
  constructor(private kv: KV) {}

  put(name: string, state: BoardState): void {
    this.kv.set(PREFIX + name, serialize(state));
  }
  get(name: string): BoardState | null {
    const s = this.kv.get(PREFIX + name);
    return s ? deserialize(s) : null;
  }
  list(): string[] {
    return this.kv
      .keys()
      .filter((k) => k.startsWith(PREFIX))
      .map((k) => k.slice(PREFIX.length))
      .sort((a, b) => a.localeCompare(b));
  }
  delete(name: string): void {
    this.kv.remove(PREFIX + name);
  }
  putLast(state: BoardState): void {
    this.kv.set(LAST, serialize(state));
  }
  getLast(): BoardState | null {
    const s = this.kv.get(LAST);
    return s ? deserialize(s) : null;
  }
}

/** Adapt the browser `localStorage` to `KV`. */
export function localStorageKV(): KV {
  const ls = window.localStorage;
  return {
    get: (k) => ls.getItem(k),
    set: (k, v) => ls.setItem(k, v),
    remove: (k) => ls.removeItem(k),
    keys: () => Object.keys(ls),
  };
}
