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

describe("schools", () => {
  it("bootstraps a school and adds another team without making the admin a member", async () => {
    const harness = await createHarness();
    app = harness.app;
    const owner = await register(app, { email: "owner@test.local", displayName: "Owner" });
    const coach = await register(app, { email: "coach@test.local", displayName: "Coach" });
    const created = await api(app, owner.cookie, "POST", "/api/teams", {
      name: "Lincoln XC",
      schoolName: "Lincoln High",
    });
    expect(created.statusCode).toBe(200);
    const team = created.json().team;
    expect(team.schoolName).toBe("Lincoln High");
    const me = (await api(app, owner.cookie, "GET", "/api/me")).json();
    expect(me.schools).toEqual([{ id: team.schoolId, name: "Lincoln High", role: "school_admin" }]);

    const second = await api(app, owner.cookie, "POST", `/api/schools/${team.schoolId}/teams`, { name: "Lincoln Track" });
    expect(second.statusCode).toBe(200);
    expect(second.json().team.members).toEqual([]);
    const start = await api(app, owner.cookie, "POST", `/api/teams/${second.json().team.id}/meets`, {
      name: "Opener",
      startsOn: "2026-09-12",
    });
    expect(start.statusCode).toBe(403);

    const assigned = await api(app, owner.cookie, "PUT", `/api/teams/${second.json().team.id}/members`, {
      email: "owner@test.local",
      role: "coach",
    });
    expect(assigned.statusCode).toBe(200);
    const joined = await api(app, coach.cookie, "POST", "/api/teams/join", { inviteCode: team.inviteCode });
    expect(joined.statusCode).toBe(200);
    const coachMe = (await api(app, coach.cookie, "GET", "/api/me")).json();
    expect(coachMe.schools).toEqual([]);
    expect(coachMe.teams[0].schoolId).toBe(team.schoolId);
  });

  it("keeps an athlete when a team is deleted and hides the other team's meet on the record book", async () => {
    const harness = await createHarness();
    app = harness.app;
    const owner = await register(app, { email: "owner@test.local", displayName: "Owner" });
    const xc = (
      await api(app, owner.cookie, "POST", "/api/teams", { name: "Lincoln XC", schoolName: "Lincoln High" })
    ).json().team;
    const track = (
      await api(app, owner.cookie, "POST", `/api/schools/${xc.schoolId}/teams`, { name: "Lincoln Track" })
    ).json().team;
    await api(app, owner.cookie, "PUT", `/api/teams/${track.id}/members`, { email: "owner@test.local", role: "coach" });
    const athlete = (
      await api(app, owner.cookie, "POST", `/api/teams/${xc.id}/athletes`, {
        firstName: "Maya",
        lastName: "Chen",
        gender: "girls",
        gradeLevel: "high_school",
      })
    ).json().athlete;
    const assigned = await api(app, owner.cookie, "POST", `/api/schools/${xc.schoolId}/athletes/${athlete.id}/teams`, {
      teamId: track.id,
    });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json().athlete.teams).toHaveLength(2);

    const xcMeet = (
      await api(app, owner.cookie, "POST", `/api/teams/${xc.id}/meets`, { name: "XC Invite", startsOn: "2026-09-12" })
    ).json().meet;
    const trackMeet = (
      await api(app, owner.cookie, "POST", `/api/teams/${track.id}/meets`, { name: "Track Invite", startsOn: "2026-09-20" })
    ).json().meet;
    const xcEvent = (
      await api(app, owner.cookie, "POST", `/api/meets/${xcMeet.id}/events`, {
        name: "5K",
        discipline: "cross_country",
        distanceMeters: 5000,
      })
    ).json().event;
    const trackEvent = (
      await api(app, owner.cookie, "POST", `/api/meets/${trackMeet.id}/events`, {
        name: "5K",
        discipline: "cross_country",
        distanceMeters: 5000,
      })
    ).json().event;
    await api(app, owner.cookie, "POST", `/api/events/${xcEvent.id}/entries`, { athleteIds: [athlete.id] });
    await api(app, owner.cookie, "POST", `/api/events/${trackEvent.id}/entries`, { athleteIds: [athlete.id] });
    await api(app, owner.cookie, "POST", `/api/events/${xcEvent.id}/start`);
    await api(app, owner.cookie, "POST", `/api/events/${trackEvent.id}/start`);
    await api(app, owner.cookie, "POST", `/api/events/${xcEvent.id}/observations`, {
      athleteId: athlete.id,
      timingPointId: xcEvent.timingPoints.find((point: { isFinish: boolean }) => point.isFinish).id,
      idempotencyKey: "xc-finish",
      elapsedMs: 1_180_000,
    });
    await api(app, owner.cookie, "POST", `/api/events/${trackEvent.id}/observations`, {
      athleteId: athlete.id,
      timingPointId: trackEvent.timingPoints.find((point: { isFinish: boolean }) => point.isFinish).id,
      idempotencyKey: "track-finish",
      elapsedMs: 1_150_000,
    });

    const viewer = await register(app, { email: "viewer@test.local", displayName: "Viewer" });
    await api(app, owner.cookie, "PUT", `/api/teams/${xc.id}/members`, { email: "viewer@test.local", role: "viewer" });
    const redacted = (await api(app, viewer.cookie, "GET", `/api/schools/${xc.schoolId}/records`)).json().records;
    expect(redacted).toHaveLength(1);
    expect(redacted[0].markValueMs).toBeLessThanOrEqual(1_180_000);
    expect(redacted[0].meetName).toBeUndefined();
    expect(redacted[0].teamName).toBeUndefined();

    const full = (await api(app, owner.cookie, "GET", `/api/schools/${xc.schoolId}/records`)).json().records;
    expect(full[0].meetName).toBeTruthy();

    const removed = await api(app, owner.cookie, "DELETE", `/api/teams/${track.id}`);
    expect(removed.statusCode).toBe(200);
    const still = app!.ctx.db.prepare(`SELECT COUNT(*) AS n FROM athletes WHERE id = ?`).get(athlete.id) as { n: number };
    expect(still.n).toBe(1);
    const book = (await api(app, owner.cookie, "GET", `/api/schools/${xc.schoolId}/records`)).json().records;
    expect(book[0].teamId).toBe(xc.id);
  });
});
