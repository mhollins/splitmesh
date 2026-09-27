import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { SCHEMA_SQL } from "../../src/db/schema.ts";
import { migrateSchoolYearSeasons } from "../../src/db/schoolYears.ts";

describe("school-year season migration", () => {
  it("splits a calendar-year season by meet date and keeps an empty season on the year it was created", () => {
    const db = new Database(":memory:");
    db.exec(SCHEMA_SQL);
    const created = Date.parse("2026-01-15T12:00:00Z");
    const fall = Date.parse("2026-09-12T15:00:00Z");
    db.prepare(
      `INSERT INTO users (id, email, password_hash, display_name, is_platform_admin, created_at)
       VALUES ('u1', 'a@test.local', 'x', 'A', 0, ?)`,
    ).run(created);
    db.prepare(
      `INSERT INTO schools (id, name, created_by_user_id, created_at)
       VALUES ('sch1', 'Lincoln', 'u1', ?), ('sch2', 'Riverside', 'u1', ?)`,
    ).run(created, fall);
    db.prepare(
      `INSERT INTO teams (id, school_id, name, invite_code, created_by_user_id, created_at)
       VALUES ('t1', 'sch1', 'Lincoln', 'INVITE1', 'u1', ?), ('t2', 'sch2', 'Riverside', 'INVITE2', 'u1', ?)`,
    ).run(created, fall);
    db.prepare(
      `INSERT INTO seasons (id, team_id, name, starts_on, ends_on, created_at)
       VALUES ('s1', 't1', '2026 Season', '2026-01-01', '2026-12-31', ?),
              ('s2', 't2', '2026 Season', '2026-01-01', '2026-12-31', ?)`,
    ).run(created, fall);
    db.prepare(
      `INSERT INTO meets (id, team_id, season_id, name, starts_on, location, status, created_at)
       VALUES ('m1', 't1', 's1', 'April Invite', '2026-04-04', NULL, 'completed', ?),
              ('m2', 't1', 's1', 'September Invite', '2026-09-12', NULL, 'completed', ?)`,
    ).run(created, fall);
    db.prepare(
      `INSERT INTO athletes (id, school_id, first_name, last_name, gender, grade_level, created_at)
       VALUES ('a1', 'sch1', 'Maya', 'Chen', 'girls', 'high_school', ?)`,
    ).run(created);
    db.prepare(
      `INSERT INTO events (id, meet_id, name, category, discipline, distance_meters, status, created_at)
       VALUES ('e1', 'm2', '5K', 'running', 'cross_country', 5000, 'completed', ?)`,
    ).run(fall);
    db.prepare(
      `INSERT INTO event_entries (id, event_id, athlete_id, created_at) VALUES ('ee1', 'e1', 'a1', ?)`,
    ).run(fall);
    db.prepare(
      `INSERT INTO performances (id, event_entry_id, event_id, athlete_id, status, elapsed_ms, created_at)
       VALUES ('p1', 'ee1', 'e1', 'a1', 'finished', 1200000, ?)`,
    ).run(fall);
    db.prepare(
      `INSERT INTO season_bests
         (id, athlete_id, season_id, discipline, distance_meters, mark_type, mark_value, performance_id, recorded_at)
       VALUES ('sb1', 'a1', 's1', 'cross_country', 5000, 'time_ms', 1200000, 'p1', ?)`,
    ).run(fall);

    migrateSchoolYearSeasons(db);
    migrateSchoolYearSeasons(db);

    const seasons = db
      .prepare(
        `SELECT t.name AS team, s.name AS season, s.starts_on AS startsOn
         FROM seasons s JOIN teams t ON t.id = s.team_id
         ORDER BY t.name, s.starts_on`,
      )
      .all();
    expect(seasons).toEqual([
      { team: "Lincoln", season: "25/26", startsOn: "2025-06-01" },
      { team: "Lincoln", season: "26/27", startsOn: "2026-06-01" },
      { team: "Riverside", season: "26/27", startsOn: "2026-06-01" },
    ]);

    const meets = db
      .prepare(
        `SELECT m.name, s.name AS season
         FROM meets m JOIN seasons s ON s.id = m.season_id
         ORDER BY m.starts_on`,
      )
      .all();
    expect(meets).toEqual([
      { name: "April Invite", season: "25/26" },
      { name: "September Invite", season: "26/27" },
    ]);

    const best = db
      .prepare(
        `SELECT s.name AS season FROM season_bests sb JOIN seasons s ON s.id = sb.season_id WHERE sb.id = 'sb1'`,
      )
      .get();
    expect(best).toEqual({ season: "26/27" });
    db.close();
  });
});
