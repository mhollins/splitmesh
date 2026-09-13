import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { api, createHarness, parseSse, setupLiveRace } from "../helpers.ts";

let app: FastifyInstance | undefined;

afterEach(async () => {
  if (app) {
    await app.close();
    app = undefined;
  }
}, 20_000);

describe("timing observations", () => {
  it("records a pass, computes elapsed time and split pace, and compares to target", async () => {
    const harness = await createHarness();
    app = harness.app;
    const { clock } = harness;
    const { a, maya, event } = await setupLiveRace(app);
    const mile1 = event.timingPoints.find((p: { name: string }) => p.name === "Mile 1");
    clock.advance(360_000);

    const recorded = await api(app, a.cookie, "POST", `/api/events/${event.id}/observations`, {
      athleteId: maya.id,
      timingPointId: mile1.id,
      idempotencyKey: "tap-1",
    });
    expect(recorded.statusCode).toBe(200);
    expect(recorded.json().observation.role).toBe("primary");

    const state = (await api(app, a.cookie, "GET", `/api/events/${event.id}/state`)).json().state;
    const athlete = state.athletes.find((row: { athleteId: string }) => row.athleteId === maya.id);
    expect(athlete.summary.splits).toHaveLength(1);
    expect(athlete.summary.splits[0].elapsedMs).toBe(360_000);
    expect(athlete.summary.splits[0].paceSecPerMile).toBeGreaterThan(0);
    expect(athlete.summary.vsTargetMs).not.toBeNull();
    expect(athlete.summary.projectedFinishMs).toBeGreaterThan(360_000);
  });

  it("is idempotent for the same key", async () => {
    const harness = await createHarness();
    app = harness.app;
    const { a, maya, event } = await setupLiveRace(app);
    const mile1 = event.timingPoints.find((p: { name: string }) => p.name === "Mile 1");
    const payload = { athleteId: maya.id, timingPointId: mile1.id, idempotencyKey: "same-key" };
    const first = await api(app, a.cookie, "POST", `/api/events/${event.id}/observations`, payload);
    const second = await api(app, a.cookie, "POST", `/api/events/${event.id}/observations`, payload);
    expect(second.statusCode).toBe(200);
    expect(second.json().observation.id).toBe(first.json().observation.id);
    expect(second.json().observation.duplicate).toBe(true);
    const count = app.ctx.db
      .prepare(`SELECT COUNT(*) AS n FROM timing_observations WHERE event_id = ?`)
      .get(event.id) as { n: number };
    expect(count.n).toBe(1);
  });

  it("keeps overlapping taps from two coaches as a visible conflict", async () => {
    const harness = await createHarness();
    app = harness.app;
    const { a, b, maya, event } = await setupLiveRace(app);
    const mile1 = event.timingPoints.find((p: { name: string }) => p.name === "Mile 1");

    const [first, second] = await Promise.all([
      api(app, a.cookie, "POST", `/api/events/${event.id}/observations`, {
        athleteId: maya.id,
        timingPointId: mile1.id,
        idempotencyKey: "a-tap",
      }),
      api(app, b.cookie, "POST", `/api/events/${event.id}/observations`, {
        athleteId: maya.id,
        timingPointId: mile1.id,
        idempotencyKey: "b-tap",
      }),
    ]);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const roles = [first.json().observation.role, second.json().observation.role].sort();
    expect(roles).toEqual(["conflict", "primary"]);

    const state = (await api(app, a.cookie, "GET", `/api/events/${event.id}/state`)).json().state;
    const athlete = state.athletes.find((row: { athleteId: string }) => row.athleteId === maya.id);
    expect(athlete.summary.splits).toHaveLength(1);
    expect(athlete.summary.conflicts).toHaveLength(1);
  });

  it("lets a coach retract an accidental tap", async () => {
    const harness = await createHarness();
    app = harness.app;
    const { a, maya, event } = await setupLiveRace(app);
    const mile1 = event.timingPoints.find((p: { name: string }) => p.name === "Mile 1");
    const recorded = await api(app, a.cookie, "POST", `/api/events/${event.id}/observations`, {
      athleteId: maya.id,
      timingPointId: mile1.id,
      idempotencyKey: "oops",
    });
    const id = recorded.json().observation.id;
    const retracted = await api(app, a.cookie, "POST", `/api/observations/${id}/retract`);
    expect(retracted.statusCode).toBe(200);
    const state = (await api(app, a.cookie, "GET", `/api/events/${event.id}/state`)).json().state;
    const athlete = state.athletes.find((row: { athleteId: string }) => row.athleteId === maya.id);
    expect(athlete.summary.splits).toHaveLength(0);
  });

  it("forbids a non-member from recording", async () => {
    const harness = await createHarness();
    app = harness.app;
    const { event, maya } = await setupLiveRace(app);
    const { register } = await import("../helpers.ts");
    const outsider = await register(app, { email: "outsider@test.local", displayName: "Out" });
    const mile1 = event.timingPoints.find((p: { name: string }) => p.name === "Mile 1");
    const res = await api(app, outsider.cookie, "POST", `/api/events/${event.id}/observations`, {
      athleteId: maya.id,
      timingPointId: mile1.id,
      idempotencyKey: "nope",
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects observations before the gun", async () => {
    const harness = await createHarness();
    app = harness.app;
    const a = await (await import("../helpers.ts")).register(app, {
      email: "a@test.local",
      displayName: "A",
    });
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
        name: "5K",
        distanceMeters: 5000,
      })
    ).json().event;
    await api(app, a.cookie, "POST", `/api/events/${event.id}/entries`, { athleteIds: [athlete.id] });
    const res = await api(app, a.cookie, "POST", `/api/events/${event.id}/observations`, {
      athleteId: athlete.id,
      timingPointId: event.timingPoints[0].id,
      idempotencyKey: "early",
    });
    expect(res.statusCode).toBe(409);
  });
});

