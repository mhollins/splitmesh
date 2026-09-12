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

async function ownerTeam() {
  const harness = await createHarness();
  app = harness.app;
  const owner = await register(app, { email: "owner@test.local", displayName: "Owner" });
  const coach = await register(app, { email: "coach@test.local", displayName: "Coach" });
  const stranger = await register(app, { email: "x@test.local", displayName: "X" });
  const team = (await api(app, owner.cookie, "POST", "/api/teams", { name: "Lincoln XC" })).json().team;
  await api(app, coach.cookie, "POST", "/api/teams/join", { inviteCode: team.inviteCode });
  return { owner, coach, stranger, team };
}

describe("update and delete teams", () => {
  it("lets the owner rename a team", async () => {
    const { owner, team } = await ownerTeam();
    const res = await api(app!, owner.cookie, "PATCH", `/api/teams/${team.id}`, { name: "Lincoln Track" });
    expect(res.statusCode).toBe(200);
    expect(res.json().team.name).toBe("Lincoln Track");
  });

  it("forbids a joined coach from renaming or deleting the team", async () => {
    const { coach, team } = await ownerTeam();
    const renamed = await api(app!, coach.cookie, "PATCH", `/api/teams/${team.id}`, { name: "Hijack" });
    expect(renamed.statusCode).toBe(403);
    const deleted = await api(app!, coach.cookie, "DELETE", `/api/teams/${team.id}`);
    expect(deleted.statusCode).toBe(403);
  });

  it("lets the owner delete a team and its nested records", async () => {
    const { owner, team } = await ownerTeam();
    const athlete = (
      await api(app!, owner.cookie, "POST", `/api/teams/${team.id}/athletes`, {
        firstName: "Maya",
        lastName: "Chen",
        gender: "girls",
        gradeLevel: "high_school",
      })
    ).json().athlete;
    const meet = (
      await api(app!, owner.cookie, "POST", `/api/teams/${team.id}/meets`, {
        name: "Invite",
        startsOn: "2026-09-12",
      })
    ).json().meet;
    await api(app!, owner.cookie, "POST", `/api/meets/${meet.id}/events`, {
      name: "5K",
      distanceMeters: 5000,
    });

    const deleted = await api(app!, owner.cookie, "DELETE", `/api/teams/${team.id}`);
    expect(deleted.statusCode).toBe(200);

    expect((await api(app!, owner.cookie, "GET", `/api/teams/${team.id}`)).statusCode).toBe(404);
    expect((await api(app!, owner.cookie, "GET", `/api/meets/${meet.id}`)).statusCode).toBe(404);
    const leftover = app!.ctx.db
      .prepare(`SELECT COUNT(*) AS n FROM athletes WHERE id = ?`)
      .get(athlete.id) as { n: number };
    expect(leftover.n).toBe(0);
  });

  it("rejects an empty team name", async () => {
    const { owner, team } = await ownerTeam();
    const res = await api(app!, owner.cookie, "PATCH", `/api/teams/${team.id}`, { name: "   " });
    expect(res.statusCode).toBe(400);
  });
});

