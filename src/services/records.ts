import type { AppContext } from "../appContext.ts";
import { newId } from "../db/index.ts";
import { isDiscipline } from "../domain/roles.ts";
import { badRequest, notFound } from "../http/errors.ts";
import { isPlatformAdmin, requireAthleteEditor, requireSchoolRead } from "./access.ts";
import { ensureCurrentSeason } from "./seasons.ts";

function requireAthleteTeam(ctx: AppContext, userId: string, athleteId: string) {
  requireAthleteEditor(ctx, userId, athleteId);
}

export type PersonalRecord = {
  id: string;
  discipline: string;
  distanceMeters: number | null;
  markType: string;
  markValueMs: number;
  source: string;
};

export function defaultDisciplineForDistance(distanceMeters: number): string {
  return distanceMeters >= 5000 ? "cross_country" : "track_running";
}

export function listSchoolRecords(ctx: AppContext, userId: string, schoolId: string) {
  requireSchoolRead(ctx, userId, schoolId);
  const manager =
    isPlatformAdmin(ctx, userId) ||
    Boolean(
      ctx.db
        .prepare(`SELECT 1 FROM school_memberships WHERE school_id = ? AND user_id = ?`)
        .get(schoolId, userId),
    );
  const memberTeams = new Set(
    (
      ctx.db
        .prepare(
          `SELECT m.team_id AS teamId FROM team_memberships m
           JOIN teams t ON t.id = m.team_id
           WHERE t.school_id = ? AND m.user_id = ?`,
        )
        .all(schoolId, userId) as { teamId: string }[]
    ).map((row) => row.teamId),
  );
  const rows = ctx.db
    .prepare(
      `SELECT sr.id, sr.gender, sr.discipline, sr.distance_meters AS distanceMeters,
              sr.mark_type AS markType, sr.mark_value AS markValueMs,
              sr.athlete_id AS athleteId, a.first_name AS firstName, a.last_name AS lastName,
              sr.performance_id AS performanceId, sr.team_id AS teamId, t.name AS teamName,
              m.name AS meetName, m.starts_on AS meetStartsOn, sr.recorded_at AS recordedAt,
              sr.previous_mark_value AS previousMarkValueMs
       FROM school_records sr
       JOIN athletes a ON a.id = sr.athlete_id
       JOIN teams t ON t.id = sr.team_id
       JOIN performances p ON p.id = sr.performance_id
       JOIN events e ON e.id = p.event_id
       JOIN meets m ON m.id = e.meet_id
       WHERE sr.school_id = ?
       ORDER BY sr.gender, sr.distance_meters, sr.discipline, sr.mark_value`,
    )
    .all(schoolId) as {
    id: string;
    gender: string;
    discipline: string;
    distanceMeters: number;
    markType: string;
    markValueMs: number;
    athleteId: string;
    firstName: string;
    lastName: string;
    performanceId: string;
    teamId: string;
    teamName: string;
    meetName: string;
    meetStartsOn: string;
    recordedAt: number;
    previousMarkValueMs: number | null;
  }[];
  return rows.map((row) => {
    const full = manager || memberTeams.has(row.teamId);
    const base = {
      id: row.id,
      gender: row.gender,
      discipline: row.discipline,
      distanceMeters: row.distanceMeters,
      markType: row.markType,
      markValueMs: row.markValueMs,
      athleteId: row.athleteId,
      firstName: row.firstName,
      lastName: row.lastName,
      recordedAt: row.recordedAt,
      previousMarkValueMs: row.previousMarkValueMs,
    };
    if (!full) return base;
    return {
      ...base,
      performanceId: row.performanceId,
      teamId: row.teamId,
      teamName: row.teamName,
      meetName: row.meetName,
      meetStartsOn: row.meetStartsOn,
    };
  });
}

export function listRecordsForAthlete(ctx: AppContext, athleteId: string): PersonalRecord[] {
  return ctx.db
    .prepare(
      `SELECT id, discipline, distance_meters AS distanceMeters, mark_type AS markType,
              mark_value AS markValueMs, source
       FROM personal_records
       WHERE athlete_id = ? AND mark_type = 'time_ms'
       ORDER BY distance_meters, discipline`,
    )
    .all(athleteId) as PersonalRecord[];
}

