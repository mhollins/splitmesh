import type { AppContext } from "../appContext.ts";
import { newId, withTx, type Db } from "../db/index.ts";
import { DEFAULT_EVENT_TYPES, normalizeSplits, type EventTypeInput } from "../domain/eventTypes.ts";
import { isDiscipline } from "../domain/roles.ts";
import { badRequest, notFound } from "../http/errors.ts";
import { requireMembership } from "./access.ts";

export type EventTypeRecord = {
  id: string;
  teamId: string;
  name: string;
  distanceMeters: number;
  discipline: string;
  splits: { id: string; name: string; distanceMeters: number; sortOrder: number }[];
};

export function seedEventTypes(db: Db, teamId: string, now: number): void {
  const existing = db.prepare(`SELECT COUNT(*) AS n FROM event_types WHERE team_id = ?`).get(teamId) as { n: number };
  if (existing.n > 0) return;
  insertEventTypes(db, teamId, DEFAULT_EVENT_TYPES, now);
}

function insertEventTypes(db: Db, teamId: string, types: EventTypeInput[], now: number): void {
  const insertType = db.prepare(
    `INSERT INTO event_types (id, team_id, name, distance_meters, discipline, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const insertSplit = db.prepare(
    `INSERT INTO event_type_splits (id, event_type_id, name, distance_meters, sort_order) VALUES (?, ?, ?, ?, ?)`,
  );
  for (const type of types) {
    const id = newId();
    insertType.run(id, teamId, type.name, type.distanceMeters, type.discipline, now);
    normalizeSplits(type.distanceMeters, type.splits).forEach((split, index) => {
      insertSplit.run(newId(), id, split.name, split.distanceMeters, index + 1);
    });
  }
}

export function listEventTypes(ctx: AppContext, userId: string, teamId: string): EventTypeRecord[] {
  requireMembership(ctx, userId, teamId, "viewer");
  seedEventTypes(ctx.db, teamId, ctx.clock.now());
  const types = ctx.db
    .prepare(
      `SELECT id, team_id AS teamId, name, distance_meters AS distanceMeters, discipline
       FROM event_types WHERE team_id = ? ORDER BY distance_meters, name`,
    )
    .all(teamId) as { id: string; teamId: string; name: string; distanceMeters: number; discipline: string }[];
  return types.map((type) => ({ ...type, splits: loadSplits(ctx, type.id) }));
}

function loadSplits(ctx: AppContext, eventTypeId: string) {
  return ctx.db
    .prepare(
      `SELECT id, name, distance_meters AS distanceMeters, sort_order AS sortOrder
       FROM event_type_splits WHERE event_type_id = ? ORDER BY sort_order`,
    )
    .all(eventTypeId) as { id: string; name: string; distanceMeters: number; sortOrder: number }[];
}

export function getEventType(ctx: AppContext, eventTypeId: string): EventTypeRecord {
  const type = ctx.db
    .prepare(
      `SELECT id, team_id AS teamId, name, distance_meters AS distanceMeters, discipline
       FROM event_types WHERE id = ?`,
    )
    .get(eventTypeId) as EventTypeRecord | undefined;
  if (!type) throw notFound("Event type not found");
  return { ...type, splits: loadSplits(ctx, type.id) };
}

export function createEventType(ctx: AppContext, userId: string, teamId: string, input: EventTypeInput) {
  requireMembership(ctx, userId, teamId, "coach");
  const parsed = parseTypeInput(input);
  const id = newId();
  withTx(ctx.db, () => {
    ctx.db
      .prepare(
        `INSERT INTO event_types (id, team_id, name, distance_meters, discipline, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, teamId, parsed.name, parsed.distanceMeters, parsed.discipline, ctx.clock.now());
    replaceSplits(ctx.db, id, parsed.splits);
  });
  return getEventType(ctx, id);
}

export function updateEventType(ctx: AppContext, userId: string, eventTypeId: string, input: EventTypeInput) {
  const current = getEventType(ctx, eventTypeId);
  requireMembership(ctx, userId, current.teamId, "coach");
  const parsed = parseTypeInput(input);
  withTx(ctx.db, () => {
    ctx.db
      .prepare(`UPDATE event_types SET name = ?, distance_meters = ?, discipline = ? WHERE id = ?`)
      .run(parsed.name, parsed.distanceMeters, parsed.discipline, eventTypeId);
    ctx.db.prepare(`DELETE FROM event_type_splits WHERE event_type_id = ?`).run(eventTypeId);
    replaceSplits(ctx.db, eventTypeId, parsed.splits);
  });
  return getEventType(ctx, eventTypeId);
}

export function deleteEventType(ctx: AppContext, userId: string, eventTypeId: string) {
  const current = getEventType(ctx, eventTypeId);
  requireMembership(ctx, userId, current.teamId, "coach");
  withTx(ctx.db, () => {
    ctx.db.prepare(`UPDATE events SET event_type_id = NULL WHERE event_type_id = ?`).run(eventTypeId);
    ctx.db.prepare(`DELETE FROM event_type_splits WHERE event_type_id = ?`).run(eventTypeId);
    ctx.db.prepare(`DELETE FROM event_types WHERE id = ?`).run(eventTypeId);
  });
  return { ok: true };
}

function parseTypeInput(input: EventTypeInput) {
  const name = input.name.trim();
  if (!name) throw badRequest("Event name is required");
  if (!Number.isInteger(input.distanceMeters) || input.distanceMeters <= 0) {
    throw badRequest("distanceMeters must be a positive integer");
  }
  if (!isDiscipline(input.discipline)) throw badRequest("Unknown discipline");
  const splits = normalizeSplits(input.distanceMeters, input.splits ?? []);
  return { name, distanceMeters: input.distanceMeters, discipline: input.discipline, splits };
}

function replaceSplits(db: Db, eventTypeId: string, splits: { name: string; distanceMeters: number }[]) {
  const insert = db.prepare(
    `INSERT INTO event_type_splits (id, event_type_id, name, distance_meters, sort_order) VALUES (?, ?, ?, ?, ?)`,
  );
  splits.forEach((split, index) => {
    insert.run(newId(), eventTypeId, split.name, split.distanceMeters, index + 1);
  });
}
