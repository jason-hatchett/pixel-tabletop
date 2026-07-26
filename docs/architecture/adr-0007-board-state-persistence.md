# ADR-0007: Board-state persistence — a `BoardStore` seam, versioned snapshot, a `loadState` action, and phased local→server backends

## Status
Accepted (2026-07-25) — Phase 2 slice A verified: typecheck + 76 tests green, core coverage 96.65% (≥80% gate), `loadState` records one undo step, malformed/too-new imports refused cleanly.

## Context
Everything a solo user builds today is lost on reload: `main.ts:12` constructs a
`LocalSync(makeInitialState())` and `seed()`s four tokens (`main.ts:41`); nothing
is written anywhere. Three needs press:

1. **Resume** — a working board should survive a browser reload.
2. **Named save/load** — a user keeps several boards and reopens them by name.
3. **Server-readiness** — whatever format we persist must be the same thing the
   multiplayer server stores and hydrates from (roadmap Phase 6; `docs/roadmap.md:237`).

**Owner decisions (2026-07):**
- Persistence's eventual authoritative backend is a **database server**, not the
  browser — but it is **phased**.
- **Identity = a user-generated "game name" string. No accounts, no auth.** A board
  is keyed by its game name; that is the whole identity model.
- **Two phases behind one seam:** **(A)** named save/load against a **local**
  backend first — UI (name / save / list / load), versioned envelope, `loadState`
  action, autosave-resume, export/import — shipping *without* a server; **(B)** the
  **DB server later** is just a `ServerBoardStore` implementing the same seam.

Constraints from prior ADRs: `BoardState` is plain-JSON (`state.ts:26`); all
mutation flows through `applyAction` (ADR-0002, `state.ts:51`); the net layer is a
seam (`BoardSync`, `sync.ts:20`) and multiplayer must arrive as a *new* `BoardSync`,
not a rewrite. `BoardState` will also **grow** — units (ADR-0005), a `players`
registry (ADR-0006), move budgets (Phase 3), image-terrain placement (Phase 1) —
so persisted data will outlive the code that wrote it.

Terminology guard: the "game name" is the **record key** for a saved board — a
storage concern. It is distinct from ADR-0006's in-board `players` and runtime
sessions, none of which this ADR touches, and it is **not** an account.

## Decision

### 1. Persist a **snapshot**, not the action log
The durable artifact is a serialized `BoardState` — `JSON.stringify(getState())`.
It is small, human-diffable, and is *exactly* the baseline the multiplayer server
hydrates a joining client from. We do **not** persist an action log for save/load:
a single drag emits dozens of `moveToken` actions (coalesced only for undo,
`sync.ts:48`), a from-genesis log grows unbounded and couples to seed data, and
per-action replay buys nothing for "resume." The live action stream stays the
ADR-0002 delta; snapshot is its checkpoint.

### 2. A versioned **envelope**, never a bare `BoardState`
```ts
interface SavedBoard {
  name: string;            // the game name — the record key
  schemaVersion: number;   // CURRENT_SCHEMA_VERSION, starts at 1
  savedAt: string;         // ISO 8601
  state: BoardState;
}
```
Every backend (local store, DB, export file) carries the envelope. Version and
`savedAt` travel with the bytes so local, server, and file validate/migrate the
same way. `name` is the identity; it is metadata *about* the board, not part of
`BoardState` (keeping the pure core and wire format unpolluted, ADR-0001/0002).

### 3. Load flows **through the reducer** — a new `loadState` action
Loading replaces whole state, and nothing may bypass `applyAction` (ADR-0002).
Rebuilding a fresh `LocalSync` around loaded state (the `main.ts:12` shape) is
rejected: it works only single-machine and cannot hydrate a remote client. Extend
the union at `state.ts:37`:

```ts
| { type: "loadState"; state: BoardState }
```

The reducer case returns `action.state` (after `normalize`, below). This is also
the multiplayer-correct primitive: the phase-B server broadcasts `loadState` to
hydrate a late joiner or load a saved game into a room, and every client converges
by replaying it (ADR-0002). It records one history entry so an accidental load is
undoable.

### 4. The `BoardStore` seam — the spine of this ADR
Persistence is not a transport, so it is **not** a `BoardSync` implementation. It
is a collaborator, a `BoardStore`, keyed by the game name, wired in `main.ts`
around the existing seam:

```ts
interface BoardStore {
  get(name: string): Promise<SavedBoard | null>;
  put(board: SavedBoard): Promise<void>;   // keyed by board.name
  list(): Promise<BoardMeta[]>;            // { name, savedAt }
  delete(name: string): Promise<void>;
}
```

