import type { AppContext } from "../appContext.ts";
import { newId } from "../db/index.ts";
import { isDiscipline } from "../domain/roles.ts";
import { badRequest, notFound } from "../http/errors.ts";
import { requireMembership } from "./access.ts";

function requireAthleteTeam(ctx: AppContext, userId: string, athleteId: string) {
  const athlete = ctx.db
    .prepare(`SELECT team_id AS teamId FROM athletes WHERE id = ?`)
    .get(athleteId) as { teamId: string } | undefined;
  if (!athlete) throw notFound("Athlete not found");
  requireMembership(ctx, userId, athlete.teamId, "coach");
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
       JOIN athletes a ON a.id = pr.athlete_id
       WHERE a.team_id = ? AND pr.mark_type = 'time_ms'
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
      `SELECT id FROM personal_records
       WHERE athlete_id = ? AND discipline = ? AND distance_meters = ? AND mark_type = 'time_ms'`,
    )
    .get(athleteId, discipline, input.distanceMeters) as { id: string } | undefined;
  const now = ctx.clock.now();
  if (existing) {
    ctx.db
      .prepare(
        `UPDATE personal_records
         SET mark_value = ?, source = 'manual', performance_id = NULL, recorded_at = ?
         WHERE id = ?`,
      )
      .run(input.markValueMs, now, existing.id);
  } else {
    ctx.db
      .prepare(
        `INSERT INTO personal_records
           (id, athlete_id, discipline, distance_meters, mark_type, mark_value, performance_id, source, recorded_at)
         VALUES (?, ?, ?, ?, 'time_ms', ?, NULL, 'manual', ?)`,
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
    const season = ctx.db
      .prepare(
        `SELECT s.id FROM seasons s JOIN athletes a ON a.team_id = s.team_id WHERE a.id = ? ORDER BY s.created_at DESC LIMIT 1`,
      )
      .get(athleteId) as { id: string } | undefined;
    if (season) {
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

export function recomputeTimeRecords(
  ctx: AppContext,
  args: {
    athleteId: string;
    seasonId: string;
    discipline: string;
    distanceMeters: number;
  },
): void {
  const finished = ctx.db
    .prepare(
      `SELECT p.id, p.elapsed_ms, p.finished_at, e.discipline, e.distance_meters, m.season_id
       FROM performances p
       JOIN events e ON e.id = p.event_id
       JOIN meets m ON m.id = e.meet_id
       WHERE p.athlete_id = ?
         AND p.status = 'finished'
         AND p.elapsed_ms IS NOT NULL
         AND e.discipline = ?
         AND e.distance_meters = ?`,
    )
    .all(args.athleteId, args.discipline, args.distanceMeters) as {
    id: string;
    elapsed_ms: number;
    finished_at: number | null;
    season_id: string;
  }[];

  const bestOverall = finished.reduce<(typeof finished)[0] | null>((best, row) => {
    if (!best || row.elapsed_ms < best.elapsed_ms) return row;
    return best;
  }, null);

  const existing = ctx.db
    .prepare(
      `SELECT id, mark_value, source FROM personal_records
       WHERE athlete_id = ? AND discipline = ? AND distance_meters = ? AND mark_type = 'time_ms'`,
    )
    .get(args.athleteId, args.discipline, args.distanceMeters) as
    | { id: string; mark_value: number; source: string }
    | undefined;

  if (bestOverall && (!existing || bestOverall.elapsed_ms < existing.mark_value)) {
    ctx.db
      .prepare(
        `DELETE FROM personal_records
         WHERE athlete_id = ? AND discipline = ? AND distance_meters = ? AND mark_type = 'time_ms'`,
      )
      .run(args.athleteId, args.discipline, args.distanceMeters);
    ctx.db
      .prepare(
        `INSERT INTO personal_records
           (id, athlete_id, discipline, distance_meters, mark_type, mark_value, performance_id, source, recorded_at)
         VALUES (?, ?, ?, ?, 'time_ms', ?, ?, 'performance', ?)`,
      )
      .run(
        newId(),
        args.athleteId,
        args.discipline,
        args.distanceMeters,
        bestOverall.elapsed_ms,
        bestOverall.id,
        bestOverall.finished_at ?? ctx.clock.now(),
      );
  } else if (!bestOverall && existing && existing.source !== "manual") {
    ctx.db
      .prepare(
        `DELETE FROM personal_records
         WHERE athlete_id = ? AND discipline = ? AND distance_meters = ? AND mark_type = 'time_ms'`,
      )
      .run(args.athleteId, args.discipline, args.distanceMeters);
  }

  const seasonRows = finished.filter((r) => r.season_id === args.seasonId);
  const bestSeason = seasonRows.reduce<(typeof finished)[0] | null>((best, row) => {
    if (!best || row.elapsed_ms < best.elapsed_ms) return row;
    return best;
  }, null);

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
