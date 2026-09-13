import type { AppContext } from "../appContext.ts";
import { summarizeRunningPerformance, type SplitObservation } from "../domain/timing.ts";
import { newId, withTx } from "../db/index.ts";
import { badRequest, conflict, notFound } from "../http/errors.ts";
import type { LiveEventState } from "../shared/types.ts";
import { requireEventAccess } from "./access.ts";
import { appendLog, readLog } from "./eventLog.ts";
import { recomputeTimeRecords } from "./records.ts";

type ObsRow = {
  id: string;
  event_id: string;
  performance_id: string;
  athlete_id: string;
  timing_point_id: string;
  observed_at: number;
  role: string;
  conflicts_with_id: string | null;
  idempotency_key: string;
  recorded_by_user_id: string;
};

function nextSeq(ctx: AppContext, eventId: string): number {
  const row = ctx.db
    .prepare(`SELECT COALESCE(MAX(seq), 0) AS seq FROM event_log WHERE event_id = ?`)
    .get(eventId) as { seq: number };
  return row.seq;
}

export function recordObservation(
  ctx: AppContext,
  userId: string,
  eventId: string,
  input: {
    athleteId: string;
    timingPointId: string;
    idempotencyKey: string;
    clientObservedAt?: number | null;
  },
) {
  if (!input.idempotencyKey?.trim()) throw badRequest("idempotencyKey is required");
  if (!input.athleteId) throw badRequest("athleteId is required");
  if (!input.timingPointId) throw badRequest("timingPointId is required");

  requireEventAccess(ctx, userId, eventId, "assistant");

  const result = withTx(ctx.db, () => {
    const existing = ctx.db
      .prepare(
        `SELECT * FROM timing_observations WHERE event_id = ? AND idempotency_key = ?`,
      )
      .get(eventId, input.idempotencyKey) as ObsRow | undefined;
    if (existing) {
      return { observation: existing, duplicate: true, seq: nextSeq(ctx, eventId) };
    }

    const event = ctx.db
      .prepare(
        `SELECT e.id, e.status, e.started_at, e.discipline, e.distance_meters, e.meet_id, m.season_id
         FROM events e JOIN meets m ON m.id = e.meet_id WHERE e.id = ?`,
      )
      .get(eventId) as
      | {
          id: string;
          status: string;
          started_at: number | null;
          discipline: string;
          distance_meters: number | null;
          meet_id: string;
          season_id: string;
        }
      | undefined;
    if (!event) throw notFound("Event not found");
    if (event.status !== "live" || event.started_at == null) {
      throw conflict("Event is not live", "EVENT_NOT_LIVE");
    }

    const point = ctx.db
      .prepare(`SELECT id, is_finish FROM timing_points WHERE id = ? AND event_id = ?`)
      .get(input.timingPointId, eventId) as { id: string; is_finish: number } | undefined;
    if (!point) throw badRequest("Timing point does not belong to this event");

    const performance = ctx.db
      .prepare(
        `SELECT p.id, p.status FROM performances p
         JOIN event_entries ee ON ee.id = p.event_entry_id
         WHERE p.event_id = ? AND p.athlete_id = ?`,
      )
      .get(eventId, input.athleteId) as { id: string; status: string } | undefined;
    if (!performance) throw badRequest("Athlete is not in this event");

    const now = ctx.clock.now();
    const primary = ctx.db
      .prepare(
        `SELECT id FROM timing_observations
         WHERE performance_id = ? AND timing_point_id = ? AND role = 'primary'`,
      )
      .get(performance.id, input.timingPointId) as { id: string } | undefined;

    const id = newId();
    const role = primary ? "conflict" : "primary";
    ctx.db
      .prepare(
        `INSERT INTO timing_observations (
           id, event_id, performance_id, athlete_id, timing_point_id,
           observed_at, client_observed_at, recorded_at, recorded_by_user_id,
           idempotency_key, role, conflicts_with_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        eventId,
        performance.id,
        input.athleteId,
        input.timingPointId,
        now,
        input.clientObservedAt ?? null,
        now,
        userId,
        input.idempotencyKey,
        role,
        primary?.id ?? null,
        now,
      );

    if (role === "primary") {
      applyPrimaryEffects(ctx, {
        event,
        performanceId: performance.id,
        athleteId: input.athleteId,
        isFinish: Boolean(point.is_finish),
        observedAt: now,
      });
    }

    const type = role === "conflict" ? "observation.conflict" : "observation.recorded";
    const log = appendLog(ctx, eventId, type, {
      observationId: id,
      athleteId: input.athleteId,
      timingPointId: input.timingPointId,
      role,
      conflictsWithId: primary?.id ?? null,
    });
    const observation = ctx.db
      .prepare(`SELECT * FROM timing_observations WHERE id = ?`)
      .get(id) as ObsRow;
    return { observation, duplicate: false, seq: log.seq };
  });

  ctx.bus.publish(eventId, result.seq, result.observation.role === "conflict" ? "observation.conflict" : "observation.recorded");
  return result;
}

function applyPrimaryEffects(
  ctx: AppContext,
  args: {
    event: { discipline: string; distance_meters: number | null; season_id: string };
    performanceId: string;
    athleteId: string;
    isFinish: boolean;
    observedAt: number;
  },
) {
  const eventRow = ctx.db
    .prepare(`SELECT e.started_at FROM events e JOIN performances p ON p.event_id = e.id WHERE p.id = ?`)
    .get(args.performanceId) as { started_at: number };
  const elapsed = Math.max(0, args.observedAt - eventRow.started_at);
  if (args.isFinish) {
    ctx.db
      .prepare(
        `UPDATE performances
         SET status = 'finished', finished_at = ?, elapsed_ms = ?
         WHERE id = ?`,
      )
      .run(args.observedAt, elapsed, args.performanceId);
    if (args.event.distance_meters != null) {
      recomputeTimeRecords(ctx, {
        athleteId: args.athleteId,
        seasonId: args.event.season_id,
        discipline: args.event.discipline,
        distanceMeters: args.event.distance_meters,
      });
    }
  } else {
    ctx.db
      .prepare(`UPDATE performances SET elapsed_ms = ? WHERE id = ? AND status != 'finished'`)
      .run(elapsed, args.performanceId);
  }
}

export function retractObservation(ctx: AppContext, userId: string, observationId: string) {
  const loaded = ctx.db
    .prepare(`SELECT * FROM timing_observations WHERE id = ?`)
    .get(observationId) as ObsRow | undefined;
  if (!loaded) throw notFound("Observation not found");
  requireEventAccess(ctx, userId, loaded.event_id, "assistant");

  const result = withTx(ctx.db, () => {
    const current = ctx.db
      .prepare(`SELECT * FROM timing_observations WHERE id = ?`)
      .get(observationId) as ObsRow;
    if (current.role === "retracted") return { observation: current, seq: nextSeq(ctx, current.event_id) };

    const event = ctx.db
      .prepare(
        `SELECT e.status, e.discipline, e.distance_meters, m.season_id
         FROM events e JOIN meets m ON m.id = e.meet_id WHERE e.id = ?`,
      )
      .get(current.event_id) as {
      status: string;
      discipline: string;
      distance_meters: number | null;
      season_id: string;
    };
    if (event.status === "completed") throw conflict("Event already completed", "EVENT_COMPLETED");

    const now = ctx.clock.now();
    ctx.db
      .prepare(
        `UPDATE timing_observations
         SET role = 'retracted', retracted_at = ?, retracted_by_user_id = ?, conflicts_with_id = NULL
         WHERE id = ?`,
      )
      .run(now, userId, observationId);

    if (current.role === "primary") {
      const successor = ctx.db
        .prepare(
          `SELECT id FROM timing_observations
           WHERE performance_id = ? AND timing_point_id = ? AND role = 'conflict'
           ORDER BY recorded_at, id LIMIT 1`,
        )
        .get(current.performance_id, current.timing_point_id) as { id: string } | undefined;
      if (successor) {
        ctx.db
          .prepare(`UPDATE timing_observations SET role = 'primary', conflicts_with_id = NULL WHERE id = ?`)
          .run(successor.id);
        ctx.db
          .prepare(
            `UPDATE timing_observations SET conflicts_with_id = ?
             WHERE performance_id = ? AND timing_point_id = ? AND role = 'conflict'`,
          )
          .run(successor.id, current.performance_id, current.timing_point_id);
        const promoted = ctx.db
          .prepare(`SELECT observed_at FROM timing_observations WHERE id = ?`)
          .get(successor.id) as { observed_at: number };
        const point = ctx.db
          .prepare(`SELECT is_finish FROM timing_points WHERE id = ?`)
          .get(current.timing_point_id) as { is_finish: number };
        applyPrimaryEffects(ctx, {
          event,
          performanceId: current.performance_id,
          athleteId: current.athlete_id,
          isFinish: Boolean(point.is_finish),
          observedAt: promoted.observed_at,
        });
      } else {
        const point = ctx.db
          .prepare(`SELECT is_finish FROM timing_points WHERE id = ?`)
          .get(current.timing_point_id) as { is_finish: number };
        if (point.is_finish) {
          ctx.db
            .prepare(
              `UPDATE performances SET status = 'in_progress', finished_at = NULL, elapsed_ms = NULL WHERE id = ?`,
            )
            .run(current.performance_id);
          if (event.distance_meters != null) {
            recomputeTimeRecords(ctx, {
              athleteId: current.athlete_id,
              seasonId: event.season_id,
              discipline: event.discipline,
              distanceMeters: event.distance_meters,
            });
          }
        }
      }
    }

    const log = appendLog(ctx, current.event_id, "observation.retracted", {
      observationId,
      athleteId: current.athlete_id,
      timingPointId: current.timing_point_id,
    });
    const observation = ctx.db
      .prepare(`SELECT * FROM timing_observations WHERE id = ?`)
      .get(observationId) as ObsRow;
    return { observation, seq: log.seq };
  });

  ctx.bus.publish(loaded.event_id, result.seq, "observation.retracted");
  return result;
}

export function getLiveState(ctx: AppContext, userId: string, eventId: string): LiveEventState {
  requireEventAccess(ctx, userId, eventId, "viewer");
  return buildLiveState(ctx, eventId);
}

export function listEventLog(ctx: AppContext, userId: string, eventId: string, since = 0) {
  requireEventAccess(ctx, userId, eventId, "viewer");
  return { seq: nextSeq(ctx, eventId), entries: readLog(ctx, eventId, since) };
}

export function buildLiveState(ctx: AppContext, eventId: string): LiveEventState {
  const event = ctx.db
    .prepare(
      `SELECT e.id, e.meet_id AS meetId, m.name AS meetName, m.team_id AS teamId, m.season_id AS seasonId,
              e.name, e.category, e.discipline, e.distance_meters AS distanceMeters, e.status,
              e.started_at AS startedAt, e.paused_at AS pausedAt, e.completed_at AS completedAt
       FROM events e JOIN meets m ON m.id = e.meet_id WHERE e.id = ?`,
    )
    .get(eventId) as LiveEventState["event"] | undefined;
  if (!event) throw notFound("Event not found");

  const timingPoints = ctx.db
    .prepare(
      `SELECT id, name, distance_meters AS distanceMeters, sort_order AS sortOrder, is_finish AS isFinish
       FROM timing_points WHERE event_id = ? ORDER BY sort_order`,
    )
    .all(eventId)
    .map((p: any) => ({ ...p, isFinish: Boolean(p.isFinish) }));

  const entries = ctx.db
    .prepare(
      `SELECT ee.id AS entryId, ee.athlete_id AS athleteId, a.first_name AS firstName, a.last_name AS lastName,
              a.gender, a.grade_level AS gradeLevel, ee.bib, ee.target_time_ms AS targetTimeMs,
              p.id AS performanceId, p.status AS performanceStatus,
              pr.mark_value AS personalRecordMs, pr.previous_mark_value AS previousPersonalRecordMs,
              pr.performance_id AS personalRecordPerformanceId, sb.mark_value AS seasonBestMs
       FROM event_entries ee
       JOIN athletes a ON a.id = ee.athlete_id
       LEFT JOIN performances p ON p.event_entry_id = ee.id
       LEFT JOIN personal_records pr
         ON pr.athlete_id = ee.athlete_id AND pr.discipline = ? AND pr.distance_meters = ? AND pr.mark_type = 'time_ms'
       LEFT JOIN season_bests sb
         ON sb.athlete_id = ee.athlete_id AND sb.season_id = ? AND sb.discipline = ? AND sb.distance_meters = ?
            AND sb.mark_type = 'time_ms'
       WHERE ee.event_id = ?
       ORDER BY a.last_name, a.first_name`,
    )
    .all(
      event.discipline,
      event.distanceMeters,
      event.seasonId,
      event.discipline,
      event.distanceMeters,
      eventId,
    ) as {
    entryId: string;
    athleteId: string;
    firstName: string;
    lastName: string;
    gender: string;
    gradeLevel: string;
    bib: string | null;
    targetTimeMs: number | null;
    performanceId: string | null;
    performanceStatus: string | null;
    personalRecordMs: number | null;
    previousPersonalRecordMs: number | null;
    personalRecordPerformanceId: string | null;
    seasonBestMs: number | null;
  }[];

  const observations = ctx.db
    .prepare(
      `SELECT o.id, o.performance_id AS performanceId, o.timing_point_id AS timingPointId,
              tp.name AS timingPointName, tp.distance_meters AS distanceMeters, tp.sort_order AS sortOrder,
              tp.is_finish AS isFinish, o.observed_at AS observedAt, o.role, o.conflicts_with_id AS conflictsWithId,
              o.recorded_by_user_id AS recordedByUserId
       FROM timing_observations o
       JOIN timing_points tp ON tp.id = o.timing_point_id
       WHERE o.event_id = ?`,
    )
    .all(eventId) as {
    id: string;
    performanceId: string;
    timingPointId: string;
    timingPointName: string;
    distanceMeters: number;
    sortOrder: number;
    isFinish: number;
    observedAt: number;
    role: SplitObservation["role"];
    conflictsWithId: string | null;
    recordedByUserId: string;
  }[];

  const byPerformance = new Map<string, SplitObservation[]>();
  for (const obs of observations) {
    const list = byPerformance.get(obs.performanceId) ?? [];
    list.push({
      id: obs.id,
      timingPointId: obs.timingPointId,
      timingPointName: obs.timingPointName,
      distanceMeters: obs.distanceMeters,
      sortOrder: obs.sortOrder,
      isFinish: Boolean(obs.isFinish),
      observedAt: obs.observedAt,
      recordedByUserId: obs.recordedByUserId,
      role: obs.role,
      conflictsWithId: obs.conflictsWithId,
    });
    byPerformance.set(obs.performanceId, list);
  }

  const athletes = entries.map((entry) => {
    const obs = entry.performanceId ? (byPerformance.get(entry.performanceId) ?? []) : [];
    const summary = summarizeRunningPerformance({
      startedAt: event.startedAt,
      totalDistanceMeters: event.distanceMeters ?? 0,
      targetTimeMs: entry.targetTimeMs,
      personalRecordMs: entry.personalRecordMs,
      seasonBestMs: entry.seasonBestMs,
      observations: obs,
    });
    const isNewPersonalRecord = Boolean(
      summary.finished && entry.performanceId && entry.performanceId === entry.personalRecordPerformanceId,
    );
    const prImprovementMs =
      isNewPersonalRecord && entry.previousPersonalRecordMs != null && entry.personalRecordMs != null
        ? entry.previousPersonalRecordMs - entry.personalRecordMs
        : null;
    return {
      entryId: entry.entryId,
      performanceId: entry.performanceId,
      athleteId: entry.athleteId,
      firstName: entry.firstName,
      lastName: entry.lastName,
      gender: entry.gender,
      gradeLevel: entry.gradeLevel,
      bib: entry.bib,
      targetTimeMs: entry.targetTimeMs,
      personalRecordMs: entry.personalRecordMs,
      previousPersonalRecordMs: entry.previousPersonalRecordMs,
      prImprovementMs,
      isNewPersonalRecord,
      seasonBestMs: entry.seasonBestMs,
      status: entry.performanceStatus ?? "pending",
      summary: {
        elapsedMs: summary.elapsedMs,
        finished: summary.finished,
        projectedFinishMs: summary.projectedFinishMs,
        vsTargetMs: summary.vsTargetMs,
        onPersonalRecordPace: summary.onPersonalRecordPace,
        onSeasonBestPace: summary.onSeasonBestPace,
        splits: summary.splits.map((s) => ({
          observationId: s.observationId,
          timingPointId: s.timingPointId,
          timingPointName: s.timingPointName,
          distanceMeters: s.distanceMeters,
          observedAt: s.observedAt,
          elapsedMs: s.elapsedMs,
          splitMs: s.splitMs,
          paceSecPerMile: s.paceSecPerMile,
          vsTargetMs: s.vsTargetMs,
          role: s.role,
          recordedByUserId: s.recordedByUserId,
          conflictsWithId: s.conflictsWithId,
        })),
        conflicts: summary.conflicts.map((s) => ({
          observationId: s.observationId,
          timingPointId: s.timingPointId,
          timingPointName: s.timingPointName,
          elapsedMs: s.elapsedMs,
          recordedByUserId: s.recordedByUserId,
          conflictsWithId: s.conflictsWithId,
        })),
      },
    };
  });

  return {
    seq: nextSeq(ctx, eventId),
    event,
    timingPoints,
    athletes,
  };
}
