import type { AppContext } from "../appContext.ts";
import { newId } from "../db/index.ts";

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

  ctx.db
    .prepare(
      `DELETE FROM personal_records
       WHERE athlete_id = ? AND discipline = ? AND distance_meters = ? AND mark_type = 'time_ms'`,
    )
    .run(args.athleteId, args.discipline, args.distanceMeters);

  if (bestOverall) {
    ctx.db
      .prepare(
        `INSERT INTO personal_records
           (id, athlete_id, discipline, distance_meters, mark_type, mark_value, performance_id, recorded_at)
         VALUES (?, ?, ?, ?, 'time_ms', ?, ?, ?)`,
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
