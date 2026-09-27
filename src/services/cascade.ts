import type { AppContext } from "../appContext.ts";
import type { Db } from "../db/index.ts";
import { recomputeSchoolRecord, recomputeTimeRecords } from "./records.ts";

function placeholders(ids: string[]): string {
  return ids.map(() => "?").join(", ");
}

type AthleteKey = { athleteId: string; discipline: string; distanceMeters: number };
type SchoolKey = { schoolId: string; gender: string; discipline: string; distanceMeters: number };

export function eventIdsForMeets(db: Db, meetIds: string[]): string[] {
  if (!meetIds.length) return [];
  return (
    db
      .prepare(`SELECT id FROM events WHERE meet_id IN (${placeholders(meetIds)})`)
      .all(...meetIds) as { id: string }[]
  ).map((row) => row.id);
}

export function eventIdsForTeam(db: Db, teamId: string): string[] {
  return (
    db
      .prepare(`SELECT e.id FROM events e JOIN meets m ON m.id = e.meet_id WHERE m.team_id = ?`)
      .all(teamId) as { id: string }[]
  ).map((row) => row.id);
}

function collectMarkKeys(db: Db, eventIds: string[]): { athletes: AthleteKey[]; schools: SchoolKey[] } {
  if (!eventIds.length) return { athletes: [], schools: [] };
  const rows = db
    .prepare(
      `SELECT DISTINCT p.athlete_id AS athleteId, e.discipline, e.distance_meters AS distanceMeters,
              a.school_id AS schoolId, a.gender
       FROM performances p
       JOIN events e ON e.id = p.event_id
       JOIN athletes a ON a.id = p.athlete_id
       WHERE p.event_id IN (${placeholders(eventIds)})
         AND p.status = 'finished'
         AND p.elapsed_ms IS NOT NULL
         AND e.distance_meters IS NOT NULL`,
    )
    .all(...eventIds) as (AthleteKey & SchoolKey)[];
  const athletes: AthleteKey[] = [];
  const schools: SchoolKey[] = [];
  const seenAthletes = new Set<string>();
  const seenSchools = new Set<string>();
  for (const row of rows) {
    const athleteKey = `${row.athleteId}|${row.discipline}|${row.distanceMeters}`;
    if (!seenAthletes.has(athleteKey)) {
      seenAthletes.add(athleteKey);
      athletes.push({ athleteId: row.athleteId, discipline: row.discipline, distanceMeters: row.distanceMeters });
    }
    const schoolKey = `${row.schoolId}|${row.gender}|${row.discipline}|${row.distanceMeters}`;
    if (!seenSchools.has(schoolKey)) {
      seenSchools.add(schoolKey);
      schools.push({
        schoolId: row.schoolId,
        gender: row.gender,
        discipline: row.discipline,
        distanceMeters: row.distanceMeters,
      });
    }
  }
  return { athletes, schools };
}

export function deleteEvents(db: Db, eventIds: string[]): void {
  if (!eventIds.length) return;
  const list = placeholders(eventIds);
  db.prepare(`UPDATE timing_observations SET conflicts_with_id = NULL WHERE event_id IN (${list})`).run(...eventIds);
  db.prepare(`DELETE FROM timing_observations WHERE event_id IN (${list})`).run(...eventIds);
  db.prepare(`DELETE FROM event_log WHERE event_id IN (${list})`).run(...eventIds);
  db.prepare(
    `DELETE FROM school_records WHERE performance_id IN (SELECT id FROM performances WHERE event_id IN (${list}))`,
  ).run(...eventIds);
  db.prepare(
    `DELETE FROM personal_records WHERE performance_id IN (SELECT id FROM performances WHERE event_id IN (${list}))`,
  ).run(...eventIds);
  db.prepare(
    `DELETE FROM season_bests WHERE performance_id IN (SELECT id FROM performances WHERE event_id IN (${list}))`,
  ).run(...eventIds);
  db.prepare(`DELETE FROM performances WHERE event_id IN (${list})`).run(...eventIds);
  db.prepare(`DELETE FROM event_entries WHERE event_id IN (${list})`).run(...eventIds);
  db.prepare(`DELETE FROM timing_points WHERE event_id IN (${list})`).run(...eventIds);
  db.prepare(`DELETE FROM events WHERE id IN (${list})`).run(...eventIds);
}

