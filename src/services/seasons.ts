import type { AppContext } from "../appContext.ts";
import { schoolYearFor } from "../domain/seasons.ts";
import { newId } from "../db/index.ts";
import { notFound } from "../http/errors.ts";
import { requireMembership } from "./access.ts";

export type SeasonRecord = {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
};

export function ensureCurrentSeason(ctx: AppContext, teamId: string): SeasonRecord {
  const year = schoolYearFor(ctx.clock.now());
  const existing = findSeasonByName(ctx, teamId, year.name);
  if (existing) return existing;
  const id = newId();
  try {
    ctx.db
      .prepare(
        `INSERT INTO seasons (id, team_id, name, starts_on, ends_on, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, teamId, year.name, year.startsOn, year.endsOn, ctx.clock.now());
  } catch (error) {
    const raced = findSeasonByName(ctx, teamId, year.name);
    if (raced) return raced;
    throw error;
  }
  return { id, name: year.name, startsOn: year.startsOn, endsOn: year.endsOn };
}

export function requireTeamSeason(ctx: AppContext, teamId: string, seasonId: string): SeasonRecord {
  const row = ctx.db
    .prepare(
      `SELECT id, name, starts_on AS startsOn, ends_on AS endsOn
       FROM seasons WHERE id = ? AND team_id = ?`,
    )
    .get(seasonId, teamId) as SeasonRecord | undefined;
  if (!row) throw notFound("Season not found");
  return row;
}

export function listSeasons(ctx: AppContext, userId: string, teamId: string) {
  requireMembership(ctx, userId, teamId, "viewer");
  const current = ensureCurrentSeason(ctx, teamId);
  const rows = ctx.db
    .prepare(
      `SELECT id, name, starts_on AS startsOn, ends_on AS endsOn
       FROM seasons WHERE team_id = ? ORDER BY starts_on DESC`,
    )
    .all(teamId) as SeasonRecord[];
  return rows.map((season) => ({ ...season, isCurrent: season.id === current.id }));
}

function findSeasonByName(ctx: AppContext, teamId: string, name: string): SeasonRecord | undefined {
  return ctx.db
    .prepare(
      `SELECT id, name, starts_on AS startsOn, ends_on AS endsOn
       FROM seasons WHERE team_id = ? AND name = ?`,
    )
    .get(teamId, name) as SeasonRecord | undefined;
}