describe("personal records and season bests", () => {
  it("exposes an existing PR on the live race and updates it after a faster finish", async () => {
    const harness = await createHarness();
    app = harness.app;
    const { clock } = harness;
    const { register } = await import("../helpers.ts");
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

    const pastMeet = (
      await api(app, a.cookie, "POST", `/api/teams/${team.id}/meets`, {
        name: "Time Trial",
        startsOn: "2026-08-15",
      })
    ).json().meet;
    const pastEvent = (
      await api(app, a.cookie, "POST", `/api/meets/${pastMeet.id}/events`, {
        name: "TT 5K",
        distanceMeters: 5000,
      })
    ).json().event;
    await api(app, a.cookie, "POST", `/api/events/${pastEvent.id}/entries`, { athleteIds: [maya.id] });
    await api(app, a.cookie, "POST", `/api/events/${pastEvent.id}/start`);
    clock.advance(1_152_000);
    const finish = pastEvent.timingPoints.find((p: { isFinish: boolean }) => p.isFinish);
    await api(app, a.cookie, "POST", `/api/events/${pastEvent.id}/observations`, {
      athleteId: maya.id,
      timingPointId: finish.id,
      idempotencyKey: "pr",
    });
    await api(app, a.cookie, "POST", `/api/events/${pastEvent.id}/complete`);

    const liveMeet = (
      await api(app, a.cookie, "POST", `/api/teams/${team.id}/meets`, {
        name: "Invite",
        startsOn: "2026-09-12",
      })
    ).json().meet;
    const liveEvent = (
      await api(app, a.cookie, "POST", `/api/meets/${liveMeet.id}/events`, {
        name: "Varsity 5K",
        distanceMeters: 5000,
      })
    ).json().event;
    await api(app, a.cookie, "POST", `/api/events/${liveEvent.id}/entries`, { athleteIds: [maya.id] });
    await api(app, a.cookie, "POST", `/api/events/${liveEvent.id}/start`);

    let state = (await api(app, a.cookie, "GET", `/api/events/${liveEvent.id}/state`)).json().state;
    let athlete = state.athletes.find((row: { athleteId: string }) => row.athleteId === maya.id);
    expect(athlete.personalRecordMs).toBe(1_152_000);
    expect(athlete.seasonBestMs).toBe(1_152_000);

    const liveFinish = liveEvent.timingPoints.find((p: { isFinish: boolean }) => p.isFinish);
    clock.advance(1_140_000);
    await api(app, a.cookie, "POST", `/api/events/${liveEvent.id}/observations`, {
      athleteId: maya.id,
      timingPointId: liveFinish.id,
      idempotencyKey: "faster",
    });
    state = (await api(app, a.cookie, "GET", `/api/events/${liveEvent.id}/state`)).json().state;
    athlete = state.athletes.find((row: { athleteId: string }) => row.athleteId === maya.id);
    expect(athlete.personalRecordMs).toBe(1_140_000);
    expect(athlete.summary.finished).toBe(true);
    expect(athlete.isNewPersonalRecord).toBe(true);
    expect(athlete.previousPersonalRecordMs).toBe(1_152_000);
    expect(athlete.prImprovementMs).toBe(12_000);
  });
});

