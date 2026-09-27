import type { AppContext } from "../appContext.ts";
import { newId, withTx } from "../db/index.ts";
import { schoolYearFor } from "../domain/seasons.ts";
import { isRole } from "../domain/roles.ts";
import { badRequest, conflict, notFound } from "../http/errors.ts";
import { requireSchoolManager } from "./access.ts";
import { deleteSchoolGraph, deleteTeamGraph } from "./cascade.ts";
import { seedEventTypes } from "./eventTypes.ts";
import { getTeam } from "./teams.ts";

function inviteCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

function allocateInviteCode(ctx: AppContext): string {
  let code = inviteCode();
  for (let i = 0; i < 5; i++) {
    const clash = ctx.db.prepare(`SELECT id FROM teams WHERE invite_code = ?`).get(code);
    if (!clash) return code;
    code = inviteCode();
  }
  return code;
}

export function listSchoolsForUser(ctx: AppContext, userId: string) {
  return ctx.db
    .prepare(
      `SELECT s.id, s.name, m.role
       FROM school_memberships m
       JOIN schools s ON s.id = m.school_id
       WHERE m.user_id = ?
       ORDER BY s.name`,
    )
    .all(userId);
}

export function getSchool(ctx: AppContext, userId: string, schoolId: string) {
  requireSchoolManager(ctx, userId, schoolId);
  const school = ctx.db.prepare(`SELECT id, name FROM schools WHERE id = ?`).get(schoolId) as
    | { id: string; name: string }
    | undefined;
  if (!school) throw notFound("School not found");
  const admins = ctx.db
    .prepare(
      `SELECT u.id, u.email, u.display_name AS displayName
       FROM school_memberships m
       JOIN users u ON u.id = m.user_id
       WHERE m.school_id = ?
       ORDER BY u.display_name`,
    )
    .all(schoolId);
  const teamRows = ctx.db
    .prepare(`SELECT id FROM teams WHERE school_id = ? ORDER BY name`)
    .all(schoolId) as { id: string }[];
  return { school: { ...school, admins, teams: teamRows.map((team) => getTeam(ctx, team.id)) } };
}

export function updateSchool(ctx: AppContext, userId: string, schoolId: string, name: string) {
  requireSchoolManager(ctx, userId, schoolId);
  const trimmed = name.trim();
  if (!trimmed) throw badRequest("School name is required");
  ctx.db.prepare(`UPDATE schools SET name = ? WHERE id = ?`).run(trimmed, schoolId);
  return getSchool(ctx, userId, schoolId);
}

export function deleteSchool(ctx: AppContext, userId: string, schoolId: string) {
  requireSchoolManager(ctx, userId, schoolId);
  withTx(ctx.db, () => {
    deleteSchoolGraph(ctx, schoolId);
  });
  return { ok: true };
}

export function createTeamInSchool(ctx: AppContext, userId: string, schoolId: string, name: string) {
  requireSchoolManager(ctx, userId, schoolId);
  const trimmed = name.trim();
  if (!trimmed) throw badRequest("Team name is required");
  const now = ctx.clock.now();
  const teamId = withTx(ctx.db, () => {
    const id = newId();
    const code = allocateInviteCode(ctx);
    ctx.db
      .prepare(
        `INSERT INTO teams (id, school_id, name, invite_code, created_by_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, schoolId, trimmed, code, userId, now);
    const year = schoolYearFor(now);
    ctx.db
      .prepare(
        `INSERT INTO seasons (id, team_id, name, starts_on, ends_on, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(newId(), id, year.name, year.startsOn, year.endsOn, now);
    seedEventTypes(ctx.db, id, now);
    return id;
  });
  return getTeam(ctx, teamId);
}

function userIdByEmail(ctx: AppContext, email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!normalized) throw badRequest("Email is required");
  const user = ctx.db.prepare(`SELECT id FROM users WHERE email = ?`).get(normalized) as { id: string } | undefined;
  if (!user) throw notFound("No user with that email. They must register first.");
  return user.id;
}

export function addSchoolAdmin(ctx: AppContext, actorId: string, schoolId: string, email: string) {
  requireSchoolManager(ctx, actorId, schoolId);
  const userId = userIdByEmail(ctx, email);
  ctx.db
    .prepare(
      `INSERT INTO school_memberships (id, school_id, user_id, role, created_at)
       SELECT ?, ?, ?, 'school_admin', ?
       WHERE NOT EXISTS (SELECT 1 FROM school_memberships WHERE school_id = ? AND user_id = ?)`,
    )
    .run(newId(), schoolId, userId, ctx.clock.now(), schoolId, userId);
  return getSchool(ctx, actorId, schoolId);
}

export function removeSchoolAdmin(ctx: AppContext, actorId: string, schoolId: string, userId: string) {
  requireSchoolManager(ctx, actorId, schoolId);
  const admins = ctx.db
    .prepare(`SELECT COUNT(*) AS n FROM school_memberships WHERE school_id = ?`)
    .get(schoolId) as { n: number };
  const existing = ctx.db
    .prepare(`SELECT id FROM school_memberships WHERE school_id = ? AND user_id = ?`)
    .get(schoolId, userId);
  if (!existing) throw notFound("School administrator not found");
  if (admins.n <= 1) throw conflict("At least one school administrator is required", "LAST_SCHOOL_ADMIN");
  ctx.db.prepare(`DELETE FROM school_memberships WHERE school_id = ? AND user_id = ?`).run(schoolId, userId);
  return getSchool(ctx, actorId, schoolId);
}

function teamSchoolId(ctx: AppContext, teamId: string): string {
  const team = ctx.db.prepare(`SELECT school_id AS schoolId FROM teams WHERE id = ?`).get(teamId) as
    | { schoolId: string }
    | undefined;
  if (!team) throw notFound("Team not found");
  return team.schoolId;
}

export function upsertTeamMember(ctx: AppContext, actorId: string, teamId: string, email: string, role: string) {
  const schoolId = teamSchoolId(ctx, teamId);
  requireSchoolManager(ctx, actorId, schoolId);
  if (!isRole(role)) throw badRequest("Unknown role");
  const userId = userIdByEmail(ctx, email);
  const now = ctx.clock.now();
  const existing = ctx.db
    .prepare(`SELECT id FROM team_memberships WHERE team_id = ? AND user_id = ?`)
    .get(teamId, userId) as { id: string } | undefined;
  if (existing) {
    ctx.db.prepare(`UPDATE team_memberships SET role = ? WHERE id = ?`).run(role, existing.id);
  } else {
    ctx.db
      .prepare(`INSERT INTO team_memberships (id, team_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(newId(), teamId, userId, role, now);
  }
  return getTeam(ctx, teamId);
}

export function removeTeamMember(ctx: AppContext, actorId: string, teamId: string, userId: string) {
  const schoolId = teamSchoolId(ctx, teamId);
  requireSchoolManager(ctx, actorId, schoolId);
  const result = ctx.db
    .prepare(`DELETE FROM team_memberships WHERE team_id = ? AND user_id = ?`)
    .run(teamId, userId);
  if (result.changes === 0) throw notFound("Membership not found");
  return getTeam(ctx, teamId);
}

export function deleteTeamAsManager(ctx: AppContext, actorId: string, teamId: string) {
  const schoolId = teamSchoolId(ctx, teamId);
  requireSchoolManager(ctx, actorId, schoolId);
  withTx(ctx.db, () => {
    deleteTeamGraph(ctx, teamId);
  });
  return { ok: true };
}
