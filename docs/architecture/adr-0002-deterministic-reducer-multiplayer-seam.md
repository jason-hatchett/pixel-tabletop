# ADR-0002: Pure deterministic reducer as the multiplayer foundation

## Status
Accepted

## Context
The product needs real-time multiplayer eventually (Phase 5), but building a
networked engine up front would slow every early feature and couple game logic
to transport. We want to defer the server without painting ourselves into a
corner — the day we add multiplayer must not require rewriting the domain or the
renderer.

Authoritative-server multiplayer has a well-known prerequisite: given the same
ordered stream of accepted actions, every client must converge to identical
state. That is only achievable if state transitions are pure and deterministic
over serializable data.

## Decision
All board mutation flows through one pure, total reducer:
`applyAction(state, action)` in `src/domain/state.ts:51`. It never mutates its
input (returns fresh objects), covers every `Action` variant
(`state.ts:37`), and operates on plain-JSON `BoardState` (`state.ts:26`) — no
class instances, no functions, no Pixi/DOM references.

The net layer is a seam, not an implementation: the `BoardSync` interface
(`src/net/sync.ts:20`) is the only thing render code talks to. The renderer
**dispatches actions**; it never writes state directly. Today the only
implementation is `LocalSync` (`sync.ts:34`), which applies immediately, notifies
listeners, and provides undo via history coalescing (a continuous drag collapses
to one undo step; `sync.ts:48`). A `WebSocketSync` sketch is already stubbed
(`sync.ts:82`): dispatch optimistically, send the intent, rebase on the
server-accepted action carrying a sequence number.

## Consequences
- Multiplayer becomes a **new `BoardSync`**, not a rewrite. The domain and render
  layers are untouched by transport.
- Determinism is testable in isolation: `state.test.ts` exercises the reducer
  with no network or Pixi. Replaying a stream is reproducible.
- Undo/redo, replays, and (later) a CRDT or event log all sit naturally on the
  action stream.
- Hard rule that follows from this: **no game feature may bypass `applyAction`.**
  A mutation that skips the reducer breaks convergence and is invisible to undo.
  (Restated in game-design.md §8.)
- Cost: every state change must be expressible as a serializable `Action`.
  Ephemeral, per-client concerns (selection, transient ruler/template overlays,
  camera) are deliberately kept **out** of `BoardState` — they are UI state, not
  board state, and must not be synced.
- The reducer returns `state` unchanged for actions targeting missing ids
  (e.g. `moveToken` on a deleted token; `state.ts:56`), so a late/duplicate
  remote action is a safe no-op rather than a crash.