export function deleteEventsAndRecompute(ctx: AppContext, eventIds: string[], seasonId: string | null): void {
  if (!eventIds.length) return;
  const keys = collectMarkKeys(ctx.db, eventIds);
  deleteEvents(ctx.db, eventIds);
  for (const key of keys.athletes) {
    recomputeTimeRecords(ctx, { ...key, seasonId });
  }
  for (const key of keys.schools) recomputeSchoolRecord(ctx, key);
}

export function clearEventTiming(db: Db, eventId: string): void {
  db.prepare(`UPDATE timing_observations SET conflicts_with_id = NULL WHERE event_id = ?`).run(eventId);
  db.prepare(`DELETE FROM timing_observations WHERE event_id = ?`).run(eventId);
  db.prepare(`DELETE FROM event_log WHERE event_id = ?`).run(eventId);
  db.prepare(
    `DELETE FROM school_records WHERE performance_id IN (SELECT id FROM performances WHERE event_id = ?)`,
  ).run(eventId);
  db.prepare(
    `DELETE FROM personal_records WHERE performance_id IN (SELECT id FROM performances WHERE event_id = ?)`,
  ).run(eventId);
  db.prepare(
    `DELETE FROM season_bests WHERE performance_id IN (SELECT id FROM performances WHERE event_id = ?)`,
  ).run(eventId);
  db.prepare(`DELETE FROM performances WHERE event_id = ?`).run(eventId);
}

export function clearEventTimingAndRecompute(ctx: AppContext, eventId: string, seasonId: string): void {
  const keys = collectMarkKeys(ctx.db, [eventId]);
  clearEventTiming(ctx.db, eventId);
  for (const key of keys.athletes) recomputeTimeRecords(ctx, { ...key, seasonId });
  for (const key of keys.schools) recomputeSchoolRecord(ctx, key);
}

export function deleteAthleteGraph(ctx: AppContext, athleteId: string): void {
  const keys = ctx.db
    .prepare(
      `SELECT DISTINCT a.school_id AS schoolId, a.gender, e.discipline, e.distance_meters AS distanceMeters
       FROM performances p
       JOIN athletes a ON a.id = p.athlete_id
       JOIN events e ON e.id = p.event_id
       WHERE p.athlete_id = ?
         AND p.status = 'finished'
         AND p.elapsed_ms IS NOT NULL
         AND e.distance_meters IS NOT NULL`,
    )
    .all(athleteId) as SchoolKey[];
  const db = ctx.db;
  db.prepare(`UPDATE timing_observations SET conflicts_with_id = NULL WHERE athlete_id = ?`).run(athleteId);
  db.prepare(`DELETE FROM timing_observations WHERE athlete_id = ?`).run(athleteId);
  db.prepare(
    `DELETE FROM school_records
     WHERE athlete_id = ? OR performance_id IN (SELECT id FROM performances WHERE athlete_id = ?)`,
  ).run(athleteId, athleteId);
  db.prepare(`DELETE FROM personal_records WHERE athlete_id = ?`).run(athleteId);
  db.prepare(`DELETE FROM season_bests WHERE athlete_id = ?`).run(athleteId);
  db.prepare(`DELETE FROM performances WHERE athlete_id = ?`).run(athleteId);
  db.prepare(`DELETE FROM event_entries WHERE athlete_id = ?`).run(athleteId);
  db.prepare(`DELETE FROM athlete_team_assignments WHERE athlete_id = ?`).run(athleteId);
  db.prepare(`DELETE FROM athletes WHERE id = ?`).run(athleteId);
  for (const key of keys) recomputeSchoolRecord(ctx, key);
}

