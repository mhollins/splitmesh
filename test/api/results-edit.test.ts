import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { api, createHarness, setupLiveRace } from "../helpers.ts";

let app: FastifyInstance | undefined;

afterEach(async () => {
  if (app) {
    await app.close();
    app = undefined;
  }
});

describe("editing completed results", () => {
  it("corrects an official time, promotes a conflict, and discards the extra mark", async () => {
    const harness = await createHarness();
    app = harness.app;
    const { clock } = harness;
    const { a, b, maya, event } = await setupLiveRace(app);
    const mile1 = event.timingPoints.find((p: { name: string }) => p.name === "Mile 1");
    clock.advance(360_000);
    const first = await api(app, a.cookie, "POST", `/api/events/${event.id}/observations`, {
      athleteId: maya.id,
      timingPointId: mile1.id,
      idempotencyKey: "a-tap",
    });
    const second = await api(app, b.cookie, "POST", `/api/events/${event.id}/observations`, {
      athleteId: maya.id,
      timingPointId: mile1.id,
      idempotencyKey: "b-tap",
    });
    await api(app, a.cookie, "POST", `/api/events/${event.id}/complete`);

    const officialId = first.json().observation.role === "primary" ? first.json().observation.id : second.json().observation.id;
    const conflictId = first.json().observation.role === "conflict" ? first.json().observation.id : second.json().observation.id;

    const corrected = await api(app, a.cookie, "PATCH", `/api/observations/${officialId}`, { elapsedMs: 370_000 });
    expect(corrected.statusCode).toBe(200);

    const promoted = await api(app, a.cookie, "POST", `/api/observations/${conflictId}/promote`);
    expect(promoted.statusCode).toBe(200);
    expect(promoted.json().observation.role).toBe("primary");

    const discarded = await api(app, a.cookie, "POST", `/api/observations/${officialId}/retract`);
    expect(discarded.statusCode).toBe(200);

    const state = (await api(app, a.cookie, "GET", `/api/events/${event.id}/state`)).json().state;
    const athlete = state.athletes.find((row: { athleteId: string }) => row.athleteId === maya.id);
    expect(athlete.summary.splits).toHaveLength(1);
    expect(athlete.summary.splits[0].elapsedMs).toBe(360_000);
    expect(athlete.summary.conflicts).toHaveLength(0);
  });

  it("adds a missing split on a completed event using elapsed time", async () => {
    const harness = await createHarness();
    app = harness.app;
    const { a, maya, event } = await setupLiveRace(app);
    await api(app, a.cookie, "POST", `/api/events/${event.id}/complete`);
    const mile1 = event.timingPoints.find((p: { name: string }) => p.name === "Mile 1");
    const added = await api(app, a.cookie, "POST", `/api/events/${event.id}/observations`, {
      athleteId: maya.id,
      timingPointId: mile1.id,
      idempotencyKey: "manual",
      elapsedMs: 365_000,
    });
    expect(added.statusCode).toBe(200);
    const state = (await api(app, a.cookie, "GET", `/api/events/${event.id}/state`)).json().state;
    const athlete = state.athletes.find((row: { athleteId: string }) => row.athleteId === maya.id);
    expect(athlete.summary.splits[0].elapsedMs).toBe(365_000);
  });
});