export function listRecordsForTeam(ctx: AppContext, teamId: string): Map<string, PersonalRecord[]> {
  const rows = ctx.db
    .prepare(
      `SELECT pr.id, pr.athlete_id AS athleteId, pr.discipline, pr.distance_meters AS distanceMeters,
              pr.mark_type AS markType, pr.mark_value AS markValueMs, pr.source
       FROM personal_records pr
       JOIN athlete_team_assignments ata ON ata.athlete_id = pr.athlete_id
       WHERE ata.team_id = ? AND pr.mark_type = 'time_ms'
       ORDER BY pr.distance_meters, pr.discipline`,
    )
    .all(teamId) as (PersonalRecord & { athleteId: string })[];
  const byAthlete = new Map<string, PersonalRecord[]>();
  for (const row of rows) {
    const list = byAthlete.get(row.athleteId) ?? [];
    list.push({
      id: row.id,
      discipline: row.discipline,
      distanceMeters: row.distanceMeters,
      markType: row.markType,
      markValueMs: row.markValueMs,
      source: row.source,
    });
    byAthlete.set(row.athleteId, list);
  }
  return byAthlete;
}

export function upsertManualRecord(
  ctx: AppContext,
  userId: string,
  athleteId: string,
  input: { distanceMeters: number; markValueMs: number; discipline?: string },
) {
  requireAthleteTeam(ctx, userId, athleteId);
  if (!Number.isInteger(input.distanceMeters) || input.distanceMeters <= 0) {
    throw badRequest("distanceMeters must be a positive integer");
  }
  if (!Number.isInteger(input.markValueMs) || input.markValueMs <= 0) {
    throw badRequest("A valid time is required");
  }
  const discipline = input.discipline ?? defaultDisciplineForDistance(input.distanceMeters);
  if (!isDiscipline(discipline)) throw badRequest("Unknown discipline");

  const existing = ctx.db
    .prepare(
      `SELECT id, mark_value AS markValue FROM personal_records
       WHERE athlete_id = ? AND discipline = ? AND distance_meters = ? AND mark_type = 'time_ms'`,
    )
    .get(athleteId, discipline, input.distanceMeters) as { id: string; markValue: number } | undefined;
  const now = ctx.clock.now();
  if (existing) {
    ctx.db
      .prepare(
        `UPDATE personal_records
         SET mark_value = ?, source = 'manual', performance_id = NULL, previous_mark_value = ?, recorded_at = ?
         WHERE id = ?`,
      )
      .run(input.markValueMs, existing.markValue, now, existing.id);
  } else {
    ctx.db
      .prepare(
        `INSERT INTO personal_records
           (id, athlete_id, discipline, distance_meters, mark_type, mark_value, performance_id, source, previous_mark_value, recorded_at)
         VALUES (?, ?, ?, ?, 'time_ms', ?, NULL, 'manual', NULL, ?)`,
      )
      .run(newId(), athleteId, discipline, input.distanceMeters, input.markValueMs, now);
  }
  return listRecordsForAthlete(ctx, athleteId);
}

export function deleteManualRecord(ctx: AppContext, userId: string, athleteId: string, recordId: string) {
  requireAthleteTeam(ctx, userId, athleteId);
  const existing = ctx.db
    .prepare(
      `SELECT discipline, distance_meters AS distanceMeters FROM personal_records WHERE id = ? AND athlete_id = ?`,
    )
    .get(recordId, athleteId) as { discipline: string; distanceMeters: number | null } | undefined;
  const result = ctx.db
    .prepare(`DELETE FROM personal_records WHERE id = ? AND athlete_id = ?`)
    .run(recordId, athleteId);
  if (result.changes === 0) throw notFound("Record not found");
  if (existing?.distanceMeters != null) {
    recomputeTimeRecords(ctx, {
      athleteId,
      seasonId: null,
      discipline: existing.discipline,
      distanceMeters: existing.distanceMeters,
    });
    const teams = ctx.db
      .prepare(`SELECT team_id AS teamId FROM athlete_team_assignments WHERE athlete_id = ?`)
      .all(athleteId) as { teamId: string }[];
    for (const team of teams) {
      const season = ensureCurrentSeason(ctx, team.teamId);
      recomputeTimeRecords(ctx, {
        athleteId,
        seasonId: season.id,
        discipline: existing.discipline,
        distanceMeters: existing.distanceMeters,
      });
    }
  }
  return listRecordsForAthlete(ctx, athleteId);
}

