import type { AppContext } from "../appContext.ts";
import { newId, withTx } from "../db/index.ts";
import { parseGender, parseGradeLevel, type Gender, type GradeLevel } from "../domain/athletes.ts";
import { badRequest, forbidden, notFound } from "../http/errors.ts";
import { isPlatformAdmin, requireAthleteEditor, requireMembership, requireSchoolManager, requireSchoolRead } from "./access.ts";
import { roleAtLeast, type Role } from "../domain/roles.ts";
import { deleteAthleteGraph } from "./cascade.ts";
import { listRecordsForAthlete, listRecordsForTeam, recomputeSchoolRecord } from "./records.ts";

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
  const team = ctx.db.prepare(`SELECT school_id AS schoolId FROM teams WHERE id = ?`).get(teamId) as
    | { schoolId: string }
    | undefined;
  if (!team) throw notFound("Team not found");
  const id = insertAthlete(ctx, team.schoolId, input);
  ctx.db
    .prepare(`INSERT INTO athlete_team_assignments (id, athlete_id, team_id, created_at) VALUES (?, ?, ?, ?)`)
    .run(newId(), id, teamId, ctx.clock.now());
  return getAthlete(ctx, id);
}

export function addSchoolAthlete(ctx: AppContext, userId: string, schoolId: string, input: AthleteInput) {
  requireSchoolManager(ctx, userId, schoolId);
  const id = insertAthlete(ctx, schoolId, input);
  return getAthlete(ctx, id);
}

