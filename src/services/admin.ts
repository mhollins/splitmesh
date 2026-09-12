import type { AppContext } from "../appContext.ts";
import { withTx } from "../db/index.ts";
import { badRequest, conflict, forbidden, notFound } from "../http/errors.ts";
import { deleteTeamGraph } from "./cascade.ts";
import { getTeam } from "./teams.ts";
import { getUser } from "./users.ts";

export function requirePlatformAdmin(ctx: AppContext, userId: string) {
  const user = getUser(ctx, userId);
  if (!user) throw forbidden();
  if (!user.isPlatformAdmin) throw forbidden("Administrator access required");
  return user;
}

export function listCoaches(ctx: AppContext, actorId: string) {
  requirePlatformAdmin(ctx, actorId);
  const users = ctx.db
    .prepare(
      `SELECT id, email, display_name AS displayName, is_platform_admin AS isPlatformAdmin, created_at AS createdAt
       FROM users ORDER BY display_name, email`,
    )
    .all() as {
    id: string;
    email: string;
    displayName: string;
    isPlatformAdmin: number;
    createdAt: number;
  }[];
  const memberships = ctx.db
    .prepare(
      `SELECT m.user_id AS userId, t.id AS teamId, t.name AS teamName, m.role
       FROM team_memberships m
       JOIN teams t ON t.id = m.team_id
       ORDER BY t.name`,
    )
    .all() as { userId: string; teamId: string; teamName: string; role: string }[];
  const byUser = new Map<string, { teamId: string; teamName: string; role: string }[]>();
  for (const row of memberships) {
    const list = byUser.get(row.userId) ?? [];
    list.push({ teamId: row.teamId, teamName: row.teamName, role: row.role });
    byUser.set(row.userId, list);
  }
  return users.map((user) => ({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    isPlatformAdmin: Boolean(user.isPlatformAdmin),
    createdAt: user.createdAt,
    teams: byUser.get(user.id) ?? [],
  }));
}

export function listAllTeams(ctx: AppContext, actorId: string) {
  requirePlatformAdmin(ctx, actorId);
  const teams = ctx.db
    .prepare(
      `SELECT id, name, invite_code AS inviteCode, created_at AS createdAt FROM teams ORDER BY name`,
    )
    .all() as { id: string; name: string; inviteCode: string; createdAt: number }[];
  return teams.map((team) => getTeam(ctx, team.id));
}

export function updateCoach(
  ctx: AppContext,
  actorId: string,
  userId: string,
  input: { displayName?: string; isPlatformAdmin?: boolean },
) {
  requirePlatformAdmin(ctx, actorId);
  const target = getUser(ctx, userId);
  if (!target) throw notFound("User not found");

  let displayName = target.displayName;
  if (input.displayName !== undefined) {
    displayName = input.displayName.trim();
    if (!displayName) throw badRequest("Name is required");
  }

  let isAdmin = target.isPlatformAdmin;
  if (input.isPlatformAdmin !== undefined) {
    isAdmin = input.isPlatformAdmin;
    if (!isAdmin && target.isPlatformAdmin) {
      const count = ctx.db
        .prepare(`SELECT COUNT(*) AS n FROM users WHERE is_platform_admin = 1`)
        .get() as { n: number };
      if (count.n <= 1) {
        throw conflict("At least one administrator is required", "LAST_ADMIN");
      }
    }
  }

  ctx.db
    .prepare(`UPDATE users SET display_name = ?, is_platform_admin = ? WHERE id = ?`)
    .run(displayName, isAdmin ? 1 : 0, userId);
  return getUser(ctx, userId);
}

export function adminUpdateTeam(ctx: AppContext, actorId: string, teamId: string, name: string) {
  requirePlatformAdmin(ctx, actorId);
  const trimmed = name.trim();
  if (!trimmed) throw badRequest("Team name is required");
  const exists = ctx.db.prepare(`SELECT id FROM teams WHERE id = ?`).get(teamId);
  if (!exists) throw notFound("Team not found");
  ctx.db.prepare(`UPDATE teams SET name = ? WHERE id = ?`).run(trimmed, teamId);
  return getTeam(ctx, teamId);
}

export function adminDeleteTeam(ctx: AppContext, actorId: string, teamId: string) {
  requirePlatformAdmin(ctx, actorId);
  const exists = ctx.db.prepare(`SELECT id FROM teams WHERE id = ?`).get(teamId);
  if (!exists) throw notFound("Team not found");
  withTx(ctx.db, () => {
    deleteTeamGraph(ctx.db, teamId);
  });
  return { ok: true };
}
