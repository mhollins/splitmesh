# SplitMesh

SplitMesh is a collaborative race-day timing platform for cross country and track & field coaches. Multiple coaches record athletes at different points on a course; everyone on the meet sees the same splits, pace, and PR/season-best context in near real time.

This repository is the first vertical slice of that product.

## Quick start

```bash
npm install
npm run seed
npm run dev
```

- App: [http://localhost:5173](http://localhost:5173)
- API: [http://localhost:3000](http://localhost:3000)

Demo accounts (password `password123` for both):

| User | Email |
| --- | --- |
| Coach A | `coach-a@splitmesh.local` |
| Coach B | `coach-b@splitmesh.local` |

Both are members of **Lincoln XC**. Open two browsers (or a window and a private window), log in as each coach, and open the live **Varsity Boys 5K** event. Taps on one screen appear on the other.

## Tests

```bash
npm test
```

npm 11+ may block native install scripts. If `better-sqlite3` fails to load:

```bash
npm install-scripts approve better-sqlite3 esbuild
npm rebuild better-sqlite3
```

## Documentation

- [Architecture and trade-offs](docs/ARCHITECTURE.md)
- [Domain model](docs/DOMAIN.md)
- [Real-time strategy](docs/REALTIME.md)