type MarkRow = {
  id: string;
  mark_value: number;
  performance_id: string | null;
  previous_mark_value: number | null;
  source?: string;
};

type FinishWinner = { id: string; elapsed_ms: number; finished_at: number | null };

function nextPreviousMark(existing: MarkRow | undefined, winner: FinishWinner | null): number | null {
  if (!existing || !winner) return null;
  if (winner.id === existing.performance_id) return existing.previous_mark_value;
  if (winner.elapsed_ms < existing.mark_value) return existing.mark_value;
  return null;
}

const FINISH_ORDER = `ORDER BY p.elapsed_ms ASC, COALESCE(p.finished_at, p.created_at) ASC, p.id ASC LIMIT 1`;

export function recomputeTimeRecords(
  ctx: AppContext,
  args: {
    athleteId: string;
    seasonId: string | null;
    discipline: string;
    distanceMeters: number;
  },
): void {
  const bestOverall = ctx.db
    .prepare(
      `SELECT p.id, p.elapsed_ms, p.finished_at
       FROM performances p
       JOIN events e ON e.id = p.event_id
       WHERE p.athlete_id = ?
         AND p.status = 'finished'
         AND p.elapsed_ms IS NOT NULL
         AND e.discipline = ?
         AND e.distance_meters = ?
       ${FINISH_ORDER}`,
    )
    .get(args.athleteId, args.discipline, args.distanceMeters) as FinishWinner | undefined;

  const existing = ctx.db
    .prepare(
      `SELECT id, mark_value, source, performance_id, previous_mark_value FROM personal_records
       WHERE athlete_id = ? AND discipline = ? AND distance_meters = ? AND mark_type = 'time_ms'`,
    )
    .get(args.athleteId, args.discipline, args.distanceMeters) as (MarkRow & { source: string }) | undefined;

  const winner = bestOverall ?? null;
  if (existing?.source === "manual") {
    if (winner && winner.elapsed_ms < existing.mark_value) {
      replacePersonalRecord(ctx, args, existing, winner);
    }
  } else if (winner) {
    replacePersonalRecord(ctx, args, existing, winner);
  } else if (existing) {
    ctx.db
      .prepare(
        `DELETE FROM personal_records
         WHERE athlete_id = ? AND discipline = ? AND distance_meters = ? AND mark_type = 'time_ms'`,
      )
      .run(args.athleteId, args.discipline, args.distanceMeters);
  }

  if (args.seasonId == null) return;

  const bestSeason = ctx.db
    .prepare(
      `SELECT p.id, p.elapsed_ms, p.finished_at
       FROM performances p
       JOIN events e ON e.id = p.event_id
       JOIN meets m ON m.id = e.meet_id
       WHERE p.athlete_id = ?
         AND p.status = 'finished'
         AND p.elapsed_ms IS NOT NULL
         AND e.discipline = ?
         AND e.distance_meters = ?
         AND m.season_id = ?
       ${FINISH_ORDER}`,
    )
    .get(args.athleteId, args.discipline, args.distanceMeters, args.seasonId) as FinishWinner | undefined;

  ctx.db
    .prepare(
      `DELETE FROM season_bests
       WHERE athlete_id = ? AND season_id = ? AND discipline = ? AND distance_meters = ? AND mark_type = 'time_ms'`,
    )
    .run(args.athleteId, args.seasonId, args.discipline, args.distanceMeters);

  if (bestSeason) {
    ctx.db
      .prepare(
        `INSERT INTO season_bests
           (id, athlete_id, season_id, discipline, distance_meters, mark_type, mark_value, performance_id, recorded_at)
         VALUES (?, ?, ?, ?, ?, 'time_ms', ?, ?, ?)`,
      )
      .run(
        newId(),
        args.athleteId,
        args.seasonId,
        args.discipline,
        args.distanceMeters,
        bestSeason.elapsed_ms,
        bestSeason.id,
        bestSeason.finished_at ?? ctx.clock.now(),
      );
  }
}

