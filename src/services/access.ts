import type { AppContext } from "../appContext.ts";
import { forbidden, notFound } from "../http/errors.ts";
import { roleAtLeast, type Role } from "../domain/roles.ts";

export type SchoolMembership = {
  id: string;
  school_id: string;
  user_id: string;
  role: "school_admin";
};

export function isPlatformAdmin(ctx: AppContext, userId: string): boolean {
  const row = ctx.db.prepare(`SELECT is_platform_admin AS isPlatformAdmin FROM users WHERE id = ?`).get(userId) as
    | { isPlatformAdmin: number }
    | undefined;
  return Boolean(row?.isPlatformAdmin);
}

export function requireSchoolManager(ctx: AppContext, userId: string, schoolId: string): void {
  const school = ctx.db.prepare(`SELECT id FROM schools WHERE id = ?`).get(schoolId);
  if (!school) throw notFound("School not found");
  if (isPlatformAdmin(ctx, userId)) return;
  const row = ctx.db
    .prepare(`SELECT id, school_id, user_id, role FROM school_memberships WHERE school_id = ? AND user_id = ?`)
    .get(schoolId, userId) as SchoolMembership | undefined;
  if (!row || row.role !== "school_admin") throw forbidden("School administrator access required");
}

export function requireSchoolRead(ctx: AppContext, userId: string, schoolId: string): void {
  const school = ctx.db.prepare(`SELECT id FROM schools WHERE id = ?`).get(schoolId);
  if (!school) throw notFound("School not found");
  if (isPlatformAdmin(ctx, userId)) return;
  const admin = ctx.db
    .prepare(`SELECT 1 FROM school_memberships WHERE school_id = ? AND user_id = ?`)
    .get(schoolId, userId);
  if (admin) return;
  const member = ctx.db
    .prepare(
      `SELECT 1 FROM team_memberships m
       JOIN teams t ON t.id = m.team_id
       WHERE t.school_id = ? AND m.user_id = ?
       LIMIT 1`,
    )
    .get(schoolId, userId);
  if (!member) throw forbidden("Not a member of this school");
}

export function requireAthleteEditor(ctx: AppContext, userId: string, athleteId: string): void {
  const athlete = ctx.db.prepare(`SELECT school_id AS schoolId FROM athletes WHERE id = ?`).get(athleteId) as
    | { schoolId: string }
    | undefined;
  if (!athlete) throw notFound("Athlete not found");
  if (isPlatformAdmin(ctx, userId)) return;
  const admin = ctx.db
    .prepare(`SELECT 1 FROM school_memberships WHERE school_id = ? AND user_id = ? AND role = 'school_admin'`)
    .get(athlete.schoolId, userId);
  if (admin) return;
  const coach = ctx.db
    .prepare(
      `SELECT m.role FROM athlete_team_assignments a
       JOIN team_memberships m ON m.team_id = a.team_id AND m.user_id = ?
       WHERE a.athlete_id = ?`,
    )
    .all(userId, athleteId) as { role: string }[];
  if (coach.some((row) => roleAtLeast(row.role as Role, "coach"))) return;
  throw forbidden("Not allowed to edit this athlete");
}

export type Membership = {
  id: string;
  team_id: string;
  user_id: string;
  role: Role;
};

export function requireMembership(
  ctx: AppContext,
  userId: string,
  teamId: string,
  minimum: Role = "viewer",
): Membership {
  const row = ctx.db
    .prepare(
      `SELECT id, team_id, user_id, role FROM team_memberships WHERE team_id = ? AND user_id = ?`,
    )
    .get(teamId, userId) as Membership | undefined;
  if (!row) throw forbidden("Not a member of this team");
  if (!roleAtLeast(row.role, minimum)) throw forbidden("Insufficient role");
  return row;
}

export function teamIdForEvent(ctx: AppContext, eventId: string): {
  event: {
    id: string;
    meet_id: string;
    name: string;
    category: string;
    discipline: string;
    distance_meters: number | null;
    status: string;
    started_at: number | null;
    completed_at: number | null;
  };
  meet: { id: string; team_id: string; season_id: string; name: string; status: string };
} {
  const row = ctx.db
    .prepare(
      `SELECT
         e.id AS event_id, e.meet_id, e.name AS event_name, e.category, e.discipline,
         e.distance_meters, e.status AS event_status, e.started_at, e.completed_at,
         m.id AS meet_id_full, m.team_id, m.season_id, m.name AS meet_name, m.status AS meet_status
       FROM events e
       JOIN meets m ON m.id = e.meet_id
       WHERE e.id = ?`,
    )
    .get(eventId) as
    | {
        event_id: string;
        meet_id: string;
        event_name: string;
        category: string;
        discipline: string;
        distance_meters: number | null;
        event_status: string;
        started_at: number | null;
        completed_at: number | null;
        team_id: string;
        season_id: string;
        meet_name: string;
        meet_status: string;
      }
    | undefined;
  if (!row) throw notFound("Event not found");
  return {
    event: {
      id: row.event_id,
      meet_id: row.meet_id,
      name: row.event_name,
      category: row.category,
      discipline: row.discipline,
      distance_meters: row.distance_meters,
      status: row.event_status,
      started_at: row.started_at,
      completed_at: row.completed_at,
    },
    meet: {
      id: row.meet_id,
      team_id: row.team_id,
      season_id: row.season_id,
      name: row.meet_name,
      status: row.meet_status,
    },
  };
}

export function requireEventAccess(
  ctx: AppContext,
  userId: string,
  eventId: string,
  minimum: Role = "viewer",
) {
  const loaded = teamIdForEvent(ctx, eventId);
  const membership = requireMembership(ctx, userId, loaded.meet.team_id, minimum);
  return { ...loaded, membership };
}