function insertAthlete(ctx: AppContext, schoolId: string, input: AthleteInput): string {
  const attrs = parsedAttributes(input);
  const id = newId();
  ctx.db
    .prepare(
      `INSERT INTO athletes (id, school_id, first_name, last_name, gender, grade_level, graduation_year, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      schoolId,
      attrs.firstName,
      attrs.lastName,
      attrs.gender,
      attrs.gradeLevel,
      input.graduationYear ?? null,
      ctx.clock.now(),
    );
  return id;
}

export function listAthletes(ctx: AppContext, userId: string, teamId: string) {
  requireMembership(ctx, userId, teamId, "viewer");
  const athletes = ctx.db
    .prepare(
      `SELECT a.id, a.first_name AS firstName, a.last_name AS lastName, a.gender,
              a.grade_level AS gradeLevel, a.graduation_year AS graduationYear
       FROM athletes a
       JOIN athlete_team_assignments ata ON ata.athlete_id = a.id
       WHERE ata.team_id = ?
       ORDER BY a.last_name, a.first_name`,
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
  schoolId: string;
  firstName: string;
  lastName: string;
  gender: Gender;
  gradeLevel: GradeLevel;
  graduationYear: number | null;
  teams: { id: string; name: string }[];
  records?: ReturnType<typeof listRecordsForAthlete>;
};

export function getAthlete(ctx: AppContext, athleteId: string): AthleteRecord {
  const row = ctx.db
    .prepare(
      `SELECT id, school_id AS schoolId, first_name AS firstName, last_name AS lastName, gender,
              grade_level AS gradeLevel, graduation_year AS graduationYear
       FROM athletes WHERE id = ?`,
    )
    .get(athleteId) as Omit<AthleteRecord, "teams" | "records"> | undefined;
  if (!row) throw notFound("Athlete not found");
  const teams = ctx.db
    .prepare(
      `SELECT t.id, t.name
       FROM athlete_team_assignments a
       JOIN teams t ON t.id = a.team_id
       WHERE a.athlete_id = ?
       ORDER BY t.name`,
    )
    .all(athleteId) as { id: string; name: string }[];
  return { ...row, teams, records: listRecordsForAthlete(ctx, athleteId) };
}

export function listSchoolAthletes(ctx: AppContext, userId: string, schoolId: string) {
  requireSchoolRead(ctx, userId, schoolId);
  const ids = ctx.db
    .prepare(`SELECT id FROM athletes WHERE school_id = ? ORDER BY last_name, first_name`)
    .all(schoolId) as { id: string }[];
  return ids.map((row) => getAthlete(ctx, row.id));
}

export function updateAthlete(ctx: AppContext, userId: string, athleteId: string, input: AthleteInput) {
  const athlete = getAthlete(ctx, athleteId);
  requireAthleteEditor(ctx, userId, athleteId);
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
  withTx(ctx.db, () => {
    ctx.db
      .prepare(
        `UPDATE athletes SET first_name = ?, last_name = ?, gender = ?, grade_level = ?, graduation_year = ? WHERE id = ?`,
      )
      .run(attrs.firstName, attrs.lastName, attrs.gender, attrs.gradeLevel, graduationYear, athleteId);
    if (attrs.gender !== athlete.gender) {
      const keys = ctx.db
        .prepare(
          `SELECT DISTINCT e.discipline, e.distance_meters AS distanceMeters
           FROM performances p
           JOIN events e ON e.id = p.event_id
           WHERE p.athlete_id = ? AND p.status = 'finished' AND p.elapsed_ms IS NOT NULL AND e.distance_meters IS NOT NULL`,
        )
        .all(athleteId) as { discipline: string; distanceMeters: number }[];
      for (const key of keys) {
        recomputeSchoolRecord(ctx, { schoolId: athlete.schoolId, gender: athlete.gender, ...key });
        recomputeSchoolRecord(ctx, { schoolId: athlete.schoolId, gender: attrs.gender, ...key });
      }
    }
  });
  return getAthlete(ctx, athleteId);
}

export function deleteAthlete(ctx: AppContext, userId: string, athleteId: string) {
  const athlete = getAthlete(ctx, athleteId);
  requireSchoolManager(ctx, userId, athlete.schoolId);
  withTx(ctx.db, () => {
    deleteAthleteGraph(ctx, athleteId);
  });
  return { ok: true };
}

function assertAssignable(ctx: AppContext, userId: string, schoolId: string, athleteId: string, teamId: string) {
  const athlete = ctx.db.prepare(`SELECT school_id AS schoolId FROM athletes WHERE id = ?`).get(athleteId) as
    | { schoolId: string }
    | undefined;
  if (!athlete || athlete.schoolId !== schoolId) throw notFound("Athlete not found");
  const team = ctx.db.prepare(`SELECT school_id AS schoolId FROM teams WHERE id = ?`).get(teamId) as
    | { schoolId: string }
    | undefined;
  if (!team || team.schoolId !== schoolId) throw badRequest("Team is not in this school");
  if (isPlatformAdmin(ctx, userId)) return;
  const admin = ctx.db
    .prepare(`SELECT 1 FROM school_memberships WHERE school_id = ? AND user_id = ? AND role = 'school_admin'`)
    .get(schoolId, userId);
  if (admin) return;
  try {
    const membership = requireMembership(ctx, userId, teamId, "coach");
    if (!roleAtLeast(membership.role, "coach")) throw forbidden("Not allowed");
  } catch (error) {
    if (error instanceof Error && "statusCode" in error && (error as { statusCode: number }).statusCode === 403) {
      throw forbidden("Not allowed");
    }
    throw error;
  }
}

export function assignAthlete(ctx: AppContext, userId: string, schoolId: string, athleteId: string, teamId: string) {
  assertAssignable(ctx, userId, schoolId, athleteId, teamId);
  const existing = ctx.db
    .prepare(`SELECT id FROM athlete_team_assignments WHERE athlete_id = ? AND team_id = ?`)
    .get(athleteId, teamId);
  if (!existing) {
    ctx.db
      .prepare(`INSERT INTO athlete_team_assignments (id, athlete_id, team_id, created_at) VALUES (?, ?, ?, ?)`)
      .run(newId(), athleteId, teamId, ctx.clock.now());
  }
  return getAthlete(ctx, athleteId);
}

export function unassignAthlete(ctx: AppContext, userId: string, schoolId: string, athleteId: string, teamId: string) {
  assertAssignable(ctx, userId, schoolId, athleteId, teamId);
  const result = ctx.db
    .prepare(`DELETE FROM athlete_team_assignments WHERE athlete_id = ? AND team_id = ?`)
    .run(athleteId, teamId);
  if (result.changes === 0) throw notFound("Athlete is not assigned to this team");
  return getAthlete(ctx, athleteId);
}
