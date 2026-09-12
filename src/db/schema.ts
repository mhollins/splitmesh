export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS team_memberships (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (team_id, user_id)
);

CREATE TABLE IF NOT EXISTS seasons (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id),
  name TEXT NOT NULL,
  starts_on TEXT,
  ends_on TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS athletes (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  gender TEXT NOT NULL,
  grade_level TEXT NOT NULL,
  graduation_year INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS meets (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id),
  season_id TEXT NOT NULL REFERENCES seasons(id),
  name TEXT NOT NULL,
  starts_on TEXT NOT NULL,
  location TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  meet_id TEXT NOT NULL REFERENCES meets(id),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  discipline TEXT NOT NULL,
  distance_meters INTEGER,
  status TEXT NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS timing_points (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  name TEXT NOT NULL,
  distance_meters INTEGER NOT NULL,
  sort_order INTEGER NOT NULL,
  is_finish INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS event_entries (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  athlete_id TEXT NOT NULL REFERENCES athletes(id),
  bib TEXT,
  target_time_ms INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (event_id, athlete_id)
);

CREATE TABLE IF NOT EXISTS performances (
  id TEXT PRIMARY KEY,
  event_entry_id TEXT NOT NULL UNIQUE REFERENCES event_entries(id),
  event_id TEXT NOT NULL REFERENCES events(id),
  athlete_id TEXT NOT NULL REFERENCES athletes(id),
  status TEXT NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  elapsed_ms INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS timing_observations (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  performance_id TEXT NOT NULL REFERENCES performances(id),
  athlete_id TEXT NOT NULL REFERENCES athletes(id),
  timing_point_id TEXT NOT NULL REFERENCES timing_points(id),
  observed_at INTEGER NOT NULL,
  client_observed_at INTEGER,
  recorded_at INTEGER NOT NULL,
  recorded_by_user_id TEXT NOT NULL REFERENCES users(id),
  idempotency_key TEXT NOT NULL,
  role TEXT NOT NULL,
  conflicts_with_id TEXT REFERENCES timing_observations(id),
  retracted_at INTEGER,
  retracted_by_user_id TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL,
  UNIQUE (event_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS event_log (
  event_id TEXT NOT NULL REFERENCES events(id),
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, seq)
);

CREATE TABLE IF NOT EXISTS personal_records (
  id TEXT PRIMARY KEY,
  athlete_id TEXT NOT NULL REFERENCES athletes(id),
  discipline TEXT NOT NULL,
  distance_meters INTEGER,
  mark_type TEXT NOT NULL,
  mark_value INTEGER NOT NULL,
  performance_id TEXT NOT NULL REFERENCES performances(id),
  recorded_at INTEGER NOT NULL,
  UNIQUE (athlete_id, discipline, distance_meters, mark_type)
);

CREATE TABLE IF NOT EXISTS season_bests (
  id TEXT PRIMARY KEY,
  athlete_id TEXT NOT NULL REFERENCES athletes(id),
  season_id TEXT NOT NULL REFERENCES seasons(id),
  discipline TEXT NOT NULL,
  distance_meters INTEGER,
  mark_type TEXT NOT NULL,
  mark_value INTEGER NOT NULL,
  performance_id TEXT NOT NULL REFERENCES performances(id),
  recorded_at INTEGER NOT NULL,
  UNIQUE (athlete_id, season_id, discipline, distance_meters, mark_type)
);

CREATE INDEX IF NOT EXISTS idx_memberships_user ON team_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_athletes_team ON athletes(team_id);
CREATE INDEX IF NOT EXISTS idx_meets_team ON meets(team_id);
CREATE INDEX IF NOT EXISTS idx_events_meet ON events(meet_id);
CREATE INDEX IF NOT EXISTS idx_entries_event ON event_entries(event_id);
CREATE INDEX IF NOT EXISTS idx_perf_event ON performances(event_id);
CREATE INDEX IF NOT EXISTS idx_obs_event ON timing_observations(event_id);
CREATE INDEX IF NOT EXISTS idx_obs_perf_point ON timing_observations(performance_id, timing_point_id);
CREATE INDEX IF NOT EXISTS idx_log_event ON event_log(event_id, seq);
`;
