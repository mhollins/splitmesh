import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { api, createHarness, register } from "../helpers.ts";

let app: FastifyInstance | undefined;

afterEach(async () => {
  if (app) {
    await app.close();
    app = undefined;
  }
});

describe("manual personal records", () => {
  it("lets a coach set a PR that appears on the live race", async () => {
    const harness = await createHarness();
    app = harness.app;
    const a = await register(app, { email: "a@test.local", displayName: "A" });
    const team = (await api(app, a.cookie, "POST", "/api/teams", { name: "Lincoln XC" })).json().team;
    const maya = (
      await api(app, a.cookie, "POST", `/api/teams/${team.id}/athletes`, {
        firstName: "Maya",
        lastName: "Chen",
        gender: "girls",
        gradeLevel: "high_school",
      })
    ).json().athlete;

    const saved = await api(app, a.cookie, "PUT", `/api/athletes/${maya.id}/records`, {
      distanceMeters: 5000,
      markValueMs: 1_152_000,
      discipline: "cross_country",
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().records[0].markValueMs).toBe(1_152_000);

    const roster = await api(app, a.cookie, "GET", `/api/teams/${team.id}/athletes`);
    expect(roster.json().athletes[0].records[0].markValueMs).toBe(1_152_000);

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
    await api(app, a.cookie, "POST", `/api/events/${event.id}/entries`, { athleteIds: [maya.id] });
    await api(app, a.cookie, "POST", `/api/events/${event.id}/start`);
    const state = (await api(app, a.cookie, "GET", `/api/events/${event.id}/state`)).json().state;
    const row = state.athletes.find((athlete: { athleteId: string }) => athlete.athleteId === maya.id);
    expect(row.personalRecordMs).toBe(1_152_000);
  });

  it("uses each athlete's PR as the event target when no target is supplied", async () => {
    const harness = await createHarness();
    app = harness.app;
    const a = await register(app, { email: "a@test.local", displayName: "A" });
    const team = (await api(app, a.cookie, "POST", "/api/teams", { name: "Lincoln XC" })).json().team;
    const maya = (
      await api(app, a.cookie, "POST", `/api/teams/${team.id}/athletes`, {
        firstName: "Maya",
        lastName: "Chen",
        gender: "girls",
        gradeLevel: "high_school",
      })
    ).json().athlete;
    const jordan = (
      await api(app, a.cookie, "POST", `/api/teams/${team.id}/athletes`, {
        firstName: "Jordan",
        lastName: "Blake",
        gender: "boys",
        gradeLevel: "high_school",
      })
    ).json().athlete;
    await api(app, a.cookie, "PUT", `/api/athletes/${maya.id}/records`, {
      distanceMeters: 5000,
      markValueMs: 1_152_000,
    });
    await api(app, a.cookie, "PUT", `/api/athletes/${jordan.id}/records`, {
      distanceMeters: 5000,
      markValueMs: 1_080_000,
    });
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
    const entered = (
      await api(app, a.cookie, "POST", `/api/events/${event.id}/entries`, {
        athleteIds: [maya.id, jordan.id],
      })
    ).json().event;
    const mayaEntry = entered.entries.find((row: { athleteId: string }) => row.athleteId === maya.id);
    const jordanEntry = entered.entries.find((row: { athleteId: string }) => row.athleteId === jordan.id);
    expect(mayaEntry.targetTimeMs).toBe(1_152_000);
    expect(jordanEntry.targetTimeMs).toBe(1_080_000);
  });

  it("keeps a faster manual PR when a slower race is recorded", async () => {
    const harness = await createHarness();
    app = harness.app;
    const { clock } = harness;
    const a = await register(app, { email: "a@test.local", displayName: "A" });
    const team = (await api(app, a.cookie, "POST", "/api/teams", { name: "Lincoln XC" })).json().team;
    const maya = (
      await api(app, a.cookie, "POST", `/api/teams/${team.id}/athletes`, {
        firstName: "Maya",
        lastName: "Chen",
        gender: "girls",
        gradeLevel: "high_school",
      })
    ).json().athlete;
    await api(app, a.cookie, "PUT", `/api/athletes/${maya.id}/records`, {
      distanceMeters: 5000,
      markValueMs: 1_140_000,
      discipline: "cross_country",
    });

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
    await api(app, a.cookie, "POST", `/api/events/${event.id}/entries`, { athleteIds: [maya.id] });
    await api(app, a.cookie, "POST", `/api/events/${event.id}/start`);
    clock.advance(1_200_000);
    const finish = event.timingPoints.find((p: { isFinish: boolean }) => p.isFinish);
    await api(app, a.cookie, "POST", `/api/events/${event.id}/observations`, {
      athleteId: maya.id,
      timingPointId: finish.id,
      idempotencyKey: "slower",
    });
    const state = (await api(app, a.cookie, "GET", `/api/events/${event.id}/state`)).json().state;
    const row = state.athletes.find((athlete: { athleteId: string }) => athlete.athleteId === maya.id);
    expect(row.personalRecordMs).toBe(1_140_000);
  });

  it("forbids an outsider from editing PRs", async () => {
    const harness = await createHarness();
    app = harness.app;
    const a = await register(app, { email: "a@test.local", displayName: "A" });
    const stranger = await register(app, { email: "x@test.local", displayName: "X" });
    const team = (await api(app, a.cookie, "POST", "/api/teams", { name: "Lincoln XC" })).json().team;
    const maya = (
      await api(app, a.cookie, "POST", `/api/teams/${team.id}/athletes`, {
        firstName: "Maya",
        lastName: "Chen",
        gender: "girls",
        gradeLevel: "high_school",
      })
    ).json().athlete;
    const res = await api(app, stranger.cookie, "PUT", `/api/athletes/${maya.id}/records`, {
      distanceMeters: 5000,
      markValueMs: 1_152_000,
    });
    expect(res.statusCode).toBe(403);
  });
});
