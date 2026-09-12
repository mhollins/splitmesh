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
