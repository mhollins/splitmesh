import type { Db } from "../db/index.ts";

function placeholders(ids: string[]): string {
  return ids.map(() => "?").join(", ");
}

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
      .prepare(
        `SELECT e.id FROM events e JOIN meets m ON m.id = e.meet_id WHERE m.team_id = ?`,
      )
      .all(teamId) as { id: string }[]
  ).map((row) => row.id);
}

export function deleteEvents(db: Db, eventIds: string[]): void {
  if (!eventIds.length) return;
  const list = placeholders(eventIds);
  db.prepare(`UPDATE timing_observations SET conflicts_with_id = NULL WHERE event_id IN (${list})`).run(
    ...eventIds,
  );
  db.prepare(`DELETE FROM timing_observations WHERE event_id IN (${list})`).run(...eventIds);
  db.prepare(`DELETE FROM event_log WHERE event_id IN (${list})`).run(...eventIds);
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

export function deleteAthleteGraph(db: Db, athleteId: string): void {
  db.prepare(`UPDATE timing_observations SET conflicts_with_id = NULL WHERE athlete_id = ?`).run(athleteId);
  db.prepare(`DELETE FROM timing_observations WHERE athlete_id = ?`).run(athleteId);
  db.prepare(`DELETE FROM personal_records WHERE athlete_id = ?`).run(athleteId);
  db.prepare(`DELETE FROM season_bests WHERE athlete_id = ?`).run(athleteId);
  db.prepare(`DELETE FROM performances WHERE athlete_id = ?`).run(athleteId);
  db.prepare(`DELETE FROM event_entries WHERE athlete_id = ?`).run(athleteId);
  db.prepare(`DELETE FROM athletes WHERE id = ?`).run(athleteId);
}

export function deleteMeetGraph(db: Db, meetId: string): void {
  deleteEvents(db, eventIdsForMeets(db, [meetId]));
  db.prepare(`DELETE FROM meets WHERE id = ?`).run(meetId);
}

export function deleteTeamGraph(db: Db, teamId: string): void {
  deleteEvents(db, eventIdsForTeam(db, teamId));
  db.prepare(`DELETE FROM meets WHERE team_id = ?`).run(teamId);
  db.prepare(`DELETE FROM athletes WHERE team_id = ?`).run(teamId);
  db.prepare(`DELETE FROM seasons WHERE team_id = ?`).run(teamId);
  db.prepare(`DELETE FROM team_memberships WHERE team_id = ?`).run(teamId);
  db.prepare(`DELETE FROM teams WHERE id = ?`).run(teamId);
}
