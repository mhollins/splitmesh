import type { Db } from "./index.ts";

function columnNames(db: Db, table: string): Set<string> {
  const columns = db.pragma(`table_info(${table})`) as { name: string; notnull: number }[];
  return new Set(columns.map((column) => column.name));
}

function columnNotNull(db: Db, table: string, name: string): boolean {
  const columns = db.pragma(`table_info(${table})`) as { name: string; notnull: number }[];
  return Boolean(columns.find((column) => column.name === name)?.notnull);
}

export function migrateSchools(db: Db): void {
  if (needsStructuralMove(db)) {
    db.pragma("foreign_keys = OFF");
    try {
      db.exec("BEGIN");
      moveSchools(db);
      const bad = db.pragma("foreign_key_check") as unknown[];
      if (bad.length) {
        db.exec("ROLLBACK");
        throw new Error(`foreign_key_check failed: ${JSON.stringify(bad)}`);
      }
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // The transaction may already be closed.
      }
      throw error;
    } finally {
      db.pragma("foreign_keys = ON");
    }
  }

  const lingering = db.pragma("foreign_key_check") as unknown[];
  if (lingering.length) {
    throw new Error(`foreign_key_check failed: ${JSON.stringify(lingering)}`);
  }
  backfillSchoolRecords(db);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_teams_school ON teams(school_id);
    CREATE INDEX IF NOT EXISTS idx_athletes_school ON athletes(school_id);
    CREATE INDEX IF NOT EXISTS idx_assignments_team ON athlete_team_assignments(team_id);
    CREATE INDEX IF NOT EXISTS idx_school_members_user ON school_memberships(user_id);
  `);
}

function needsStructuralMove(db: Db): boolean {
  const athletes = columnNames(db, "athletes");
  const teams = columnNames(db, "teams");
  if (athletes.has("team_id") || !teams.has("school_id")) return true;
  const missing = db.prepare(`SELECT 1 FROM teams WHERE school_id IS NULL LIMIT 1`).get();
  return Boolean(missing);
}

function moveSchools(db: Db): void {
  if (!columnNames(db, "teams").has("school_id")) rebuildTeams(db, true);
  if (!columnNames(db, "athletes").has("school_id")) addAthleteSchoolId(db);

  const teams = db
    .prepare(
      `SELECT id, name, created_by_user_id AS createdByUserId, created_at AS createdAt
       FROM teams WHERE school_id IS NULL ORDER BY created_at, id`,
    )
    .all() as { id: string; name: string; createdByUserId: string; createdAt: number }[];

  let schools = 0;
  let schoolAdmins = 0;
  const setSchool = db.prepare(`UPDATE teams SET school_id = ? WHERE id = ?`);
  const insertSchool = db.prepare(
    `INSERT INTO schools (id, name, created_by_user_id, created_at) VALUES (?, ?, ?, ?)`,
  );
  const insertAdmin = db.prepare(
    `INSERT INTO school_memberships (id, school_id, user_id, role, created_at)
     SELECT ?, ?, ?, 'school_admin', ?
     WHERE NOT EXISTS (
       SELECT 1 FROM school_memberships WHERE school_id = ? AND user_id = ?
     )`,
  );

  for (const team of teams) {
    const schoolId = crypto.randomUUID();
    insertSchool.run(schoolId, team.name, team.createdByUserId, team.createdAt);
    setSchool.run(schoolId, team.id);
    schools += 1;
    const adminId = chooseSchoolAdmin(db, team.id, team.createdByUserId);
    if (adminId) {
      const info = insertAdmin.run(crypto.randomUUID(), schoolId, adminId, team.createdAt, schoolId, adminId);
      if (info.changes) schoolAdmins += 1;
    } else {
      console.info(`school ${schoolId} has no school_admin`);
    }
  }

  const assignment = db.prepare(
    `INSERT INTO athlete_team_assignments (id, athlete_id, team_id, created_at)
     SELECT lower(hex(randomblob(16))), a.id, a.team_id, a.created_at
     FROM athletes a
     WHERE a.team_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM athlete_team_assignments x WHERE x.athlete_id = a.id AND x.team_id = a.team_id
       )`,
  );
  if (columnNames(db, "athletes").has("team_id")) {
    db.prepare(
      `UPDATE athletes
       SET school_id = (SELECT t.school_id FROM teams t WHERE t.id = athletes.team_id)
       WHERE school_id IS NULL AND team_id IS NOT NULL`,
    ).run();
    const missingAthlete = db
      .prepare(`SELECT COUNT(*) AS n FROM athletes WHERE school_id IS NULL OR team_id IS NULL`)
      .get() as { n: number };
    if (missingAthlete.n) throw new Error("athlete is missing a school or team during school migration");
    const assigned = assignment.run();
    if (columnNames(db, "athletes").has("team_id")) rebuildAthletesWithoutTeam(db);
    const athleteCount = (db.prepare(`SELECT COUNT(*) AS n FROM athletes`).get() as { n: number }).n;
    console.info(
      `migrated schools=${schools} athletes=${athleteCount} assignments=${assigned.changes} schoolAdmins=${schoolAdmins}`,
    );
  } else if (schools) {
    const athleteCount = (db.prepare(`SELECT COUNT(*) AS n FROM athletes`).get() as { n: number }).n;
    console.info(`migrated schools=${schools} athletes=${athleteCount} assignments=0 schoolAdmins=${schoolAdmins}`);
  }

  if (!columnNotNull(db, "teams", "school_id")) rebuildTeams(db, false);
  db.exec(`DROP INDEX IF EXISTS idx_athletes_team`);
}

function chooseSchoolAdmin(db: Db, teamId: string, createdByUserId: string): string | null {
  const owner = db
    .prepare(
      `SELECT user_id AS userId FROM team_memberships
       WHERE team_id = ? AND role = 'owner' ORDER BY created_at, id LIMIT 1`,
    )
    .get(teamId) as { userId: string } | undefined;
  if (owner) return owner.userId;
  const creator = db.prepare(`SELECT id FROM users WHERE id = ?`).get(createdByUserId) as { id: string } | undefined;
  if (creator) return creator.id;
  const admin = db
    .prepare(
      `SELECT user_id AS userId FROM team_memberships
       WHERE team_id = ? AND role = 'admin' ORDER BY created_at, id LIMIT 1`,
    )
    .get(teamId) as { userId: string } | undefined;
  if (admin) return admin.userId;
  const any = db
    .prepare(
      `SELECT user_id AS userId FROM team_memberships
       WHERE team_id = ? ORDER BY created_at, id LIMIT 1`,
    )
    .get(teamId) as { userId: string } | undefined;
  return any?.userId ?? null;
}

function rebuildTeams(db: Db, nullable: boolean): void {
  const schoolColumn = nullable ? "school_id TEXT" : "school_id TEXT NOT NULL REFERENCES schools(id)";
  db.exec(`
    CREATE TABLE teams_v2 (
      id TEXT PRIMARY KEY,
      ${schoolColumn},
      name TEXT NOT NULL,
      invite_code TEXT NOT NULL UNIQUE,
      created_by_user_id TEXT NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL
    );
    INSERT INTO teams_v2 (id, school_id, name, invite_code, created_by_user_id, created_at)
    SELECT id, ${nullable ? "NULL" : "school_id"}, name, invite_code, created_by_user_id, created_at FROM teams;
    DROP TABLE teams;
    ALTER TABLE teams_v2 RENAME TO teams;
  `);
}

function addAthleteSchoolId(db: Db): void {
  db.exec(`
    CREATE TABLE athletes_v2 (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      school_id TEXT,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      gender TEXT NOT NULL,
      grade_level TEXT NOT NULL,
      graduation_year INTEGER,
      created_at INTEGER NOT NULL
    );
    INSERT INTO athletes_v2
      (id, team_id, school_id, first_name, last_name, gender, grade_level, graduation_year, created_at)
    SELECT id, team_id, NULL, first_name, last_name, gender, grade_level, graduation_year, created_at FROM athletes;
    DROP TABLE athletes;
    ALTER TABLE athletes_v2 RENAME TO athletes;
  `);
}

function rebuildAthletesWithoutTeam(db: Db): void {
  db.exec(`
    CREATE TABLE athletes_v2 (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id),
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      gender TEXT NOT NULL,
      grade_level TEXT NOT NULL,
      graduation_year INTEGER,
      created_at INTEGER NOT NULL
    );
    INSERT INTO athletes_v2
      (id, school_id, first_name, last_name, gender, grade_level, graduation_year, created_at)
    SELECT id, school_id, first_name, last_name, gender, grade_level, graduation_year, created_at FROM athletes;
    DROP TABLE athletes;
    ALTER TABLE athletes_v2 RENAME TO athletes;
  `);
}

function backfillSchoolRecords(db: Db): void {
  const table = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'school_records'`).get();
  if (!table) return;
  const schools = db
    .prepare(
      `SELECT id FROM schools s
       WHERE NOT EXISTS (SELECT 1 FROM school_records sr WHERE sr.school_id = s.id)`,
    )
    .all() as { id: string }[];
  if (!schools.length) return;
  const winners = db.prepare(
    `SELECT p.id AS performanceId, p.athlete_id AS athleteId, p.elapsed_ms AS elapsedMs,
            COALESCE(p.finished_at, p.created_at) AS recordedAt, m.team_id AS teamId,
            a.gender AS gender, e.discipline AS discipline, e.distance_meters AS distanceMeters
     FROM performances p
     JOIN athletes a ON a.id = p.athlete_id
     JOIN events e ON e.id = p.event_id
     JOIN meets m ON m.id = e.meet_id
     JOIN teams t ON t.id = m.team_id
     WHERE a.school_id = ?
       AND t.school_id = a.school_id
       AND a.gender = a.gender
       AND p.status = 'finished'
       AND p.elapsed_ms IS NOT NULL
       AND e.distance_meters IS NOT NULL
     ORDER BY a.gender, e.discipline, e.distance_meters,
              p.elapsed_ms ASC, COALESCE(p.finished_at, p.created_at) ASC, p.id ASC`,
  );
  const insert = db.prepare(
    `INSERT INTO school_records
       (id, school_id, gender, discipline, distance_meters, mark_type, mark_value, athlete_id, performance_id, team_id, recorded_at, previous_mark_value)
     VALUES (?, ?, ?, ?, ?, 'time_ms', ?, ?, ?, ?, ?, NULL)`,
  );
  const fill = db.transaction(() => {
    for (const school of schools) {
      const rows = winners.all(school.id) as {
        performanceId: string;
        athleteId: string;
        elapsedMs: number;
        recordedAt: number;
        teamId: string;
        gender: string;
        discipline: string;
        distanceMeters: number;
      }[];
      const seen = new Set<string>();
      for (const row of rows) {
        const key = `${row.gender}|${row.discipline}|${row.distanceMeters}`;
        if (seen.has(key)) continue;
        seen.add(key);
        insert.run(
          crypto.randomUUID(),
          school.id,
          row.gender,
          row.discipline,
          row.distanceMeters,
          row.elapsedMs,
          row.athleteId,
          row.performanceId,
          row.teamId,
          row.recordedAt,
        );
      }
    }
  });
  fill();
}
