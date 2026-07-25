/**
 * Multiplayer seam.
 *
 * The client never mutates board state directly — it *dispatches actions*.
 * A BoardSync decides how those actions become authoritative and how remote
 * actions arrive back. Today there is only LocalSync (single machine). When you
 * add a server, implement WebSocketSync with the SAME interface and nothing in
 * the domain or render layers changes.
 *
 * Recommended production model: authoritative server. The client dispatches an
 * intent, optionally applies it optimistically, the server validates against the
 * rule system, and broadcasts the accepted action (with a sequence number) to
 * everyone. Because applyAction is a deterministic reducer, every client that
 * replays the same accepted-action stream converges to identical state.
 */

import type { Action, BoardState } from "../domain/state.js";
import { applyAction } from "../domain/state.js";

export interface BoardSync {
  /** Current authoritative-as-this-client-knows-it state. */
  getState(): BoardState;
  /** Dispatch a local intent. */
  dispatch(action: Action): void;
  /** Revert the last undoable change. No-op if history is empty. */
  undo(): void;
  /** Subscribe to state changes (local or remote). Returns an unsubscribe fn. */
  subscribe(listener: (state: BoardState) => void): () => void;
}

const HISTORY_LIMIT = 100;

/** Single-machine implementation: apply immediately, notify listeners. */
export class LocalSync implements BoardSync {
  private state: BoardState;
  private listeners = new Set<(s: BoardState) => void>();
  private history: BoardState[] = [];
  private lastCoalesceKey: string | null = null;

  constructor(initial: BoardState) {
    this.state = initial;
  }

  getState(): BoardState {
    return this.state;
  }

  dispatch(action: Action): void {
    // A continuous drag (many moveToken/rotateToken/moveTerrain/rotateTerrain of
    // one id) collapses to a single undo step: only the first action in the run
    // records history.
    const COALESCE_TYPES = ["moveToken", "rotateToken", "moveTerrain", "rotateTerrain"];
    const key = COALESCE_TYPES.includes(action.type) && "id" in action ? `${action.type}:${action.id}` : null;
    if (key === null || key !== this.lastCoalesceKey) {
      this.history.push(this.state);
      if (this.history.length > HISTORY_LIMIT) this.history.shift();
    }
    this.lastCoalesceKey = key;

    this.state = applyAction(this.state, action);
    this.notify();
  }

  undo(): void {
    const prev = this.history.pop();
    if (!prev) return;
    this.state = prev;
    this.lastCoalesceKey = null;
    this.notify();
  }

  subscribe(listener: (state: BoardState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const l of this.listeners) l(this.state);
  }
}

/*
 * Sketch of the networked version — implement when you move to multiplayer:
 *
 * export class WebSocketSync implements BoardSync {
 *   // optimistic local apply, reconcile on server-accepted actions carrying a seq#
 *   dispatch(action) {
 *     this.optimistic = applyAction(this.optimistic, action);
 *     this.notify();
 *     this.socket.send(JSON.stringify({ kind: "intent", action }));
 *   }
 *   // onmessage: { kind: "accepted", seq, action } -> rebase optimistic layer
 * }
 */
