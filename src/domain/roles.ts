export const ROLES = ["viewer", "assistant", "coach", "admin", "owner"] as const;
export type Role = (typeof ROLES)[number];

const RANK: Record<Role, number> = {
  viewer: 0,
  assistant: 1,
  coach: 2,
  admin: 3,
  owner: 4,
};

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function roleAtLeast(role: Role, minimum: Role): boolean {
  return RANK[role] >= RANK[minimum];
}

export const DISCIPLINES = [
  "cross_country",
  "track_running",
  "hurdles",
  "relay",
  "long_jump",
  "triple_jump",
  "high_jump",
  "pole_vault",
  "shot_put",
  "discus",
  "javelin",
] as const;

export type Discipline = (typeof DISCIPLINES)[number];

export const EVENT_CATEGORIES = ["running", "field", "relay"] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export function isDiscipline(value: string): value is Discipline {
  return (DISCIPLINES as readonly string[]).includes(value);
}

export function isEventCategory(value: string): value is EventCategory {
  return (EVENT_CATEGORIES as readonly string[]).includes(value);
}

export function categoryForDiscipline(discipline: Discipline): EventCategory {
  if (discipline === "relay") return "relay";
  if (
    discipline === "cross_country" ||
    discipline === "track_running" ||
    discipline === "hurdles"
  ) {
    return "running";
  }
  return "field";
}
