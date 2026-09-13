import type { AppContext } from "../appContext.ts";
import { categoryForDiscipline, isDiscipline, type Discipline } from "../domain/roles.ts";
import { defaultTimingPoints } from "../domain/timing.ts";
import { newId, withTx } from "../db/index.ts";
import { badRequest, conflict, notFound } from "../http/errors.ts";
import { requireEventAccess, requireMembership } from "./access.ts";
import { clearEventTiming, deleteEvents, deleteMeetGraph } from "./cascade.ts";
import { appendLog } from "./eventLog.ts";
import { defaultDisciplineForDistance, recomputeTimeRecords } from "./records.ts";

function lookupPrMs(
  ctx: AppContext,
  athleteId: string,
  discipline: string,
  distanceMeters: number | null,
): number | null {
  if (distanceMeters == null) return null;
  const exact = ctx.db
    .prepare(
      `SELECT mark_value AS markValueMs FROM personal_records
       WHERE athlete_id = ? AND discipline = ? AND distance_meters = ? AND mark_type = 'time_ms'`,
    )
    .get(athleteId, discipline, distanceMeters) as { markValueMs: number } | undefined;
  if (exact) return exact.markValueMs;
  const fallback = ctx.db
    .prepare(
      `SELECT mark_value AS markValueMs FROM personal_records
       WHERE athlete_id = ? AND distance_meters = ? AND mark_type = 'time_ms'
       ORDER BY recorded_at DESC LIMIT 1`,
    )
    .get(athleteId, distanceMeters) as { markValueMs: number } | undefined;
  return fallback?.markValueMs ?? null;
}

function currentSeasonId(ctx: AppContext, teamId: string): string {
  const row = ctx.db
    .prepare(`SELECT id FROM seasons WHERE team_id = ? ORDER BY created_at DESC LIMIT 1`)
    .get(teamId) as { id: string } | undefined;
  if (!row) throw notFound("Team has no season");
  return row.id;
}

