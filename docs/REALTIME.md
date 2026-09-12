# SplitMesh real-time strategy

Race day is a shared session, not a set of stopwatches that sync later.

## Model

- **Writes:** `POST /api/events/:eventId/observations` (and retract). Ordinary authenticated HTTP. Idempotent via `idempotencyKey`.
- **Source of truth:** SQLite rows + an `event_log` table with a monotonic `seq` per event.
- **Reads (live):** `GET /api/events/:eventId/stream` (SSE). On connect, and after every log append, the server sends a full **state snapshot** `{ seq, ... }`.
- **Reads (catch-up / audit):** `GET /api/events/:eventId/state` and `GET /api/events/:eventId/log?since=seq`.

Clients do not apply patches. They replace their local event state with the latest snapshot. For a high-school roster this is small and always consistent.

## Ordering

SQLite `BEGIN IMMEDIATE` serializes writers on one process. `seq` increases by one inside that transaction. SSE consumers therefore see a total order: `seq=1, 2, 3, …`.

`observed_at` is the server clock at commit, so elapsed times do not depend on whose phone is fast or slow. `client_observed_at` is stored for audit and for a future clock-offset feature.

## Reconnection

EventSource reconnects automatically. Each (re)connect sends the current snapshot, so a coach who lost cellular for thirty seconds catches up without a special protocol. The log exists so a future incremental client can request `since=lastSeq` instead of a snapshot.

## Conflicts

Covered in `docs/DOMAIN.md`. The live snapshot includes conflict observations next to the primary so both Coach A and Coach B see that two taps exist. The system never drops the losing tap.

## Offline / poor connectivity (left open, not built)

The write path is already queue-friendly: a client can persist `{ athleteId, timingPointId, idempotencyKey, clientObservedAt }` and POST when the radio returns. The server remains authoritative for `observed_at` unless we later accept adjusted client times. The first slice does not include a durable offline queue.

## Failure behavior

- Duplicate key → original observation, HTTP 200, same `id`.
- Event not live → 409.
- Unauthorized team → 403.
- SSE subscriber errors are isolated; a bad client does not stall writers.
