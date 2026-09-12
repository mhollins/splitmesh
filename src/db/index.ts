import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
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