function replacePersonalRecord(
  ctx: AppContext,
  args: { athleteId: string; discipline: string; distanceMeters: number },
  existing: MarkRow | undefined,
  winner: FinishWinner,
): void {
  const previous = nextPreviousMark(existing, winner);
  ctx.db
    .prepare(
      `DELETE FROM personal_records
       WHERE athlete_id = ? AND discipline = ? AND distance_meters = ? AND mark_type = 'time_ms'`,
    )
    .run(args.athleteId, args.discipline, args.distanceMeters);
  ctx.db
    .prepare(
      `INSERT INTO personal_records
         (id, athlete_id, discipline, distance_meters, mark_type, mark_value, performance_id, source, previous_mark_value, recorded_at)
       VALUES (?, ?, ?, ?, 'time_ms', ?, ?, 'performance', ?, ?)`,
    )
    .run(
      newId(),
      args.athleteId,
      args.discipline,
      args.distanceMeters,
      winner.elapsed_ms,
      winner.id,
      previous,
      winner.finished_at ?? ctx.clock.now(),
    );
}

export function recomputeSchoolRecord(
  ctx: AppContext,
  args: { schoolId: string; gender: string; discipline: string; distanceMeters: number },
): void {
  const winner = ctx.db
    .prepare(
      `SELECT p.id AS performanceId, p.athlete_id AS athleteId, p.elapsed_ms AS elapsedMs,
              p.finished_at AS finishedAt, m.team_id AS teamId
       FROM performances p
       JOIN athletes a ON a.id = p.athlete_id
       JOIN events e ON e.id = p.event_id
       JOIN meets m ON m.id = e.meet_id
       JOIN teams t ON t.id = m.team_id
       WHERE a.school_id = ?
         AND a.gender = ?
         AND e.discipline = ?
         AND e.distance_meters = ?
         AND p.status = 'finished'
         AND p.elapsed_ms IS NOT NULL
         AND t.school_id = a.school_id
       ORDER BY p.elapsed_ms ASC, COALESCE(p.finished_at, p.created_at) ASC, p.id ASC
       LIMIT 1`,
    )
    .get(args.schoolId, args.gender, args.discipline, args.distanceMeters) as
    | {
        performanceId: string;
        athleteId: string;
        elapsedMs: number;
        finishedAt: number | null;
        teamId: string;
      }
    | undefined;

  const existing = ctx.db
    .prepare(
      `SELECT id, mark_value, performance_id, previous_mark_value FROM school_records
       WHERE school_id = ? AND gender = ? AND discipline = ? AND distance_meters = ? AND mark_type = 'time_ms'`,
    )
    .get(args.schoolId, args.gender, args.discipline, args.distanceMeters) as MarkRow | undefined;

  ctx.db
    .prepare(
      `DELETE FROM school_records
       WHERE school_id = ? AND gender = ? AND discipline = ? AND distance_meters = ? AND mark_type = 'time_ms'`,
    )
    .run(args.schoolId, args.gender, args.discipline, args.distanceMeters);

  if (!winner) return;
  ctx.db
    .prepare(
      `INSERT INTO school_records
         (id, school_id, gender, discipline, distance_meters, mark_type, mark_value, athlete_id, performance_id, team_id, recorded_at, previous_mark_value)
       VALUES (?, ?, ?, ?, ?, 'time_ms', ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      newId(),
      args.schoolId,
      args.gender,
      args.discipline,
      args.distanceMeters,
      winner.elapsedMs,
      winner.athleteId,
      winner.performanceId,
      winner.teamId,
      winner.finishedAt ?? ctx.clock.now(),
      nextPreviousMark(existing, { id: winner.performanceId, elapsed_ms: winner.elapsedMs, finished_at: winner.finishedAt }),
    );
}

export function recomputeFinishMarks(
  ctx: AppContext,
  args: { athleteId: string; seasonId: string | null; discipline: string; distanceMeters: number },
): void {
  recomputeTimeRecords(ctx, args);
  const athlete = ctx.db
    .prepare(`SELECT school_id AS schoolId, gender FROM athletes WHERE id = ?`)
    .get(args.athleteId) as { schoolId: string; gender: string } | undefined;
  if (!athlete) return;
  recomputeSchoolRecord(ctx, {
    schoolId: athlete.schoolId,
    gender: athlete.gender,
    discipline: args.discipline,
    distanceMeters: args.distanceMeters,
  });
}