export function createMeet(
  ctx: AppContext,
  userId: string,
  teamId: string,
  input: { name: string; startsOn: string; location?: string },
) {
  requireMembership(ctx, userId, teamId, "coach");
  const name = input.name.trim();
  if (!name) throw badRequest("Meet name is required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startsOn)) throw badRequest("startsOn must be YYYY-MM-DD");
  const id = newId();
  const seasonId = currentSeasonId(ctx, teamId);
  ctx.db
    .prepare(
      `INSERT INTO meets (id, team_id, season_id, name, starts_on, location, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, teamId, seasonId, name, input.startsOn, input.location?.trim() ?? null, "scheduled", ctx.clock.now());
  return getMeet(ctx, userId, id);
}

export function listMeets(ctx: AppContext, userId: string, teamId: string) {
  requireMembership(ctx, userId, teamId, "viewer");
  return ctx.db
    .prepare(
      `SELECT id, name, starts_on AS startsOn, location, status, season_id AS seasonId
       FROM meets WHERE team_id = ? ORDER BY starts_on DESC, name`,
    )
    .all(teamId);
}

export function getMeet(ctx: AppContext, userId: string, meetId: string) {
  const meet = ctx.db
    .prepare(
      `SELECT id, team_id AS teamId, season_id AS seasonId, name, starts_on AS startsOn, location, status
       FROM meets WHERE id = ?`,
    )
    .get(meetId) as
    | {
        id: string;
        teamId: string;
        seasonId: string;
        name: string;
        startsOn: string;
        location: string | null;
        status: string;
      }
    | undefined;
  if (!meet) throw notFound("Meet not found");
  requireMembership(ctx, userId, meet.teamId, "viewer");
  const events = ctx.db
    .prepare(
      `SELECT e.id, e.name, e.category, e.discipline, e.distance_meters AS distanceMeters, e.status,
              e.started_at AS startedAt, e.paused_at AS pausedAt,
              (SELECT COUNT(*) FROM event_entries ee WHERE ee.event_id = e.id) AS entryCount
       FROM events e WHERE e.meet_id = ? ORDER BY e.created_at`,
    )
    .all(meetId);
  return { ...meet, events };
}

export function updateMeet(
  ctx: AppContext,
  userId: string,
  meetId: string,
  input: { name?: string; startsOn?: string; location?: string | null },
) {
  const current = getMeet(ctx, userId, meetId);
  requireMembership(ctx, userId, current.teamId, "coach");
  const name = input.name !== undefined ? input.name.trim() : current.name;
  if (!name) throw badRequest("Meet name is required");
  const startsOn = input.startsOn ?? current.startsOn;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn)) throw badRequest("startsOn must be YYYY-MM-DD");
  const location =
    input.location !== undefined ? input.location?.trim() || null : current.location;
  ctx.db
    .prepare(`UPDATE meets SET name = ?, starts_on = ?, location = ? WHERE id = ?`)
    .run(name, startsOn, location, meetId);
  return getMeet(ctx, userId, meetId);
}

export function deleteMeet(ctx: AppContext, userId: string, meetId: string) {
  const current = getMeet(ctx, userId, meetId);
  requireMembership(ctx, userId, current.teamId, "coach");
  withTx(ctx.db, () => {
    deleteMeetGraph(ctx.db, meetId);
  });
  return { ok: true };
}

export function deleteEvent(ctx: AppContext, userId: string, eventId: string) {
  const { event, meet } = requireEventAccess(ctx, userId, eventId, "coach");
  withTx(ctx.db, () => {
    const athletes = ctx.db
      .prepare(`SELECT DISTINCT athlete_id AS athleteId FROM event_entries WHERE event_id = ?`)
      .all(eventId) as { athleteId: string }[];
    deleteEvents(ctx.db, [eventId]);
    const remainingLive = ctx.db
      .prepare(`SELECT COUNT(*) AS n FROM events WHERE meet_id = ? AND status IN ('live', 'paused')`)
      .get(meet.id) as { n: number };
    if (remainingLive.n === 0) {
      const remainingCompleted = ctx.db
        .prepare(`SELECT COUNT(*) AS n FROM events WHERE meet_id = ? AND status = 'completed'`)
        .get(meet.id) as { n: number };
      ctx.db
        .prepare(`UPDATE meets SET status = ? WHERE id = ?`)
        .run(remainingCompleted.n > 0 ? "completed" : "scheduled", meet.id);
    }
    if (event.distance_meters != null) {
      for (const row of athletes) {
        recomputeTimeRecords(ctx, {
          athleteId: row.athleteId,
          seasonId: meet.season_id,
          discipline: event.discipline,
          distanceMeters: event.distance_meters,
        });
      }
    }
  });
  return { ok: true };
}

export function createEvent(
  ctx: AppContext,
  userId: string,
  meetId: string,
  input: {
    name: string;
    discipline?: string;
    distanceMeters: number;
    timingPoints?: { name: string; distanceMeters: number }[];
  },
) {
  const meet = ctx.db
    .prepare(`SELECT id, team_id FROM meets WHERE id = ?`)
    .get(meetId) as { id: string; team_id: string } | undefined;
  if (!meet) throw notFound("Meet not found");
  requireMembership(ctx, userId, meet.team_id, "coach");
  const name = input.name.trim();
  if (!name) throw badRequest("Event name is required");
  if (!Number.isInteger(input.distanceMeters) || input.distanceMeters <= 0) {
    throw badRequest("distanceMeters must be a positive integer");
  }
  const discipline = (input.discipline ?? defaultDisciplineForDistance(input.distanceMeters)) as Discipline;
  if (!isDiscipline(discipline)) throw badRequest("Unknown discipline");
  const category = categoryForDiscipline(discipline);
  if (category !== "running") {
    throw badRequest("This slice only creates running events");
  }
  const points = input.timingPoints?.length
    ? input.timingPoints
    : defaultTimingPoints(input.distanceMeters);

  return withTx(ctx.db, () => {
    const eventId = newId();
    ctx.db
      .prepare(
        `INSERT INTO events (id, meet_id, name, category, discipline, distance_meters, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        eventId,
        meetId,
        name,
        category,
        discipline,
        input.distanceMeters,
        "upcoming",
        ctx.clock.now(),
      );
    const insertPoint = ctx.db.prepare(
      `INSERT INTO timing_points (id, event_id, name, distance_meters, sort_order, is_finish)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    points.forEach((point, index) => {
      const isFinish = index === points.length - 1;
      insertPoint.run(
        newId(),
        eventId,
        point.name,
        point.distanceMeters,
        index + 1,
        isFinish ? 1 : 0,
      );
    });
    return loadEvent(ctx, eventId);
  });
}

export type EventRecord = {
  id: string;
  meetId: string;
  teamId: string;
  name: string;
  category: string;
  discipline: string;
  distanceMeters: number | null;
  status: string;
  startedAt: number | null;
  pausedAt: number | null;
  completedAt: number | null;
  timingPoints: { id: string; name: string; distanceMeters: number; sortOrder: number; isFinish: boolean }[];
  entries: {
    id: string;
    athleteId: string;
    firstName: string;
    lastName: string;
    gender: string;
    gradeLevel: string;
    bib: string | null;
    targetTimeMs: number | null;
  }[];
};

export function loadEvent(ctx: AppContext, eventId: string): EventRecord {
  const event = ctx.db
    .prepare(
      `SELECT e.id, e.meet_id AS meetId, m.team_id AS teamId, e.name, e.category, e.discipline,
              e.distance_meters AS distanceMeters, e.status, e.started_at AS startedAt,
              e.paused_at AS pausedAt, e.completed_at AS completedAt
       FROM events e JOIN meets m ON m.id = e.meet_id WHERE e.id = ?`,
    )
    .get(eventId) as Omit<EventRecord, "timingPoints" | "entries"> | undefined;
  if (!event) throw notFound("Event not found");
  const timingPoints = (
    ctx.db
      .prepare(
        `SELECT id, name, distance_meters AS distanceMeters, sort_order AS sortOrder, is_finish AS isFinish
         FROM timing_points WHERE event_id = ? ORDER BY sort_order`,
      )
      .all(eventId) as { id: string; name: string; distanceMeters: number; sortOrder: number; isFinish: number }[]
  ).map((p) => ({ ...p, isFinish: Boolean(p.isFinish) }));
  const entries = ctx.db
    .prepare(
      `SELECT ee.id, ee.athlete_id AS athleteId, a.first_name AS firstName, a.last_name AS lastName,
              a.gender, a.grade_level AS gradeLevel, ee.bib, ee.target_time_ms AS targetTimeMs
       FROM event_entries ee
       JOIN athletes a ON a.id = ee.athlete_id
       WHERE ee.event_id = ?
       ORDER BY a.last_name, a.first_name`,
    )
    .all(eventId) as EventRecord["entries"];
  return { ...event, timingPoints, entries };
}

export function addEntries(
  ctx: AppContext,
  userId: string,
  eventId: string,
  input: { athleteIds: string[]; targetTimeMs?: number | null },
) {
  const { meet } = requireEventAccess(ctx, userId, eventId, "coach");
  if (!input.athleteIds.length) throw badRequest("athleteIds required");
  const now = ctx.clock.now();
  const eventRow = ctx.db
    .prepare(`SELECT status, started_at, discipline, distance_meters FROM events WHERE id = ?`)
    .get(eventId) as {
    status: string;
    started_at: number | null;
    discipline: string;
    distance_meters: number | null;
  };

  return withTx(ctx.db, () => {
    const insertEntry = ctx.db.prepare(
      `INSERT OR IGNORE INTO event_entries (id, event_id, athlete_id, bib, target_time_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const insertPerf = ctx.db.prepare(
      `INSERT INTO performances (id, event_entry_id, event_id, athlete_id, status, started_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const athleteId of input.athleteIds) {
      const athlete = ctx.db
        .prepare(`SELECT id FROM athletes WHERE id = ? AND team_id = ?`)
        .get(athleteId, meet.team_id);
      if (!athlete) throw badRequest(`Athlete ${athleteId} is not on this team`);
      const targetTimeMs =
        input.targetTimeMs !== undefined && input.targetTimeMs !== null
          ? input.targetTimeMs
          : lookupPrMs(ctx, athleteId, eventRow.discipline, eventRow.distance_meters);
      const entryId = newId();
      const result = insertEntry.run(
        entryId,
        eventId,
        athleteId,
        null,
        targetTimeMs,
        now,
      );
      if (result.changes === 0) continue;
      const created = ctx.db
        .prepare(`SELECT id FROM event_entries WHERE event_id = ? AND athlete_id = ?`)
        .get(eventId, athleteId) as { id: string };
      if (eventRow.status === "live" || eventRow.status === "paused") {
        insertPerf.run(newId(), created.id, eventId, athleteId, "in_progress", eventRow.started_at, now);
      }
    }
    return loadEvent(ctx, eventId);
  });
}

export function setEntryTarget(
  ctx: AppContext,
  userId: string,
  eventId: string,
  athleteId: string,
  targetTimeMs: number | null,
) {
  requireEventAccess(ctx, userId, eventId, "coach");
  const result = ctx.db
    .prepare(`UPDATE event_entries SET target_time_ms = ? WHERE event_id = ? AND athlete_id = ?`)
    .run(targetTimeMs, eventId, athleteId);
  if (result.changes === 0) throw notFound("Entry not found");
  return loadEvent(ctx, eventId);
}

export function removeEntry(ctx: AppContext, userId: string, eventId: string, athleteId: string) {
  const { event } = requireEventAccess(ctx, userId, eventId, "coach");
  const entry = ctx.db
    .prepare(`SELECT id FROM event_entries WHERE event_id = ? AND athlete_id = ?`)
    .get(eventId, athleteId);
  if (!entry) throw notFound("Entry not found");
  if (event.status !== "upcoming") {
    throw conflict("Cannot remove athletes after the event has started", "EVENT_NOT_UPCOMING");
  }
  ctx.db.prepare(`DELETE FROM event_entries WHERE event_id = ? AND athlete_id = ?`).run(eventId, athleteId);
  return loadEvent(ctx, eventId);
}

export function startEvent(ctx: AppContext, userId: string, eventId: string) {
  const { event } = requireEventAccess(ctx, userId, eventId, "assistant");
  if (event.status === "completed") throw conflict("Event already completed", "EVENT_COMPLETED");
  if (event.status === "live") return loadEvent(ctx, eventId);

  const now = ctx.clock.now();
  if (event.status === "paused") {
    const pausedAt = loadPausedAt(ctx, eventId);
    if (pausedAt == null) throw conflict("Event is not paused", "EVENT_NOT_PAUSED");
    const delta = now - pausedAt;
    withTx(ctx.db, () => {
      ctx.db
        .prepare(`UPDATE events SET status = 'live', started_at = started_at + ?, paused_at = NULL WHERE id = ?`)
        .run(delta, eventId);
      ctx.db
        .prepare(
          `UPDATE timing_observations SET observed_at = observed_at + ?, recorded_at = recorded_at + ? WHERE event_id = ?`,
        )
        .run(delta, delta, eventId);
      appendLog(ctx, eventId, "event.resumed", { resumedAt: now });
    });
    ctx.bus.publish(eventId, currentSeq(ctx, eventId), "event.resumed");
    return loadEvent(ctx, eventId);
  }

  withTx(ctx.db, () => {
    ctx.db
      .prepare(`UPDATE events SET status = 'live', started_at = ?, paused_at = NULL WHERE id = ?`)
      .run(now, eventId);
    ctx.db.prepare(`UPDATE meets SET status = 'live' WHERE id = ? AND status = 'scheduled'`).run(event.meet_id);
    const entries = ctx.db
      .prepare(`SELECT id, athlete_id FROM event_entries WHERE event_id = ?`)
      .all(eventId) as { id: string; athlete_id: string }[];
    const insertPerf = ctx.db.prepare(
      `INSERT OR IGNORE INTO performances (id, event_entry_id, event_id, athlete_id, status, started_at, created_at)
       VALUES (?, ?, ?, ?, 'in_progress', ?, ?)`,
    );
    for (const entry of entries) {
      insertPerf.run(newId(), entry.id, eventId, entry.athlete_id, now, now);
    }
    appendLog(ctx, eventId, "event.started", { startedAt: now });
  });
  ctx.bus.publish(eventId, currentSeq(ctx, eventId), "event.started");
  return loadEvent(ctx, eventId);
}

function loadPausedAt(ctx: AppContext, eventId: string): number | null {
  const row = ctx.db.prepare(`SELECT paused_at FROM events WHERE id = ?`).get(eventId) as
    | { paused_at: number | null }
    | undefined;
  return row?.paused_at ?? null;
}

export function pauseEvent(ctx: AppContext, userId: string, eventId: string) {
  const { event } = requireEventAccess(ctx, userId, eventId, "assistant");
  if (event.status !== "live") throw conflict("Event is not live", "EVENT_NOT_LIVE");
  const now = ctx.clock.now();
  withTx(ctx.db, () => {
    ctx.db.prepare(`UPDATE events SET status = 'paused', paused_at = ? WHERE id = ?`).run(now, eventId);
    appendLog(ctx, eventId, "event.paused", { pausedAt: now });
  });
  ctx.bus.publish(eventId, currentSeq(ctx, eventId), "event.paused");
  return loadEvent(ctx, eventId);
}

export function resetEventClock(ctx: AppContext, userId: string, eventId: string) {
  const { event, meet } = requireEventAccess(ctx, userId, eventId, "coach");
  if (event.status !== "paused") throw conflict("Pause the race before resetting the clock", "EVENT_NOT_PAUSED");
  const athletes = ctx.db
    .prepare(`SELECT DISTINCT athlete_id AS athleteId FROM event_entries WHERE event_id = ?`)
    .all(eventId) as { athleteId: string }[];
  withTx(ctx.db, () => {
    clearEventTiming(ctx.db, eventId);
    ctx.db
      .prepare(
        `UPDATE events SET status = 'upcoming', started_at = NULL, paused_at = NULL, completed_at = NULL WHERE id = ?`,
      )
      .run(eventId);
    const remainingLive = ctx.db
      .prepare(`SELECT COUNT(*) AS n FROM events WHERE meet_id = ? AND status IN ('live', 'paused')`)
      .get(event.meet_id) as { n: number };
    if (remainingLive.n === 0) {
      ctx.db.prepare(`UPDATE meets SET status = 'scheduled' WHERE id = ? AND status = 'live'`).run(meet.id);
    }
    if (event.distance_meters != null) {
      for (const row of athletes) {
        recomputeTimeRecords(ctx, {
          athleteId: row.athleteId,
          seasonId: meet.season_id,
          discipline: event.discipline,
          distanceMeters: event.distance_meters,
        });
      }
    }
    appendLog(ctx, eventId, "event.reset", {});
  });
  ctx.bus.publish(eventId, currentSeq(ctx, eventId), "event.reset");
  return loadEvent(ctx, eventId);
}

export function completeEvent(ctx: AppContext, userId: string, eventId: string) {
  const { event, meet } = requireEventAccess(ctx, userId, eventId, "coach");
  if (event.status !== "live" && event.status !== "paused") {
    throw conflict("Event is not live", "EVENT_NOT_LIVE");
  }
  const now = ctx.clock.now();
  const pausedAt = loadPausedAt(ctx, eventId);
  const completedAt = event.status === "paused" && pausedAt != null ? pausedAt : now;
  withTx(ctx.db, () => {
    ctx.db
      .prepare(`UPDATE events SET status = 'completed', completed_at = ?, paused_at = NULL WHERE id = ?`)
      .run(completedAt, eventId);
    const remainingLive = ctx.db
      .prepare(`SELECT COUNT(*) AS n FROM events WHERE meet_id = ? AND status IN ('live', 'paused')`)
      .get(event.meet_id) as { n: number };
    if (remainingLive.n === 0) {
      ctx.db.prepare(`UPDATE meets SET status = 'completed' WHERE id = ?`).run(meet.id);
    }
    appendLog(ctx, eventId, "event.completed", { completedAt });
  });
  ctx.bus.publish(eventId, currentSeq(ctx, eventId), "event.completed");
  return loadEvent(ctx, eventId);
}

function currentSeq(ctx: AppContext, eventId: string): number {
  const row = ctx.db
    .prepare(`SELECT COALESCE(MAX(seq), 0) AS seq FROM event_log WHERE event_id = ?`)
    .get(eventId) as { seq: number };
  return row.seq;
}
