import { afterEach, describe, expect, it } from "vitest";
import { api, createHarness, register } from "../helpers.ts";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance | undefined;

afterEach(async () => {
  if (app) {
    await app.close();
    app = undefined;
  }
});

describe("authentication", () => {
  it("registers and returns the current user", async () => {
    const harness = await createHarness();
    app = harness.app;
    const { cookie } = await register(app, { email: "a@test.local", displayName: "Avery" });
    const me = await api(app, cookie, "GET", "/api/me");
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe("a@test.local");
  });

  it("rejects unauthenticated team creation", async () => {
    const harness = await createHarness();
    app = harness.app;
    const res = await app.inject({ method: "POST", url: "/api/teams", payload: { name: "Lincoln" } });
    expect(res.statusCode).toBe(401);
  });

  it("rejects short passwords", async () => {
    const harness = await createHarness();
    app = harness.app;
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "a@test.local", password: "short", displayName: "A" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("teams and authorization", () => {
  it("creates a team with the caller as owner and lets another user join", async () => {
    const harness = await createHarness();
    app = harness.app;
    const a = await register(app, { email: "a@test.local", displayName: "A" });
    const b = await register(app, { email: "b@test.local", displayName: "B" });
    const created = await api(app, a.cookie, "POST", "/api/teams", { name: "Lincoln XC" });
    expect(created.statusCode).toBe(200);
    const team = created.json().team;
    expect(team.members.some((m: { role: string }) => m.role === "owner")).toBe(true);

    const joined = await api(app, b.cookie, "POST", "/api/teams/join", { inviteCode: team.inviteCode });
    expect(joined.statusCode).toBe(200);
    expect(joined.json().team.members).toHaveLength(2);
  });

  it("forbids outsiders from adding athletes", async () => {
    const harness = await createHarness();
    app = harness.app;
    const a = await register(app, { email: "a@test.local", displayName: "A" });
    const stranger = await register(app, { email: "x@test.local", displayName: "X" });
    const team = (await api(app, a.cookie, "POST", "/api/teams", { name: "Lincoln XC" })).json().team;
    const res = await api(app, stranger.cookie, "POST", `/api/teams/${team.id}/athletes`, {
      firstName: "Maya",
      lastName: "Chen",
      gender: "girls",
      gradeLevel: "high_school",
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("roster, meets, and events", () => {
  it("creates athletes, a meet, and a running event with timing points", async () => {
    const harness = await createHarness();
    app = harness.app;
    const a = await register(app, { email: "a@test.local", displayName: "A" });
    const team = (await api(app, a.cookie, "POST", "/api/teams", { name: "Lincoln XC" })).json().team;
    const athlete = (
      await api(app, a.cookie, "POST", `/api/teams/${team.id}/athletes`, {
        firstName: "Maya",
        lastName: "Chen",
        gender: "girls",
        gradeLevel: "high_school",
      })
    ).json().athlete;
    expect(athlete.lastName).toBe("Chen");
    expect(athlete.gender).toBe("girls");
    expect(athlete.gradeLevel).toBe("high_school");

    const meet = (
      await api(app, a.cookie, "POST", `/api/teams/${team.id}/meets`, {
        name: "Invite",
        startsOn: "2026-09-12",
      })
    ).json().meet;
    const event = (
      await api(app, a.cookie, "POST", `/api/meets/${meet.id}/events`, {
        name: "Varsity 5K",
        distanceMeters: 5000,
      })
    ).json().event;
    expect(event.category).toBe("running");
    expect(event.timingPoints.map((p: { name: string }) => p.name)).toEqual([
      "Mile 1",
      "Mile 2",
      "Finish",
    ]);

    const withEntries = (
      await api(app, a.cookie, "POST", `/api/events/${event.id}/entries`, {
        athleteIds: [athlete.id],
        targetTimeMs: 1_140_000,
      })
    ).json().event;
    expect(withEntries.entries).toHaveLength(1);
  });
});
