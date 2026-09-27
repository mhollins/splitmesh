import type { AppContext } from "../appContext.ts";
import { newId, withTx } from "../db/index.ts";
import { schoolYearFor } from "../domain/seasons.ts";
import { roleAtLeast, type Role } from "../domain/roles.ts";
import { badRequest, notFound } from "../http/errors.ts";
import { requireMembership, requireSchoolManager } from "./access.ts";
import { deleteTeamGraph } from "./cascade.ts";
import { seedEventTypes } from "./eventTypes.ts";
import { ensureCurrentSeason } from "./seasons.ts";

function inviteCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

export function createTeam(ctx: AppContext, userId: string, name: string, schoolName?: string) {
  const trimmed = name.trim();
  if (!trimmed) throw badRequest("Team name is required");
  const schoolLabel = (schoolName ?? trimmed).trim() || trimmed;
  const now = ctx.clock.now();
  return withTx(ctx.db, () => {
    const teamId = newId();
    const schoolId = newId();
    const seasonId = newId();
    let code = inviteCode();
    for (let i = 0; i < 5; i++) {
      const clash = ctx.db.prepare(`SELECT id FROM teams WHERE invite_code = ?`).get(code);
      if (!clash) break;
      code = inviteCode();
    }
    ctx.db
      .prepare(`INSERT INTO schools (id, name, created_by_user_id, created_at) VALUES (?, ?, ?, ?)`)
      .run(schoolId, schoolLabel, userId, now);
    ctx.db
      .prepare(
        `INSERT INTO school_memberships (id, school_id, user_id, role, created_at) VALUES (?, ?, ?, 'school_admin', ?)`,
      )
      .run(newId(), schoolId, userId, now);
    ctx.db
      .prepare(
        `INSERT INTO teams (id, school_id, name, invite_code, created_by_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(teamId, schoolId, trimmed, code, userId, now);
    ctx.db
      .prepare(
        `INSERT INTO team_memberships (id, team_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(newId(), teamId, userId, "owner", now);
    const year = schoolYearFor(now);
    ctx.db
      .prepare(
        `INSERT INTO seasons (id, team_id, name, starts_on, ends_on, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(seasonId, teamId, year.name, year.startsOn, year.endsOn, now);
    seedEventTypes(ctx.db, teamId, now);
    return getTeam(ctx, teamId);
  });
}

export function joinTeam(ctx: AppContext, userId: string, rawCode: string) {
  const code = rawCode.trim().toUpperCase();
  if (!code) throw badRequest("Invite code is required");
  const team = ctx.db
    .prepare(`SELECT id FROM teams WHERE invite_code = ?`)
    .get(code) as { id: string } | undefined;
  if (!team) throw notFound("Invite code not found");
  const existing = ctx.db
    .prepare(`SELECT id FROM team_memberships WHERE team_id = ? AND user_id = ?`)
    .get(team.id, userId);
  if (existing) return getTeam(ctx, team.id);
  ctx.db
    .prepare(
      `INSERT INTO team_memberships (id, team_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(newId(), team.id, userId, "coach", ctx.clock.now());
  return getTeam(ctx, team.id);
}

export function listTeamsForUser(ctx: AppContext, userId: string) {
  return ctx.db
    .prepare(
      `SELECT t.id, t.name, t.invite_code AS inviteCode, m.role,
              t.school_id AS schoolId, s.name AS schoolName
       FROM team_memberships m
       JOIN teams t ON t.id = m.team_id
       JOIN schools s ON s.id = t.school_id
       WHERE m.user_id = ?
       ORDER BY t.name`,
    )
    .all(userId);
}

export function getTeam(ctx: AppContext, teamId: string) {
  const team = ctx.db
    .prepare(
      `SELECT t.id, t.name, t.invite_code AS inviteCode, t.school_id AS schoolId, s.name AS schoolName
       FROM teams t JOIN schools s ON s.id = t.school_id WHERE t.id = ?`,
    )
    .get(teamId) as
    | { id: string; name: string; inviteCode: string; schoolId: string; schoolName: string }
    | undefined;
  if (!team) throw notFound("Team not found");
  const members = ctx.db
    .prepare(
      `SELECT u.id, u.email, u.display_name AS displayName, m.role
       FROM team_memberships m
       JOIN users u ON u.id = m.user_id
       WHERE m.team_id = ?
       ORDER BY m.role DESC, u.display_name`,
    )
    .all(teamId);
  const season = ensureCurrentSeason(ctx, teamId);
  return { ...team, members, currentSeason: season };
}

export function requireTeam(ctx: AppContext, userId: string, teamId: string, minimum: Role = "viewer") {
  const exists = ctx.db.prepare(`SELECT id FROM teams WHERE id = ?`).get(teamId);
  if (!exists) throw notFound("Team not found");
  requireMembership(ctx, userId, teamId, minimum);
  return getTeam(ctx, teamId);
}

function membershipRole(ctx: AppContext, userId: string, teamId: string): Role | null {
  const row = ctx.db
    .prepare(`SELECT role FROM team_memberships WHERE team_id = ? AND user_id = ?`)
    .get(teamId, userId) as { role: Role } | undefined;
  return row?.role ?? null;
}

export function updateTeam(ctx: AppContext, userId: string, teamId: string, name: string) {
  const team = ctx.db.prepare(`SELECT school_id AS schoolId FROM teams WHERE id = ?`).get(teamId) as
    | { schoolId: string }
    | undefined;
  if (!team) throw notFound("Team not found");
  const role = membershipRole(ctx, userId, teamId);
  if (!role || !roleAtLeast(role, "admin")) requireSchoolManager(ctx, userId, team.schoolId);
  const trimmed = name.trim();
  if (!trimmed) throw badRequest("Team name is required");
  ctx.db.prepare(`UPDATE teams SET name = ? WHERE id = ?`).run(trimmed, teamId);
  return getTeam(ctx, teamId);
}

export function deleteTeam(ctx: AppContext, userId: string, teamId: string) {
  const team = ctx.db.prepare(`SELECT school_id AS schoolId FROM teams WHERE id = ?`).get(teamId) as
    | { schoolId: string }
    | undefined;
  if (!team) throw notFound("Team not found");
  const role = membershipRole(ctx, userId, teamId);
  if (!role || !roleAtLeast(role, "owner")) requireSchoolManager(ctx, userId, team.schoolId);
  withTx(ctx.db, () => {
    deleteTeamGraph(ctx, teamId);
  });
  return { ok: true };
}
