import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { migrate3200Splits } from "../../src/db/index.ts";
import { api, createHarness, register } from "../helpers.ts";

let app: FastifyInstance | undefined;

afterEach(async () => {
  if (app) {
    await app.close();
    app = undefined;
  }
});

describe("event types", () => {
  it("seeds a 3200m type with 1 Mile and finish", async () => {
    const harness = await createHarness();
    app = harness.app;
    const a = await register(app, { email: "a@test.local", displayName: "A" });
    const team = (await api(app, a.cookie, "POST", "/api/teams", { name: "Lincoln XC" })).json().team;
    const types = (await api(app, a.cookie, "GET", `/api/teams/${team.id}/event-types`)).json().eventTypes;
    const threeTwo = types.find((type: { name: string }) => type.name === "3200m");
    expect(threeTwo.splits.map((split: { name: string; distanceMeters: number }) => [split.name, split.distanceMeters])).toEqual([
      ["1 Mile", 1609],
      ["Finish", 3200],
    ]);
  });

  it("creates a meet event from an event type", async () => {
    const harness = await createHarness();
    app = harness.app;
    const a = await register(app, { email: "a@test.local", displayName: "A" });
    const team = (await api(app, a.cookie, "POST", "/api/teams", { name: "Lincoln XC" })).json().team;
    const types = (await api(app, a.cookie, "GET", `/api/teams/${team.id}/event-types`)).json().eventTypes;
    const threeTwo = types.find((type: { name: string }) => type.name === "3200m");
    const meet = (
      await api(app, a.cookie, "POST", `/api/teams/${team.id}/meets`, {
        name: "Invite",
        startsOn: "2026-09-12",
      })
    ).json().meet;
    const created = (
      await api(app, a.cookie, "POST", `/api/meets/${meet.id}/events`, {
        eventTypeId: threeTwo.id,
        name: "Varsity 3200",
      })
    ).json().event;
    expect(created.distanceMeters).toBe(3200);
    expect(created.timingPoints.map((point: { name: string }) => point.name)).toEqual(["1 Mile", "Finish"]);
  });

  it("moves 3200m 1000m observations onto 1 Mile and drops 2000m", async () => {
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
    const meet = (
      await api(app, a.cookie, "POST", `/api/teams/${team.id}/meets`, {
        name: "Invite",
        startsOn: "2026-09-12",
      })
    ).json().meet;
    const event = (
      await api(app, a.cookie, "POST", `/api/meets/${meet.id}/events`, {
        name: "3200m",
        distanceMeters: 3200,
        timingPoints: [
          { name: "1000m", distanceMeters: 1000 },
          { name: "2000m", distanceMeters: 2000 },
          { name: "Finish", distanceMeters: 3200 },
        ],
      })
    ).json().event;
    await api(app, a.cookie, "POST", `/api/events/${event.id}/entries`, { athleteIds: [athlete.id] });
    await api(app, a.cookie, "POST", `/api/events/${event.id}/start`);
    const thousand = event.timingPoints.find((point: { name: string }) => point.name === "1000m");
    await api(app, a.cookie, "POST", `/api/events/${event.id}/observations`, {
      athleteId: athlete.id,
      timingPointId: thousand.id,
      idempotencyKey: "k1",
    });

    migrate3200Splits(app.ctx.db);
    const loaded = (await api(app, a.cookie, "GET", `/api/events/${event.id}`)).json().event;
    expect(loaded.timingPoints.map((point: { name: string; distanceMeters: number }) => [point.name, point.distanceMeters])).toEqual([
      ["1 Mile", 1609],
      ["Finish", 3200],
    ]);
    const state = (await api(app, a.cookie, "GET", `/api/events/${event.id}/state`)).json().state;
    const row = state.athletes.find((item: { athleteId: string }) => item.athleteId === athlete.id);
    expect(row.summary.splits[0].timingPointName).toBe("1 Mile");
  });
});