export function deleteMeetGraph(ctx: AppContext, meetId: string): void {
  const meet = ctx.db.prepare(`SELECT season_id AS seasonId FROM meets WHERE id = ?`).get(meetId) as
    | { seasonId: string }
    | undefined;
  deleteEventsAndRecompute(ctx, eventIdsForMeets(ctx.db, [meetId]), meet?.seasonId ?? null);
  ctx.db.prepare(`DELETE FROM meets WHERE id = ?`).run(meetId);
}

function deleteTeamEventTypes(db: Db, teamId: string): void {
  db.prepare(
    `DELETE FROM event_type_splits WHERE event_type_id IN (SELECT id FROM event_types WHERE team_id = ?)`,
  ).run(teamId);
  db.prepare(`DELETE FROM event_types WHERE team_id = ?`).run(teamId);
}

export function deleteTeamGraph(ctx: AppContext, teamId: string): void {
  const performances = ctx.db
    .prepare(
      `SELECT COUNT(*) AS n FROM performances p
       JOIN events e ON e.id = p.event_id
       JOIN meets m ON m.id = e.meet_id
       WHERE m.team_id = ?`,
    )
    .get(teamId) as { n: number };
  const eventIds = eventIdsForTeam(ctx.db, teamId);
  const keys = collectMarkKeys(ctx.db, eventIds);
  deleteEventsAndRecompute(ctx, eventIds, null);
  deleteTeamEventTypes(ctx.db, teamId);
  ctx.db.prepare(`DELETE FROM meets WHERE team_id = ?`).run(teamId);
  ctx.db.prepare(`DELETE FROM athlete_team_assignments WHERE team_id = ?`).run(teamId);
  ctx.db.prepare(`DELETE FROM seasons WHERE team_id = ?`).run(teamId);
  ctx.db.prepare(`DELETE FROM team_memberships WHERE team_id = ?`).run(teamId);
  ctx.db.prepare(`DELETE FROM school_records WHERE team_id = ?`).run(teamId);
  ctx.db.prepare(`DELETE FROM teams WHERE id = ?`).run(teamId);
  console.info(
    `deleted team=${teamId} performances=${performances.n} personalRecordKeys=${keys.athletes.length} schoolRecordKeys=${keys.schools.length}`,
  );
}

export function deleteSchoolGraph(ctx: AppContext, schoolId: string): void {
  const db = ctx.db;
  const performances = db
    .prepare(
      `SELECT COUNT(*) AS n FROM performances p
       JOIN events e ON e.id = p.event_id
       JOIN meets m ON m.id = e.meet_id
       JOIN teams t ON t.id = m.team_id
       WHERE t.school_id = ?`,
    )
    .get(schoolId) as { n: number };
  db.prepare(`DELETE FROM school_records WHERE school_id = ?`).run(schoolId);
  db.prepare(
    `DELETE FROM personal_records WHERE athlete_id IN (SELECT id FROM athletes WHERE school_id = ?)`,
  ).run(schoolId);
  db.prepare(
    `DELETE FROM season_bests WHERE athlete_id IN (SELECT id FROM athletes WHERE school_id = ?)`,
  ).run(schoolId);
  const teams = db.prepare(`SELECT id FROM teams WHERE school_id = ?`).all(schoolId) as { id: string }[];
  for (const team of teams) {
    deleteEvents(db, eventIdsForTeam(db, team.id));
    deleteTeamEventTypes(db, team.id);
    db.prepare(`DELETE FROM meets WHERE team_id = ?`).run(team.id);
    db.prepare(`DELETE FROM athlete_team_assignments WHERE team_id = ?`).run(team.id);
    db.prepare(`DELETE FROM seasons WHERE team_id = ?`).run(team.id);
    db.prepare(`DELETE FROM team_memberships WHERE team_id = ?`).run(team.id);
    db.prepare(`DELETE FROM teams WHERE id = ?`).run(team.id);
  }
  db.prepare(`DELETE FROM athletes WHERE school_id = ?`).run(schoolId);
  db.prepare(`DELETE FROM school_memberships WHERE school_id = ?`).run(schoolId);
  db.prepare(`DELETE FROM schools WHERE id = ?`).run(schoolId);
  console.info(`deleted school=${schoolId} performances=${performances.n} personalRecordKeys=0 schoolRecordKeys=0`);
}