- **Save** = `sync.subscribe(...)` (`sync.ts:27`), debounce, `put` the envelope of
  `sync.getState()` under the current game name. Read-only on the sync; `BoardSync`
  gains nothing.
- **Load** = `sync.dispatch({ type: "loadState", state })` — the seam's own door.
- **Boot** (`main.ts`): restore the last-opened game name and `dispatch` a
  `loadState`; else `seed()`. `BoardSync` is untouched; the *only* domain change is
  the new action + reducer case (plus its vitest, per the domain-change checklist).

The **phase-A** implementation is a **`LocalBoardStore`**; the **phase-B** DB server
is a **`ServerBoardStore`** — the interface is identical, so phase B is a drop-in,
not a rewrite. This is the same seam discipline as `BoardSync`.

### 5. Backends — phased, one seam
- **Phase A (ships first): `LocalBoardStore` over IndexedDB.** IndexedDB, not
  `localStorage`, because phase A stores *several named boards* and lists them —
  a structured, async KV keyed by game name fits; `localStorage` is a single small
  string blob. `localStorage` still holds one tiny thing: the **last-opened game
  name** for autosave-resume. This backend is the source of truth in phase A and
  ships the whole UI/domain **without a server**.
- **Phase B (later): `ServerBoardStore` over HTTP → DB.** The owner's eventual
  authoritative backend. Same envelope, same game-name key. When present it becomes
  the source of truth and the local store may downgrade to an offline cache (queue
  unsynced `put`s, flush on reconnect).
- **File export/import** of the envelope JSON is available from phase A as a
  backup/share path independent of any backend. Cheap: `Blob` download;
  `<input type=file>` + `JSON.parse` + validate + `loadState`.

### 6. Phase-B server shape — **one small TypeScript service + SQLite**
When phase B is built, recommended stack (solo dev on Windows, and *reuse* of the
domain package):
- **Language: TypeScript**, same as the app — so the **pure domain** (`applyAction`,
  `normalize`, migrations) is a shared module imported by both client and server;
  the server validates intents and migrates with the exact client code (ADR-0002).
- **Framework: Fastify** (small, first-class TS types); Hono/Express equivalent.
- **DB: SQLite** (`better-sqlite3`) — a single file, no daemon on Windows, trivial
  backup; the envelope stored as a JSON/TEXT column keyed by game name, behind a
  small repository interface so **SQLite → Postgres** is a later swap
  (`docs/context/hosting.md:27` already anticipates a Node service).