describe("history after the race", () => {
  it("keeps performances after the event is completed", async () => {
    const harness = await createHarness();
    app = harness.app;
    const { clock } = harness;
    const { a, maya, event } = await setupLiveRace(app);
    const mile1 = event.timingPoints.find((p: { name: string }) => p.name === "Mile 1");
    clock.advance(360_000);
    await api(app, a.cookie, "POST", `/api/events/${event.id}/observations`, {
      athleteId: maya.id,
      timingPointId: mile1.id,
      idempotencyKey: "m1",
    });
    const completed = await api(app, a.cookie, "POST", `/api/events/${event.id}/complete`);
    expect(completed.statusCode).toBe(200);
    const blocked = await api(app, a.cookie, "POST", `/api/events/${event.id}/observations`, {
      athleteId: maya.id,
      timingPointId: event.timingPoints[1].id,
      idempotencyKey: "m2",
    });
    expect(blocked.statusCode).toBe(409);
    const state = (await api(app, a.cookie, "GET", `/api/events/${event.id}/state`)).json().state;
    const athlete = state.athletes.find((row: { athleteId: string }) => row.athleteId === maya.id);
    expect(athlete.summary.splits).toHaveLength(1);
    expect(state.event.status).toBe("completed");
  });
});

describe("pause, resume, and reset", () => {
  it("freezes the clock while paused and resumes without changing recorded splits", async () => {
    const harness = await createHarness();
    app = harness.app;
    const { clock } = harness;
    const { a, maya, event } = await setupLiveRace(app);
    const mile1 = event.timingPoints.find((p: { name: string }) => p.name === "Mile 1");
    clock.advance(60_000);
    await api(app, a.cookie, "POST", `/api/events/${event.id}/observations`, {
      athleteId: maya.id,
      timingPointId: mile1.id,
      idempotencyKey: "m1",
    });
    const paused = await api(app, a.cookie, "POST", `/api/events/${event.id}/pause`);
    expect(paused.statusCode).toBe(200);
    expect(paused.json().event.status).toBe("paused");
    clock.advance(120_000);
    const blocked = await api(app, a.cookie, "POST", `/api/events/${event.id}/observations`, {
      athleteId: maya.id,
      timingPointId: event.timingPoints[1].id,
      idempotencyKey: "during-pause",
    });
    expect(blocked.statusCode).toBe(409);
    const resumed = await api(app, a.cookie, "POST", `/api/events/${event.id}/start`);
    expect(resumed.json().event.status).toBe("live");
    const state = (await api(app, a.cookie, "GET", `/api/events/${event.id}/state`)).json().state;
    const athlete = state.athletes.find((row: { athleteId: string }) => row.athleteId === maya.id);
    expect(athlete.summary.splits[0].elapsedMs).toBe(60_000);
  });

  it("resets the clock to zero from pause and clears splits", async () => {
    const harness = await createHarness();
    app = harness.app;
    const { a, maya, event } = await setupLiveRace(app);
    const mile1 = event.timingPoints.find((p: { name: string }) => p.name === "Mile 1");
    await api(app, a.cookie, "POST", `/api/events/${event.id}/observations`, {
      athleteId: maya.id,
      timingPointId: mile1.id,
      idempotencyKey: "m1",
    });
    await api(app, a.cookie, "POST", `/api/events/${event.id}/pause`);
    const reset = await api(app, a.cookie, "POST", `/api/events/${event.id}/reset`);
    expect(reset.statusCode).toBe(200);
    expect(reset.json().event.status).toBe("upcoming");
    expect(reset.json().event.startedAt).toBeNull();
    const state = (await api(app, a.cookie, "GET", `/api/events/${event.id}/state`)).json().state;
    const athlete = state.athletes.find((row: { athleteId: string }) => row.athleteId === maya.id);
    expect(athlete.summary.splits).toHaveLength(0);
  });
});

