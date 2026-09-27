import { isSchoolYearName, schoolYearFor, schoolYearForDate, type SchoolYear } from "../domain/seasons.ts";
import type { Db } from "./index.ts";

type LegacySeason = {
  id: string;
  teamId: string;
  name: string;
  createdAt: number;
};

type SeasonBestMove = {
  id: string;
  athleteId: string;
  discipline: string;
  distanceMeters: number | null;
  markType: string;
  markValue: number;
  meetSeasonId: string;
};

export function migrateSchoolYearSeasons(db: Db): void {
  const legacy = db
    .prepare(
      `SELECT id, team_id AS teamId, name, created_at AS createdAt
       FROM seasons`,
    )
    .all() as LegacySeason[];
  const pending = legacy.filter((season) => !isSchoolYearName(season.name));
  if (pending.length > 0) {
    const migrate = db.transaction(() => {
      for (const season of pending) {
        rehomeLegacySeason(db, season);
      }
      rehomeSeasonBests(db);
      db.prepare(
        `DELETE FROM seasons
         WHERE name NOT GLOB '??/??'
           AND id NOT IN (SELECT season_id FROM meets)
           AND id NOT IN (SELECT season_id FROM season_bests)`,
      ).run();
    });
    migrate();
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_seasons_team_name ON seasons(team_id, name)`);
}

function rehomeLegacySeason(db: Db, season: LegacySeason): void {
  const meets = db
    .prepare(`SELECT id, starts_on AS startsOn FROM meets WHERE season_id = ?`)
    .all(season.id) as { id: string; startsOn: string }[];
  if (meets.length === 0) {
    const destination = placeSeason(db, season, schoolYearFor(season.createdAt));
    if (destination !== season.id) {
      db.prepare(`DELETE FROM seasons WHERE id = ?`).run(season.id);
    }
    return;
  }

  const groups = new Map<string, { year: SchoolYear; meetIds: string[] }>();
  for (const meet of meets) {
    const year = /^\d{4}-\d{2}-\d{2}$/.test(meet.startsOn)
      ? schoolYearForDate(meet.startsOn)
      : schoolYearFor(season.createdAt);
    const group = groups.get(year.name) ?? { year, meetIds: [] };
    group.meetIds.push(meet.id);
    groups.set(year.name, group);
  }

  let reuseRow = true;
  for (const group of groups.values()) {
    if (reuseRow) {
      const destination = placeSeason(db, season, group.year);
      if (destination !== season.id) {
        moveMeets(db, group.meetIds, destination);
      }
      reuseRow = false;
      continue;
    }
    const destination = insertSeason(db, season.teamId, group.year, season.createdAt);
    moveMeets(db, group.meetIds, destination);
  }
}

function placeSeason(db: Db, season: LegacySeason, year: SchoolYear): string {
  const other = db
    .prepare(`SELECT id FROM seasons WHERE team_id = ? AND name = ? AND id != ?`)
    .get(season.teamId, year.name, season.id) as { id: string } | undefined;
  if (other) return other.id;
  db.prepare(`UPDATE seasons SET name = ?, starts_on = ?, ends_on = ? WHERE id = ?`).run(
    year.name,
    year.startsOn,
    year.endsOn,
    season.id,
  );
  return season.id;
}

function insertSeason(db: Db, teamId: string, year: SchoolYear, createdAt: number): string {
  const existing = db
    .prepare(`SELECT id FROM seasons WHERE team_id = ? AND name = ?`)
    .get(teamId, year.name) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO seasons (id, team_id, name, starts_on, ends_on, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, teamId, year.name, year.startsOn, year.endsOn, createdAt);
  return id;
}

function moveMeets(db: Db, meetIds: string[], seasonId: string): void {
  const update = db.prepare(`UPDATE meets SET season_id = ? WHERE id = ?`);
  for (const meetId of meetIds) update.run(seasonId, meetId);
}

function rehomeSeasonBests(db: Db): void {
  const moves = db
    .prepare(
      `SELECT sb.id, sb.athlete_id AS athleteId, sb.discipline,
              sb.distance_meters AS distanceMeters, sb.mark_type AS markType,
              sb.mark_value AS markValue, m.season_id AS meetSeasonId
       FROM season_bests sb
       JOIN performances p ON p.id = sb.performance_id
       JOIN events e ON e.id = p.event_id
       JOIN meets m ON m.id = e.meet_id
       WHERE sb.season_id != m.season_id`,
    )
    .all() as SeasonBestMove[];
  const update = db.prepare(`UPDATE season_bests SET season_id = ? WHERE id = ?`);
  const remove = db.prepare(`DELETE FROM season_bests WHERE id = ?`);
  const find = db.prepare(
    `SELECT id, mark_value AS markValue FROM season_bests
     WHERE athlete_id = ? AND season_id = ? AND discipline = ? AND distance_meters IS ? AND mark_type = ? AND id != ?`,
  );
  for (const row of moves) {
    const occupant = find.get(
      row.athleteId,
      row.meetSeasonId,
      row.discipline,
      row.distanceMeters,
      row.markType,
      row.id,
    ) as { id: string; markValue: number } | undefined;
    if (!occupant) {
      update.run(row.meetSeasonId, row.id);
      continue;
    }
    if (row.markValue < occupant.markValue) {
      remove.run(occupant.id);
      update.run(row.meetSeasonId, row.id);
    } else {
      remove.run(row.id);
    }
  }
}
