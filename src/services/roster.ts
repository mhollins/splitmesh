import type { AppContext } from "../appContext.ts";
import { newId, withTx } from "../db/index.ts";
import { parseGender, parseGradeLevel, type Gender, type GradeLevel } from "../domain/athletes.ts";
import { badRequest, notFound } from "../http/errors.ts";
import { requireMembership } from "./access.ts";
import { deleteAthleteGraph } from "./cascade.ts";
import { listRecordsForTeam } from "./records.ts";

export type AthleteInput = {
  firstName?: string;
  lastName?: string;
  gender?: unknown;
  gradeLevel?: unknown;
  graduationYear?: number | null;
};

function parsedAttributes(input: AthleteInput, fallback?: { firstName: string; lastName: string; gender: Gender; gradeLevel: GradeLevel }) {
  const firstName = (input.firstName ?? fallback?.firstName ?? "").trim();
  const lastName = (input.lastName ?? fallback?.lastName ?? "").trim();
  if (!firstName || !lastName) throw badRequest("First and last name are required");
  const gender = parseGender(input.gender) ?? fallback?.gender ?? null;
  const gradeLevel = parseGradeLevel(input.gradeLevel) ?? fallback?.gradeLevel ?? null;
  if (!gender) throw badRequest("Gender must be Boys or Girls");
  if (!gradeLevel) throw badRequest("Grade level must be High School, Junior High, or Elementary");
  return { firstName, lastName, gender, gradeLevel };
}

export function addAthlete(ctx: AppContext, userId: string, teamId: string, input: AthleteInput) {
  requireMembership(ctx, userId, teamId, "coach");
  const attrs = parsedAttributes(input);
  const id = newId();
  ctx.db
    .prepare(
      `INSERT INTO athletes (id, team_id, first_name, last_name, gender, grade_level, graduation_year, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      teamId,
      attrs.firstName,
      attrs.lastName,
      attrs.gender,
      attrs.gradeLevel,
      input.graduationYear ?? null,
      ctx.clock.now(),
    );
  return getAthlete(ctx, id);
}

export function listAthletes(ctx: AppContext, userId: string, teamId: string) {
  requireMembership(ctx, userId, teamId, "viewer");
  const athletes = ctx.db
    .prepare(
      `SELECT id, first_name AS firstName, last_name AS lastName, gender,
              grade_level AS gradeLevel, graduation_year AS graduationYear
       FROM athletes WHERE team_id = ? ORDER BY last_name, first_name`,
    )
    .all(teamId) as {
    id: string;
    firstName: string;
    lastName: string;
    gender: string;
    gradeLevel: string;
    graduationYear: number | null;
  }[];
  const records = listRecordsForTeam(ctx, teamId);
  return athletes.map((athlete) => ({
    ...athlete,
    records: records.get(athlete.id) ?? [],
  }));
}

export type AthleteRecord = {
  id: string;
  teamId: string;
  firstName: string;
  lastName: string;
  gender: Gender;
  gradeLevel: GradeLevel;
  graduationYear: number | null;
};

export function getAthlete(ctx: AppContext, athleteId: string): AthleteRecord {
  const row = ctx.db
    .prepare(
      `SELECT id, team_id AS teamId, first_name AS firstName, last_name AS lastName, gender,
              grade_level AS gradeLevel, graduation_year AS graduationYear
       FROM athletes WHERE id = ?`,
    )
    .get(athleteId) as AthleteRecord | undefined;
  if (!row) throw notFound("Athlete not found");
  return row;
}

export function updateAthlete(ctx: AppContext, userId: string, athleteId: string, input: AthleteInput) {
  const athlete = getAthlete(ctx, athleteId);
  requireMembership(ctx, userId, athlete.teamId, "coach");
  const attrs = parsedAttributes(
    {
      firstName: input.firstName ?? athlete.firstName,
      lastName: input.lastName ?? athlete.lastName,
      gender: input.gender ?? athlete.gender,
      gradeLevel: input.gradeLevel ?? athlete.gradeLevel,
      graduationYear: input.graduationYear,
    },
    athlete,
  );
  const graduationYear = input.graduationYear !== undefined ? input.graduationYear : athlete.graduationYear;
  ctx.db
    .prepare(
      `UPDATE athletes SET first_name = ?, last_name = ?, gender = ?, grade_level = ?, graduation_year = ? WHERE id = ?`,
    )
    .run(attrs.firstName, attrs.lastName, attrs.gender, attrs.gradeLevel, graduationYear, athleteId);
  return getAthlete(ctx, athleteId);
}

export function deleteAthlete(ctx: AppContext, userId: string, athleteId: string) {
  const athlete = getAthlete(ctx, athleteId);
  requireMembership(ctx, userId, athlete.teamId, "coach");
  withTx(ctx.db, () => {
    deleteAthleteGraph(ctx.db, athleteId);
  });
  return { ok: true };
}
