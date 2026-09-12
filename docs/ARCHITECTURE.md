# SplitMesh architecture

SplitMesh is a multi-user athletic performance platform. The first milestone is a working **shared live-timing** slice: two coaches on the same race see each other's observations in near real time, with splits, pace, and PR/season-best context.

This document records the technology choices for that slice and why they were made.

## Constraints the stack must satisfy

- Authenticated users with server-enforced authorization
- Persistent relational records (teams, athletes, meets, events, performances, observations)
- Concurrent writes from multiple coaches
- Near-real-time fan-out to every connected client on the same event
- Reconnect / catch-up after a dropped connection
- An HTTP API that a web client and a future native client can both consume
- Simple enough to run locally with no extra infrastructure

## Chosen stack

| Layer | Choice | Why |
| --- | --- | --- |
| Language | TypeScript on Node.js | One language for API, domain, and web. Node 26 is already available. |
| HTTP API | Fastify | Small, fast, easy to test with `inject()`, explicit enough for SSE. |
| Web UI | React + Vite | Race-day UI is a focused SPA. Vite proxies `/api` in development. |
| Database | SQLite (WAL) via `better-sqlite3` | Zero local infrastructure. WAL + `BEGIN IMMEDIATE` serializes concurrent writes from a handful of coaches. Schema is ordinary relational SQL and can move to Postgres later. |
| Auth | Email/password + HMAC-signed HTTP-only cookie | Normal user model, no OAuth provider required. Same cookie (and later a bearer token) can serve a native client. |
| Live updates | Server-Sent Events + snapshot | Clients write over HTTP; the server pushes event state. SSE reconnects natively. |
| Tests | Vitest against a real Fastify app and in-memory SQLite | Integration-first, especially for live timing. |

The API is the product surface. The React app is one client of that API.

## Alternatives considered

### Application shape

1. **Fastify API + Vite React (chosen).** Clear API/client split, simple real-time, future mobile clients consume the same routes. Two processes in development, one static bundle served by Fastify in production.
2. **Next.js full-stack.** Faster to scaffold CRUD screens, but long-lived SSE/WebSocket connections fight the serverless/app-router model. Would still need a custom server for race-day push.
3. **Phoenix LiveView.** Excellent real-time story, weaker fit here: the environment is Node, and a future native client still needs a JSON API.

### Database

1. **SQLite with WAL (chosen).** Matches "simplest architecture that works." A meet with a few coaches is well within SQLite's write capacity when writes run in `BEGIN IMMEDIATE` transactions.
2. **Postgres via Docker.** Better default for multi-instance production and heavy write concurrency. Adds Docker as a required dependency for the first slice. Revisit when deploying or when more than one API process is needed.
3. **A document store.** Poor fit for records, PRs, and relational authorization.

### Real-time transport

1. **HTTP POST for writes + SSE snapshots for reads (chosen).** Writes are ordinary authenticated HTTP, so they are easy to make idempotent, retry, and later queue offline. SSE is one-way server push with automatic reconnect. On connect, the server sends the current event state (a snapshot keyed by a monotonic `seq`). That is catch-up.
2. **WebSockets.** Bidirectional and slightly lower latency, but reconnect, missed-event replay, and mobile clients are more work for no MVP benefit. Writes can stay HTTP even with sockets.
3. **Polling.** Simplest, not "near real time," and wasteful on race day.

### Multi-instance fan-out

The live bus is **in-process**. One Node process owns SQLite and all SSE subscribers. That is intentional YAGNI: a single server covers a team's race day. Multi-instance would replace the in-process bus with Postgres `LISTEN/NOTIFY` or Redis and would likely move storage to Postgres at the same time.

## Request flow on race day

```
Coach A tap  --POST /api/events/:id/observations-->  API
                                                      | BEGIN IMMEDIATE
                                                      | persist immutable observation
                                                      | classify primary vs conflict
                                                      | append event_log (seq++)
                                                      | derive splits / pace / projection
                                                      | COMMIT
                                                      v
Coach A SSE <------ snapshot seq=N ---------  in-process bus
Coach B SSE <------ snapshot seq=N ---------
```

Clients never compute official splits. They render server-authoritative state.

## Authorization

Every mutating route loads the caller's team membership and checks a role rank:

`viewer < assistant < coach < admin < owner`

- Join/create team, view live event: authenticated member
- Record / retract observations: `assistant` and above
- Roster, meets, events: `coach` and above
- Membership / team settings: `admin` and above

UI hiding is not the security boundary.

## What this slice deliberately does not include

- Field-event attempt UI (schema allows a `field` category later)
- Native iOS/Android apps
- Offline write queue (API and event log are shaped so a queue can be added)
- OAuth / SSO
- Multi-region or multi-process deployment
- Public results / athlete-facing login
- Automatic gun detection or GPS splits

## Running locally

See the root `README.md`. Default: SQLite file at `data/splitmesh.db`, API at `http://localhost:3000`, Vite at `http://localhost:5173` proxying `/api`.
