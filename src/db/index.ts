import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { initialAdminEmail } from "../config.ts";
import { SCHEMA_SQL } from "./schema.ts";

export type Db = Database.Database;

export function openDb(dbPath: string): Db {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(SCHEMA_SQL);
  migrateAthletes(db);
  migrateUsers(db);
  migratePersonalRecords(db);
  migratePreviousMarks(db);
  migrateEvents(db);
  migrateEventTypeId(db);
  migrate3200Splits(db);
  return db;
}

function migrateAthletes(db: Db): void {
  const columns = db.pragma("table_info(athletes)") as { name: string }[];
  const names = new Set(columns.map((column) => column.name));
  if (!names.has("gender")) {
    db.exec(`ALTER TABLE athletes ADD COLUMN gender TEXT NOT NULL DEFAULT 'boys'`);
  }
  if (!names.has("grade_level")) {
    db.exec(`ALTER TABLE athletes ADD COLUMN grade_level TEXT NOT NULL DEFAULT 'high_school'`);
  }
}

function migrateUsers(db: Db): void {
  const columns = db.pragma("table_info(users)") as { name: string }[];
  const names = new Set(columns.map((column) => column.name));
  if (!names.has("is_platform_admin")) {
    db.exec(`ALTER TABLE users ADD COLUMN is_platform_admin INTEGER NOT NULL DEFAULT 0`);
  }
  db.prepare(`UPDATE users SET is_platform_admin = 1 WHERE email = ?`).run(initialAdminEmail());
}

function migratePersonalRecords(db: Db): void {
  const columns = db.pragma("table_info(personal_records)") as { name: string; notnull: number }[];
  if (!columns.length) return;
  const names = new Set(columns.map((column) => column.name));
  const performance = columns.find((column) => column.name === "performance_id");
  if (performance?.notnull !== 1 && names.has("source")) return;
  db.pragma("foreign_keys = OFF");
  db.exec(`
    CREATE TABLE personal_records_v2 (
      id TEXT PRIMARY KEY,
      athlete_id TEXT NOT NULL REFERENCES athletes(id),
      discipline TEXT NOT NULL,
      distance_meters INTEGER,
      mark_type TEXT NOT NULL,
      mark_value INTEGER NOT NULL,
      performance_id TEXT REFERENCES performances(id),
      source TEXT NOT NULL DEFAULT 'performance',
      recorded_at INTEGER NOT NULL,
      UNIQUE (athlete_id, discipline, distance_meters, mark_type)
    );
    INSERT INTO personal_records_v2
      (id, athlete_id, discipline, distance_meters, mark_type, mark_value, performance_id, source, recorded_at)
    SELECT id, athlete_id, discipline, distance_meters, mark_type, mark_value, performance_id, 'performance', recorded_at
    FROM personal_records;
    DROP TABLE personal_records;
    ALTER TABLE personal_records_v2 RENAME TO personal_records;
  `);
  db.pragma("foreign_keys = ON");
}

function migratePreviousMarks(db: Db): void {
  const columns = db.pragma("table_info(personal_records)") as { name: string }[];
  if (!columns.some((column) => column.name === "previous_mark_value")) {
    db.exec(`ALTER TABLE personal_records ADD COLUMN previous_mark_value INTEGER`);
  }
}

function migrateEvents(db: Db): void {
  const columns = db.pragma("table_info(events)") as { name: string }[];
  const names = new Set(columns.map((column) => column.name));
  if (!names.has("paused_at")) {
    db.exec(`ALTER TABLE events ADD COLUMN paused_at INTEGER`);
  }
}

function migrateEventTypeId(db: Db): void {
  const columns = db.pragma("table_info(events)") as { name: string }[];
  if (!columns.some((column) => column.name === "event_type_id")) {
    db.exec(`ALTER TABLE events ADD COLUMN event_type_id TEXT REFERENCES event_types(id)`);
  }
}

export function migrate3200Splits(db: Db): void {
  const events = db
    .prepare(`SELECT id FROM events WHERE distance_meters = 3200`)
    .all() as { id: string }[];
  const updatePoint = db.prepare(
    `UPDATE timing_points SET name = ?, distance_meters = ?, sort_order = ?, is_finish = ? WHERE id = ?`,
  );
  for (const event of events) {
    const points = db
      .prepare(
        `SELECT id, name, distance_meters AS distanceMeters, sort_order AS sortOrder, is_finish AS isFinish
         FROM timing_points WHERE event_id = ? ORDER BY sort_order`,
      )
      .all(event.id) as {
      id: string;
      name: string;
      distanceMeters: number;
      sortOrder: number;
      isFinish: number;
    }[];
    const thousand = points.find((point) => point.distanceMeters === 1000 || point.name === "1000m");
    const twoThousand = points.find((point) => point.distanceMeters === 2000 || point.name === "2000m");
    const mile = points.find((point) => point.distanceMeters === 1609 || /mile/i.test(point.name));
    const finish = points.find((point) => point.isFinish) ?? points.at(-1);
    if (!thousand && !twoThousand) continue;

    let mileId = mile?.id;
    if (thousand) {
      if (!mileId || mileId === thousand.id) {
        updatePoint.run("1 Mile", 1609, 1, 0, thousand.id);
        mileId = thousand.id;
      } else {
        rehomeObservations(db, thousand.id, mileId);
        db.prepare(`DELETE FROM timing_points WHERE id = ?`).run(thousand.id);
      }
    } else if (!mileId) {
      mileId = crypto.randomUUID();
      db.prepare(
        `INSERT INTO timing_points (id, event_id, name, distance_meters, sort_order, is_finish)
         VALUES (?, ?, '1 Mile', 1609, 1, 0)`,
      ).run(mileId, event.id);
    }

    if (twoThousand) {
      db.prepare(`UPDATE timing_observations SET conflicts_with_id = NULL WHERE timing_point_id = ?`).run(
        twoThousand.id,
      );
      db.prepare(`DELETE FROM timing_observations WHERE timing_point_id = ?`).run(twoThousand.id);
      db.prepare(`DELETE FROM timing_points WHERE id = ?`).run(twoThousand.id);
    }

    if (finish && finish.id !== mileId) {
      updatePoint.run("Finish", 3200, 2, 1, finish.id);
    }
  }
}

function rehomeObservations(db: Db, fromPointId: string, toPointId: string): void {
  const rows = db
    .prepare(`SELECT id, performance_id AS performanceId, role FROM timing_observations WHERE timing_point_id = ?`)
    .all(fromPointId) as { id: string; performanceId: string; role: string }[];
  for (const row of rows) {
    const existingPrimary = db
      .prepare(
        `SELECT id FROM timing_observations
         WHERE performance_id = ? AND timing_point_id = ? AND role = 'primary' AND id != ?`,
      )
      .get(row.performanceId, toPointId, row.id) as { id: string } | undefined;
    if (existingPrimary && row.role === "primary") {
      db.prepare(
        `UPDATE timing_observations SET timing_point_id = ?, role = 'conflict', conflicts_with_id = ? WHERE id = ?`,
      ).run(toPointId, existingPrimary.id, row.id);
    } else {
      db.prepare(`UPDATE timing_observations SET timing_point_id = ? WHERE id = ?`).run(toPointId, row.id);
    }
  }
}

export function withTx<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function newId(): string {
  return crypto.randomUUID();
}
