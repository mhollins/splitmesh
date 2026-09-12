import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { buildApp } from "../src/app.ts";

export type TestClock = {
  t: number;
  now(): number;
  advance(ms: number): void;
};

export async function createHarness() {
  const clock: TestClock = {
    t: Date.parse("2026-09-12T15:00:00Z"),
    now() {
      return this.t;
    },
    advance(ms: number) {
      this.t += ms;
    },
  };
  const app = await buildApp({ dbPath: ":memory:", clock, sessionSecret: "test-secret" });
  await app.ready();
  return { app, clock };
}

export function cookieOf(res: LightMyRequestResponse): string {
  const raw = res.headers["set-cookie"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") throw new Error("expected session cookie");
  return value.split(";")[0];
}

export async function register(
  app: FastifyInstance,
  input: { email: string; password?: string; displayName: string },
) {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email: input.email, password: input.password ?? "password123", displayName: input.displayName },
  });
  if (res.statusCode >= 400) {
    throw new Error(`register failed ${res.statusCode}: ${res.body}`);
  }
  return { cookie: cookieOf(res), body: res.json() };
}

export async function login(app: FastifyInstance, email: string, password = "password123") {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password },
  });
  if (res.statusCode >= 400) {
    throw new Error(`login failed ${res.statusCode}: ${res.body}`);
  }
  return { cookie: cookieOf(res), body: res.json() };
}

export async function api(
  app: FastifyInstance,
  cookie: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  payload?: object,
): Promise<LightMyRequestResponse> {
  return app.inject({
    method,
    url,
    headers: { cookie },
    payload,
  });
}

export async function setupLiveRace(app: FastifyInstance) {
  const a = await register(app, { email: "coach-a@test.local", displayName: "Coach A" });
  const b = await register(app, { email: "coach-b@test.local", displayName: "Coach B" });
  const teamRes = await api(app, a.cookie, "POST", "/api/teams", { name: "Lincoln XC" });
  const team = teamRes.json().team;
  await api(app, b.cookie, "POST", "/api/teams/join", { inviteCode: team.inviteCode });

  const mayaRes = await api(app, a.cookie, "POST", `/api/teams/${team.id}/athletes`, {
    firstName: "Maya",
    lastName: "Chen",
    gender: "girls",
    gradeLevel: "high_school",
  });
  const jordanRes = await api(app, a.cookie, "POST", `/api/teams/${team.id}/athletes`, {
    firstName: "Jordan",
    lastName: "Blake",
    gender: "boys",
    gradeLevel: "high_school",
  });
  const maya = mayaRes.json().athlete;
  const jordan = jordanRes.json().athlete;

  const meetRes = await api(app, a.cookie, "POST", `/api/teams/${team.id}/meets`, {
    name: "Early Season Invite",
    startsOn: "2026-09-12",
    location: "Riverside Park",
  });
  const meet = meetRes.json().meet;
  const eventRes = await api(app, a.cookie, "POST", `/api/meets/${meet.id}/events`, {
    name: "Varsity Boys 5K",
    discipline: "cross_country",
    distanceMeters: 5000,
  });
  const event = eventRes.json().event;
  await api(app, a.cookie, "POST", `/api/events/${event.id}/entries`, {
    athleteIds: [maya.id, jordan.id],
    targetTimeMs: 1_140_000,
  });
  await api(app, a.cookie, "POST", `/api/events/${event.id}/start`);
  const loaded = (await api(app, a.cookie, "GET", `/api/events/${event.id}`)).json().event;
  return { a, b, team, maya, jordan, meet, event: loaded };
}

export async function* parseSse(res: Response) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const dataLine = chunk.split("\n").find((line) => line.startsWith("data: "));
        if (dataLine) yield JSON.parse(dataLine.slice(6));
      }
    }
  } catch (error) {
    if ((error as { name?: string }).name === "AbortError") return;
    throw error;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // already released
    }
  }
}
