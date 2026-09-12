import type { AppContext } from "../appContext.ts";
import { newId, withTx } from "../db/index.ts";
import type { Role } from "../domain/roles.ts";
import { badRequest, notFound } from "../http/errors.ts";
import { requireMembership } from "./access.ts";
import { deleteTeamGraph } from "./cascade.ts";

function inviteCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

export function createTeam(ctx: AppContext, userId: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw badRequest("Team name is required");
  const now = ctx.clock.now();
  return withTx(ctx.db, () => {
    const teamId = newId();
    const seasonId = newId();
    let code = inviteCode();
    for (let i = 0; i < 5; i++) {
      const clash = ctx.db.prepare(`SELECT id FROM teams WHERE invite_code = ?`).get(code);
      if (!clash) break;
      code = inviteCode();
    }
    ctx.db
      .prepare(
        `INSERT INTO teams (id, name, invite_code, created_by_user_id, created_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(teamId, trimmed, code, userId, now);
    ctx.db
      .prepare(
        `INSERT INTO team_memberships (id, team_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(newId(), teamId, userId, "owner", now);
    const year = new Date(now).getUTCFullYear();
    ctx.db
      .prepare(
        `INSERT INTO seasons (id, team_id, name, starts_on, ends_on, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(seasonId, teamId, `${year} Season`, `${year}-01-01`, `${year}-12-31`, now);
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
      `SELECT t.id, t.name, t.invite_code AS inviteCode, m.role
       FROM team_memberships m
       JOIN teams t ON t.id = m.team_id
       WHERE m.user_id = ?
       ORDER BY t.name`,
    )
    .all(userId);
}

export function getTeam(ctx: AppContext, teamId: string) {
  const team = ctx.db
    .prepare(`SELECT id, name, invite_code AS inviteCode FROM teams WHERE id = ?`)
    .get(teamId) as { id: string; name: string; inviteCode: string } | undefined;
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
  const season = ctx.db
    .prepare(
      `SELECT id, name FROM seasons WHERE team_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(teamId);
  return { ...team, members, currentSeason: season };
}

export function requireTeam(ctx: AppContext, userId: string, teamId: string, minimum: Role = "viewer") {
  const exists = ctx.db.prepare(`SELECT id FROM teams WHERE id = ?`).get(teamId);
  if (!exists) throw notFound("Team not found");
  requireMembership(ctx, userId, teamId, minimum);
  return getTeam(ctx, teamId);
}

export function updateTeam(ctx: AppContext, userId: string, teamId: string, name: string) {
  requireTeam(ctx, userId, teamId, "admin");
  const trimmed = name.trim();
  if (!trimmed) throw badRequest("Team name is required");
  ctx.db.prepare(`UPDATE teams SET name = ? WHERE id = ?`).run(trimmed, teamId);
  return getTeam(ctx, teamId);
}

export function deleteTeam(ctx: AppContext, userId: string, teamId: string) {
  requireTeam(ctx, userId, teamId, "owner");
  withTx(ctx.db, () => {
    deleteTeamGraph(ctx.db, teamId);
  });
  return { ok: true };
}