describe("real-time fan-out and reconnect", () => {
  it("pushes Coach A's tap to Coach B and replays state after reconnect", async () => {
    const harness = await createHarness();
    app = harness.app;
    const { a, b, maya, event } = await setupLiveRace(app);
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("no address");
    const base = `http://127.0.0.1:${address.port}`;

    const coachBAbort = new AbortController();
    const stream = await fetch(`${base}/api/events/${event.id}/stream`, {
      headers: { cookie: b.cookie, accept: "text/event-stream" },
      signal: coachBAbort.signal,
    });
    expect(stream.ok).toBe(true);
    const iterator = parseSse(stream);
    const first = await iterator.next();
    expect(first.value.seq).toBeGreaterThanOrEqual(1);
    expect(first.value.athletes).toHaveLength(2);

    const mile1 = event.timingPoints.find((p: { name: string }) => p.name === "Mile 1");
    const posted = await fetch(`${base}/api/events/${event.id}/observations`, {
      method: "POST",
      headers: { cookie: a.cookie, "content-type": "application/json" },
      body: JSON.stringify({
        athleteId: maya.id,
        timingPointId: mile1.id,
        idempotencyKey: "live-1",
      }),
    });
    expect(posted.ok).toBe(true);

    const second = await iterator.next();
    const mayaState = second.value.athletes.find((row: { athleteId: string }) => row.athleteId === maya.id);
    expect(mayaState.summary.splits).toHaveLength(1);
    coachBAbort.abort();

    const mile2 = event.timingPoints.find((p: { name: string }) => p.name === "Mile 2");
    await fetch(`${base}/api/events/${event.id}/observations`, {
      method: "POST",
      headers: { cookie: b.cookie, "content-type": "application/json" },
      body: JSON.stringify({
        athleteId: maya.id,
        timingPointId: mile2.id,
        idempotencyKey: "live-2",
      }),
    });

    const coachAAbort = new AbortController();
    const replay = await fetch(`${base}/api/events/${event.id}/stream`, {
      headers: { cookie: a.cookie, accept: "text/event-stream" },
      signal: coachAAbort.signal,
    });
    const replayIter = parseSse(replay);
    const snapshot = await replayIter.next();
    const replayMaya = snapshot.value.athletes.find((row: { athleteId: string }) => row.athleteId === maya.id);
    expect(replayMaya.summary.splits).toHaveLength(2);
    const log = await fetch(`${base}/api/events/${event.id}/log?since=0`, {
      headers: { cookie: a.cookie },
    });
    const logBody = (await log.json()) as { entries: { type: string }[] };
    expect(logBody.entries.some((e) => e.type === "observation.recorded")).toBe(true);
    coachAAbort.abort();
  });
});