describe("update and delete athletes", () => {
  it("lets a coach rename an athlete", async () => {
    const { coach, team } = await ownerTeam();
    const athlete = (
      await api(app!, coach.cookie, "POST", `/api/teams/${team.id}/athletes`, {
        firstName: "Maya",
        lastName: "Chen",
        gender: "girls",
        gradeLevel: "high_school",
      })
    ).json().athlete;
    const res = await api(app!, coach.cookie, "PATCH", `/api/athletes/${athlete.id}`, {
      firstName: "Maya",
      lastName: "Chen-Ortiz",
      gender: "girls",
      gradeLevel: "elementary",
      graduationYear: 2028,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().athlete.lastName).toBe("Chen-Ortiz");
    expect(res.json().athlete.graduationYear).toBe(2028);
    expect(res.json().athlete.gender).toBe("girls");
    expect(res.json().athlete.gradeLevel).toBe("elementary");
  });

  it("lets a coach delete an athlete who already has race data", async () => {
    const { owner, coach, team } = await ownerTeam();
    const athlete = (
      await api(app!, owner.cookie, "POST", `/api/teams/${team.id}/athletes`, {
        firstName: "Maya",
        lastName: "Chen",
        gender: "girls",
        gradeLevel: "high_school",
      })
    ).json().athlete;
    const meet = (
      await api(app!, owner.cookie, "POST", `/api/teams/${team.id}/meets`, {
        name: "Invite",
        startsOn: "2026-09-12",
      })
    ).json().meet;
    const event = (
      await api(app!, owner.cookie, "POST", `/api/meets/${meet.id}/events`, {
        name: "5K",
        distanceMeters: 5000,
      })
    ).json().event;
    await api(app!, owner.cookie, "POST", `/api/events/${event.id}/entries`, { athleteIds: [athlete.id] });
    await api(app!, owner.cookie, "POST", `/api/events/${event.id}/start`);
    const finish = event.timingPoints.find((p: { isFinish: boolean }) => p.isFinish);
    await api(app!, owner.cookie, "POST", `/api/events/${event.id}/observations`, {
      athleteId: athlete.id,
      timingPointId: finish.id,
      idempotencyKey: "maya-finish",
    });

    const deleted = await api(app!, coach.cookie, "DELETE", `/api/athletes/${athlete.id}`);
    expect(deleted.statusCode).toBe(200);
    const roster = await api(app!, owner.cookie, "GET", `/api/teams/${team.id}/athletes`);
    expect(roster.json().athletes).toHaveLength(0);
    const live = (await api(app!, owner.cookie, "GET", `/api/events/${event.id}/state`)).json().state;
    expect(live.athletes).toHaveLength(0);
  });

  it("rejects an invalid gender", async () => {
    const { coach, team } = await ownerTeam();
    const res = await api(app!, coach.cookie, "POST", `/api/teams/${team.id}/athletes`, {
      firstName: "Maya",
      lastName: "Chen",
      gender: "mixed",
      gradeLevel: "high_school",
    });
    expect(res.statusCode).toBe(400);
  });

  it("forbids an outsider from updating an athlete", async () => {
    const { owner, stranger, team } = await ownerTeam();
    const athlete = (
      await api(app!, owner.cookie, "POST", `/api/teams/${team.id}/athletes`, {
        firstName: "Maya",
        lastName: "Chen",
        gender: "girls",
        gradeLevel: "high_school",
      })
    ).json().athlete;
    const res = await api(app!, stranger.cookie, "PATCH", `/api/athletes/${athlete.id}`, {
      firstName: "Nope",
      lastName: "Chen",
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("update and delete meets", () => {
  it("lets a coach update meet details", async () => {
    const { coach, team } = await ownerTeam();
    const meet = (
      await api(app!, coach.cookie, "POST", `/api/teams/${team.id}/meets`, {
        name: "Invite",
        startsOn: "2026-09-12",
      })
    ).json().meet;
    const res = await api(app!, coach.cookie, "PATCH", `/api/meets/${meet.id}`, {
      name: "Conference",
      startsOn: "2026-10-04",
      location: "Riverside Park",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().meet.name).toBe("Conference");
    expect(res.json().meet.startsOn).toBe("2026-10-04");
    expect(res.json().meet.location).toBe("Riverside Park");
  });

  it("lets a coach delete a meet and its events", async () => {
    const { owner, coach, team } = await ownerTeam();
    const meet = (
      await api(app!, owner.cookie, "POST", `/api/teams/${team.id}/meets`, {
        name: "Invite",
        startsOn: "2026-09-12",
      })
    ).json().meet;
    const event = (
      await api(app!, owner.cookie, "POST", `/api/meets/${meet.id}/events`, {
        name: "5K",
        distanceMeters: 5000,
      })
    ).json().event;

    const deleted = await api(app!, coach.cookie, "DELETE", `/api/meets/${meet.id}`);
    expect(deleted.statusCode).toBe(200);
    expect((await api(app!, owner.cookie, "GET", `/api/meets/${meet.id}`)).statusCode).toBe(404);
    expect((await api(app!, owner.cookie, "GET", `/api/events/${event.id}`)).statusCode).toBe(404);
  });

  it("lets a coach remove an athlete from an event roster", async () => {
    const { owner, coach, team } = await ownerTeam();
    const maya = (
      await api(app!, owner.cookie, "POST", `/api/teams/${team.id}/athletes`, {
        firstName: "Maya",
        lastName: "Chen",
        gender: "girls",
        gradeLevel: "high_school",
      })
    ).json().athlete;
    const jordan = (
      await api(app!, owner.cookie, "POST", `/api/teams/${team.id}/athletes`, {
        firstName: "Jordan",
        lastName: "Blake",
        gender: "boys",
        gradeLevel: "junior_high",
      })
    ).json().athlete;
    const meet = (
      await api(app!, owner.cookie, "POST", `/api/teams/${team.id}/meets`, {
        name: "Invite",
        startsOn: "2026-09-12",
      })
    ).json().meet;
    const event = (
      await api(app!, owner.cookie, "POST", `/api/meets/${meet.id}/events`, {
        name: "5K",
        distanceMeters: 5000,
      })
    ).json().event;
    await api(app!, owner.cookie, "POST", `/api/events/${event.id}/entries`, {
      athleteIds: [maya.id, jordan.id],
    });

    const removed = await api(app!, coach.cookie, "DELETE", `/api/events/${event.id}/entries/${jordan.id}`);
    expect(removed.statusCode).toBe(200);
    expect(removed.json().event.entries.map((e: { athleteId: string }) => e.athleteId)).toEqual([maya.id]);
  });

  it("forbids an outsider from deleting a meet", async () => {
    const { owner, stranger, team } = await ownerTeam();
    const meet = (
      await api(app!, owner.cookie, "POST", `/api/teams/${team.id}/meets`, {
        name: "Invite",
        startsOn: "2026-09-12",
      })
    ).json().meet;
    const res = await api(app!, stranger.cookie, "DELETE", `/api/meets/${meet.id}`);
    expect(res.statusCode).toBe(403);
  });
});
