/**
 * Serializable board state + a pure reducer over actions.
 *
 * This shape is deliberately plain-JSON and deterministic: the same action
 * stream always produces the same state. That is exactly what an authoritative
 * multiplayer server (or a CRDT log) needs, so the whole net layer can be built
 * on top of `applyAction` without touching rendering. See src/net/sync.ts.
 */

import type { BaseShape, Vec2 } from "./geometry.js";
import type { Wall } from "./walls.js";
import type { TerrainPiece } from "./terrain.js";

export interface Token {
  id: string;
  label: string;
  /** Center of the base, in mm, in board space. */
  pos: Vec2;
  base: BaseShape;
  /** Facing in radians (0 = +x). Unused by the scaffold UI yet; kept for AoS. */
  facing: number;
  color: number; // 0xRRGGBB
  ownerId: string | null;
}

export interface BoardState {
  /** Physical table size in mm (e.g. 44" x 30" for 40k). */
  widthMm: number;
  heightMm: number;
  /** Active rule-system id; see domain/rules. */
  systemId: string;
  tokens: Record<string, Token>;
  walls: Record<string, Wall>;
  terrain: Record<string, TerrainPiece>;
}

export type Action =
  | { type: "addToken"; token: Token }
  | { type: "moveToken"; id: string; pos: Vec2 }
  | { type: "rotateToken"; id: string; facing: number }
  | { type: "removeToken"; id: string }
  | { type: "addWall"; wall: Wall }
  | { type: "removeWall"; id: string }
  | { type: "addTerrain"; terrain: TerrainPiece }
  | { type: "moveTerrain"; id: string; pos: Vec2 }
  | { type: "rotateTerrain"; id: string; facing: number }
  | { type: "removeTerrain"; id: string }
  | { type: "setSystem"; systemId: string };

/** Pure, total reducer. Never mutates its input. */
export function applyAction(state: BoardState, action: Action): BoardState {
  switch (action.type) {
    case "addToken":
      return { ...state, tokens: { ...state.tokens, [action.token.id]: action.token } };
    case "moveToken": {
      const t = state.tokens[action.id];
      if (!t) return state;
      return { ...state, tokens: { ...state.tokens, [action.id]: { ...t, pos: action.pos } } };
    }
    case "rotateToken": {
      const t = state.tokens[action.id];
      if (!t) return state;
      return { ...state, tokens: { ...state.tokens, [action.id]: { ...t, facing: action.facing } } };
    }
    case "removeToken": {
      if (!state.tokens[action.id]) return state;
      const next = { ...state.tokens };
      delete next[action.id];
      return { ...state, tokens: next };
    }
    case "addWall":
      return { ...state, walls: { ...state.walls, [action.wall.id]: action.wall } };
    case "removeWall": {
      if (!state.walls[action.id]) return state;
      const next = { ...state.walls };
      delete next[action.id];
      return { ...state, walls: next };
    }
    case "addTerrain":
      return { ...state, terrain: { ...state.terrain, [action.terrain.id]: action.terrain } };
    case "moveTerrain": {
      const t = state.terrain[action.id];
      if (!t) return state;
      return { ...state, terrain: { ...state.terrain, [action.id]: { ...t, pos: action.pos } } };
    }
    case "rotateTerrain": {
      const t = state.terrain[action.id];
      if (!t) return state;
      return { ...state, terrain: { ...state.terrain, [action.id]: { ...t, facing: action.facing } } };
    }
    case "removeTerrain": {
      if (!state.terrain[action.id]) return state;
      const next = { ...state.terrain };
      delete next[action.id];
      return { ...state, terrain: next };
    }
    case "setSystem":
      return { ...state, systemId: action.systemId };
  }
}

export function makeInitialState(): BoardState {
  return {
    widthMm: 44 * 25.4,
    heightMm: 30 * 25.4,
    systemId: "warhammer",
    tokens: {},
    walls: {},
    terrain: {},
  };
}
