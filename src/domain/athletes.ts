export const GENDERS = ["boys", "girls"] as const;
export type Gender = (typeof GENDERS)[number];

export const GRADE_LEVELS = ["high_school", "junior_high", "elementary"] as const;
export type GradeLevel = (typeof GRADE_LEVELS)[number];

export const GENDER_LABELS: Record<Gender, string> = {
  boys: "Boys",
  girls: "Girls",
};

export const GRADE_LABELS: Record<GradeLevel, string> = {
  high_school: "High School",
  junior_high: "Junior High",
  elementary: "Elementary",
};

export function isGender(value: string): value is Gender {
  return (GENDERS as readonly string[]).includes(value);
}

export function isGradeLevel(value: string): value is GradeLevel {
  return (GRADE_LEVELS as readonly string[]).includes(value);
}

export function parseGender(value: unknown): Gender | null {
  return typeof value === "string" && isGender(value) ? value : null;
}

export function parseGradeLevel(value: unknown): GradeLevel | null {
  return typeof value === "string" && isGradeLevel(value) ? value : null;
}

export type RosterRow = { selected: boolean; target: string };

export function selectRosterByFilters<T extends { id: string; gender: string; gradeLevel: string }>(
  athletes: T[],
  draft: Record<string, RosterRow>,
  genders: readonly string[],
  grades: readonly string[],
): Record<string, RosterRow> {
  const next: Record<string, RosterRow> = { ...draft };
  for (const athlete of athletes) {
    const row = next[athlete.id] ?? { selected: false, target: "" };
    const genderOk = genders.length === 0 || genders.includes(athlete.gender);
    const gradeOk = grades.length === 0 || grades.includes(athlete.gradeLevel);
    next[athlete.id] = { ...row, selected: genderOk && gradeOk };
  }
  return next;
}