REST surface maps 1:1 onto `BoardStore` (game name is the path key):

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/boards` | List saved games (`name, savedAt`) |
| `GET` | `/boards/:name` | Fetch the envelope |
| `PUT` | `/boards/:name` | Upsert the envelope (autosave target) |
| `DELETE` | `/boards/:name` | Delete |

No auth in this model — the game name is the whole identity. (An account/ownership
layer is a later, separable addition; see open questions.)

### 7. Relationship to the multiplayer server — **same server, grown up**
The phase-B service is **not** a separate persistence microservice; it is the
Phase-6 authoritative server's **storage tier arriving early**. Build it as *one*
service: HTTP + DB, add a WebSocket endpoint when `WebSocketSync` lands. The
persisted envelope is the room baseline the server hydrates from and checkpoints to;
`loadState` is that hydration primitive; the shared domain package gives the server
the same `applyAction` it needs to validate intents. The nginx static tier stays
the web tier — the Node service `hosting.md:38` already predicted. Nothing is
throwaway; phase B is the on-ramp to multiplayer.

### 8. Versioning & migration
A single monotonic integer `schemaVersion` and an ordered registry of **pure**
migrations `migrate[v]: (state) => stateV+1`, applied in sequence until current — a
domain-adjacent, testable concern in the shared package. Purely-additive shape
changes (a new empty record like `players: {}` per ADR-0006, a new `x | null`
field) are handled by a `normalize()` defaulting step on load rather than a
numbered migration; numbered migrations are reserved for renames/removals/semantic
changes. A version **newer** than the code understands is refused with a clear
error, never silently coerced; a missing version is treated as v1. The same path
runs in the local store, the server, and on file import.

### 9. Minimal shippable slice — this is **phase A**
- The `SavedBoard` envelope + `CURRENT_SCHEMA_VERSION = 1`; the `loadState` action +
  reducer case + `normalize()`, in the domain (with tests).
- `LocalBoardStore` over IndexedDB behind `BoardStore`, keyed by game name.
- UI: name a game, save, list saved games, load one; debounced autosave to the
  current name; boot restores the last-opened name (else `seed()`).
- File export/import as backup/share.
- Defer to **phase B**: the `ServerBoardStore`, the Fastify+SQLite service, and any
  offline-cache reconciliation.

## Consequences
- **Phase A ships client-only again** — the seam restores persistence as a
  near-term, server-independent wedge; the DB server is deferred behind the same
  interface, honoring the owner's "server eventually, local first" split.
- **Nothing is throwaway for the server or multiplayer.** The envelope is the room
  baseline; `loadState` is the late-join/scenario-load primitive; `BoardStore` is
  the client side of server room storage; the shared domain package is the server's
  validator. Same discipline as ADR-0002.
- **One domain change**, small and reducer-local: a `loadState` variant + case + a
  `name` field on the envelope (not on `BoardState`). `BoardSync` and the renderer
  are unchanged.
- **No account/auth complexity now.** Game name is the identity; the account layer
  is a clean later addition, not a prerequisite.
- **Migration is first-class and tested** from v1, so the coming growth (units,
  players, budgets, image terrain) lands as ordered migrations or additive defaults
  without breaking saved games — in local store and server alike.
- **mm-only intact (ADR-0001):** the envelope serializes `BoardState` verbatim; no
  pixel/grid field. Image-terrain envelopes stay references, not embedded raster
  bytes, so records and payloads stay small.

## Phase impact — flag for the PM
Persistence is now **two phases**:
- **Phase A — named local save/load** (client + domain only): UI, envelope,
  `loadState`, autosave-resume, export/import, `LocalBoardStore`. **Depends on
  Phase 0 only**; ships without a backend. A near-term wedge.
- **Phase B — `ServerBoardStore` + DB service**: stands up the authoritative
  server's storage tier (Fastify + SQLite), effectively an early slice of Phase 6
  (`roadmap.md:237`) and the on-ramp to multiplayer. The PM sequences this relative
  to the multiplayer phase; because the envelope + migrations absorb schema growth,
  it need not wait for every state-shape question (units/players/budgets) to freeze,
  but the reorder should be acknowledged.

## Open questions
1. **Game-name collision policy.** On `put`/save under an existing name —
   **overwrite** (last-write-wins; simplest, matches autosave), **reject** (force a
   new name; safest against clobbering), or **auto-suffix** (`"Battle" → "Battle 2"`;
   friendliest)? Autosave wants overwrite-of-current; an explicit "Save as" wants
   reject-or-suffix. Decide the default and the "Save as" behavior for phase A.
2. **Name identity rules.** Case sensitivity, trimming, max length, allowed
   characters (the name is also a server path segment in phase B — must be URL-safe
   or encoded), and empty-name handling.
3. **Local → server migration of records** when phase B lands: does the client push
   existing local games to the server, and how are name collisions across the two
   backends resolved?
4. **Autosave under multiplayer.** Once a `WebSocketSync` is authoritative, the
   server owns writes; client autosave must not race server checkpoints (pause vs
   cache-and-flush).
5. **Ownership/sharing later.** Game name alone has no owner; multiplayer/sharing
   will eventually want *who may open/edit a game*. Where an account/ACL layer sits
   (server metadata beside the name) is deferred but flagged.
6. **Image-terrain assets (Phase 1).** Reference vs embedded bytes and where cached
   — owned by the image-terrain ADR, but envelopes must not embed raster bytes.
7. **Undo semantics of a load.** `loadState` pushes one undo step here; a fresh file
   import or "open other game" arguably should reset history. Decide when redo lands
   (Phase 2).

## Alternatives
- **Server DB as the *first* backend (skip phase A).** Owner chose local-first so
  the UI/domain ship without waiting on a backend; the seam makes phase B a drop-in.
  Rejected as the starting point, retained as phase B.
- **`localStorage` for phase A instead of IndexedDB.** A single string blob is
  awkward for *multiple named* records and listing them; IndexedDB is the structured
  fit. `localStorage` is kept only for the last-opened-name pointer. 
- **Accounts as the identity model (server `userId` + cookie).** Heavier and not
  wanted now; owner set the game name as the whole identity. Rejected for now;
  a separable later addition (open question 5).
- **Persistence as a `BoardStore`-less new `BoardSync`.** Conflates storage with
  transport. Rejected — a store is orthogonal to how actions become authoritative;
  it sits beside the seam and plugs in via `subscribe`/`dispatch`.
- **Persist the action log from genesis.** Unbounded growth, drag-noise, seed
  coupling, no solo benefit. Rejected as the durable artifact; the log stays the
  live delta, the snapshot its checkpoint.
- **Rebuild `LocalSync` around loaded state instead of a `loadState` action.**
  Bypasses the reducer (violates ADR-0002) and cannot hydrate a remote client.
  Rejected.
