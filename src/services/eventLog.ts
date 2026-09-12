import type { AppContext } from "../appContext.ts";

export function appendLog(
  ctx: AppContext,
  eventId: string,
  type: string,
  payload: unknown,
): { seq: number; type: string } {
  const row = ctx.db
    .prepare(`SELECT COALESCE(MAX(seq), 0) AS seq FROM event_log WHERE event_id = ?`)
    .get(eventId) as { seq: number };
  const seq = row.seq + 1;
  ctx.db
    .prepare(
      `INSERT INTO event_log (event_id, seq, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(eventId, seq, type, JSON.stringify(payload), ctx.clock.now());
  return { seq, type };
}

export function readLog(ctx: AppContext, eventId: string, since = 0) {
  return ctx.db
    .prepare(
      `SELECT seq, type, payload_json AS payloadJson, created_at AS createdAt
       FROM event_log WHERE event_id = ? AND seq > ? ORDER BY seq`,
    )
    .all(eventId, since)
    .map((row: any) => ({
      seq: row.seq,
      type: row.type,
      payload: JSON.parse(row.payloadJson),
      createdAt: row.createdAt,
    }));
}
