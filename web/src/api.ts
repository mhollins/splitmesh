export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...options,
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
    credentials: "include",
    body: options.body,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.code ?? "ERROR", data?.error?.message ?? res.statusText);
  }
  return data as T;
}

export const api = {
  me: () => request<{ user: User; teams: TeamSummary[] }>("/api/me"),
  register: (body: { email: string; password: string; displayName: string }) =>
    request<{ user: User }>("/api/auth/register", { method: "POST", body: JSON.stringify(body) }),
  login: (body: { email: string; password: string }) =>
    request<{ user: User }>("/api/auth/login", { method: "POST", body: JSON.stringify(body) }),
  logout: () => request("/api/auth/logout", { method: "POST", body: JSON.stringify({}) }),
  adminUsers: () => request<{ users: AdminUser[] }>("/api/admin/users"),
  updateCoach: (id: string, body: { displayName?: string; isPlatformAdmin?: boolean }) =>
    request<{ user: User }>(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  adminTeams: () => request<{ teams: Team[] }>("/api/admin/teams"),
  adminUpdateTeam: (id: string, name: string) =>
    request<{ team: Team }>(`/api/admin/teams/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  adminDeleteTeam: (id: string) =>
    request<{ ok: boolean }>(`/api/admin/teams/${id}`, { method: "DELETE", body: JSON.stringify({}) }),
  createTeam: (name: string) =>
    request<{ team: Team }>("/api/teams", { method: "POST", body: JSON.stringify({ name }) }),
  joinTeam: (inviteCode: string) =>
    request<{ team: Team }>("/api/teams/join", { method: "POST", body: JSON.stringify({ inviteCode }) }),
  team: (id: string) => request<{ team: Team }>(`/api/teams/${id}`),
  updateTeam: (id: string, name: string) =>
    request<{ team: Team }>(`/api/teams/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  deleteTeam: (id: string) =>
    request<{ ok: boolean }>(`/api/teams/${id}`, { method: "DELETE", body: JSON.stringify({}) }),
  athletes: (teamId: string) => request<{ athletes: Athlete[] }>(`/api/teams/${teamId}/athletes`),
  addAthlete: (
    teamId: string,
    body: { firstName: string; lastName: string; gender: string; gradeLevel: string; graduationYear?: number },
  ) =>
    request<{ athlete: Athlete }>(`/api/teams/${teamId}/athletes`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateAthlete: (
    id: string,
    body: { firstName: string; lastName: string; gender: string; gradeLevel: string; graduationYear?: number | null },
  ) => request<{ athlete: Athlete }>(`/api/athletes/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteAthlete: (id: string) =>
    request<{ ok: boolean }>(`/api/athletes/${id}`, { method: "DELETE", body: JSON.stringify({}) }),
  upsertRecord: (
    athleteId: string,
    body: { distanceMeters: number; markValueMs: number; discipline?: string },
  ) =>
    request<{ records: AthleteRecordMark[] }>(`/api/athletes/${athleteId}/records`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deleteRecord: (athleteId: string, recordId: string) =>
    request<{ records: AthleteRecordMark[] }>(`/api/athletes/${athleteId}/records/${recordId}`, {
      method: "DELETE",
      body: JSON.stringify({}),
    }),
  meets: (teamId: string) => request<{ meets: Meet[] }>(`/api/teams/${teamId}/meets`),
  createMeet: (teamId: string, body: { name: string; startsOn: string; location?: string }) =>
    request<{ meet: Meet }>(`/api/teams/${teamId}/meets`, { method: "POST", body: JSON.stringify(body) }),
  meet: (id: string) => request<{ meet: MeetDetail }>(`/api/meets/${id}`),
  updateMeet: (id: string, body: { name: string; startsOn: string; location?: string | null }) =>
    request<{ meet: MeetDetail }>(`/api/meets/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteMeet: (id: string) =>
    request<{ ok: boolean }>(`/api/meets/${id}`, { method: "DELETE", body: JSON.stringify({}) }),
  createEvent: (meetId: string, body: { name: string; distanceMeters: number; discipline?: string }) =>
    request<{ event: EventDetail }>(`/api/meets/${meetId}/events`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  event: (id: string) => request<{ event: EventDetail }>(`/api/events/${id}`),
  addEntries: (eventId: string, athleteIds: string[], targetTimeMs?: number | null) =>
    request<{ event: EventDetail }>(`/api/events/${eventId}/entries`, {
      method: "POST",
      body: JSON.stringify({ athleteIds, targetTimeMs }),
    }),
  setEntryTarget: (eventId: string, athleteId: string, targetTimeMs: number | null) =>
    request<{ event: EventDetail }>(`/api/events/${eventId}/entries/${athleteId}`, {
      method: "PATCH",
      body: JSON.stringify({ targetTimeMs }),
    }),
  removeEntry: (eventId: string, athleteId: string) =>
    request<{ event: EventDetail }>(`/api/events/${eventId}/entries/${athleteId}`, {
      method: "DELETE",
      body: JSON.stringify({}),
    }),
  startEvent: (eventId: string) =>
    request<{ event: EventDetail }>(`/api/events/${eventId}/start`, { method: "POST", body: JSON.stringify({}) }),
  completeEvent: (eventId: string) =>
    request<{ event: EventDetail }>(`/api/events/${eventId}/complete`, { method: "POST", body: JSON.stringify({}) }),
  state: (eventId: string) => request<{ state: LiveState }>(`/api/events/${eventId}/state`),
  record: (
    eventId: string,
    body: { athleteId: string; timingPointId: string; idempotencyKey: string; clientObservedAt?: number },
  ) => request(`/api/events/${eventId}/observations`, { method: "POST", body: JSON.stringify(body) }),
  retract: (observationId: string) =>
    request(`/api/observations/${observationId}/retract`, { method: "POST", body: JSON.stringify({}) }),
};

export type User = { id: string; email: string; displayName: string; isPlatformAdmin: boolean };
export type AdminUser = User & {
  createdAt: number;
  teams: { teamId: string; teamName: string; role: string }[];
};
export type TeamSummary = { id: string; name: string; inviteCode: string; role: string };
export type Team = TeamSummary & {
  members: { id: string; email: string; displayName: string; role: string }[];
  currentSeason: { id: string; name: string } | null;
};
export type AthleteRecordMark = {
  id: string;
  discipline: string;
  distanceMeters: number | null;
  markType: string;
  markValueMs: number;
  source: string;
};
export type Athlete = {
  id: string;
  firstName: string;
  lastName: string;
  gender: string;
  gradeLevel: string;
  graduationYear: number | null;
  records?: AthleteRecordMark[];
};
export type Meet = { id: string; name: string; startsOn: string; location: string | null; status: string };
export type MeetDetail = Meet & {
  teamId: string;
  events: {
    id: string;
    name: string;
    distanceMeters: number | null;
    status: string;
    startedAt: number | null;
    entryCount: number;
  }[];
};
export type EventDetail = {
  id: string;
  meetId: string;
  teamId: string;
  name: string;
  category: string;
  discipline: string;
  distanceMeters: number | null;
  status: string;
  startedAt: number | null;
  timingPoints: { id: string; name: string; distanceMeters: number; sortOrder: number; isFinish: boolean }[];
  entries: {
    id: string;
    athleteId: string;
    firstName: string;
    lastName: string;
    gender: string;
    gradeLevel: string;
    targetTimeMs: number | null;
  }[];
};
export type LiveState = {
  seq: number;
  event: {
    id: string;
    name: string;
    meetId: string;
    meetName: string;
    status: string;
    startedAt: number | null;
    completedAt: number | null;
    distanceMeters: number | null;
  };
  timingPoints: { id: string; name: string; distanceMeters: number; isFinish: boolean }[];
  athletes: LiveAthlete[];
};
export type LiveAthlete = {
  athleteId: string;
  firstName: string;
  lastName: string;
  gender: string;
  gradeLevel: string;
  bib: string | null;
  targetTimeMs: number | null;
  personalRecordMs: number | null;
  seasonBestMs: number | null;
  status: string;
  summary: {
    elapsedMs: number | null;
    finished: boolean;
    projectedFinishMs: number | null;
    vsTargetMs: number | null;
    onPersonalRecordPace: boolean;
    onSeasonBestPace: boolean;
    splits: {
      observationId: string;
      timingPointId: string;
      timingPointName: string;
      elapsedMs: number;
      splitMs: number;
      paceSecPerMile: number | null;
      vsTargetMs: number | null;
    }[];
    conflicts: { observationId: string; timingPointId: string; timingPointName: string }[];
  };
};
