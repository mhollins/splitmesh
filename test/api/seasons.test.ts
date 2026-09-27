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

describe("school-year seasons", () => {
  it("opens a new team in 26/27 when the clock is September 2026", async () => {
    const harness = await createHarness();
    app = harness.app;
    const coach = await register(app, { email: "coach@test.local", displayName: "Coach" });
    const team = (await api(app, coach.cookie, "POST", "/api/teams", { name: "Lincoln XC" })).json().team;
    expect(team.currentSeason).toMatchObject({
      name: "26/27",
      startsOn: "2026-06-01",
      endsOn: "2027-05-31",
    });
  });

  it("rolls to the next school year on June 1 and keeps the previous meets readable", async () => {
    const harness = await createHarness();
    app = harness.app;
    harness.clock.t = Date.parse("2026-05-31T22:00:00Z");
    const coach = await register(app, { email: "coach@test.local", displayName: "Coach" });
    const stranger = await register(app, { email: "stranger@test.local", displayName: "Stranger" });
    const team = (await api(app, coach.cookie, "POST", "/api/teams", { name: "Lincoln XC" })).json().team;
    expect(team.currentSeason.name).toBe("25/26");

    const meet = (
      await api(app, coach.cookie, "POST", `/api/teams/${team.id}/meets`, {
        name: "April Invite",
        startsOn: "2026-04-10",
      })
    ).json().meet;
    const created = await api(app, coach.cookie, "POST", `/api/meets/${meet.id}/events`, {
      name: "Varsity 5K",
      discipline: "cross_country",
      distanceMeters: 5000,
    });
    expect(created.statusCode).toBe(200);

    harness.clock.t = Date.parse("2026-06-01T01:00:00Z");
    const rolledRes = await api(app, coach.cookie, "GET", `/api/teams/${team.id}`);
    expect(rolledRes.statusCode, rolledRes.body).toBe(200);
    const rolled = rolledRes.json().team;
    expect(rolled.currentSeason.name).toBe("26/27");

    const seasons = (await api(app, coach.cookie, "GET", `/api/teams/${team.id}/seasons`)).json().seasons;
    expect(seasons.map((season: { name: string; isCurrent: boolean }) => [season.name, season.isCurrent])).toEqual([
      ["26/27", true],
      ["25/26", false],
    ]);

    const currentMeets = (await api(app, coach.cookie, "GET", `/api/teams/${team.id}/meets`)).json().meets;
    expect(currentMeets).toEqual([]);

    const previous = seasons.find((season: { name: string }) => season.name === "25/26");
    const pastMeets = (
      await api(app, coach.cookie, "GET", `/api/teams/${team.id}/meets?seasonId=${previous.id}`)
    ).json().meets;
    expect(pastMeets.map((row: { name: string }) => row.name)).toEqual(["April Invite"]);

    const blocked = await api(app, coach.cookie, "POST", `/api/meets/${meet.id}/events`, {
      name: "JV 5K",
      discipline: "cross_country",
      distanceMeters: 5000,
    });
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().error.message).toBe("Events can only be added in the current season");

    const pastDetail = (await api(app, coach.cookie, "GET", `/api/meets/${meet.id}`)).json().meet;
    expect(pastDetail.seasonName).toBe("25/26");
    expect(pastDetail.isCurrentSeason).toBe(false);
    expect(pastDetail.events).toHaveLength(1);

    const nextMeet = (
      await api(app, coach.cookie, "POST", `/api/teams/${team.id}/meets`, {
        name: "June Opener",
        startsOn: "2026-06-02",
      })
    ).json().meet;
    const nextDetail = (await api(app, coach.cookie, "GET", `/api/meets/${nextMeet.id}`)).json().meet;
    expect(nextDetail.seasonName).toBe("26/27");
    expect(nextDetail.isCurrentSeason).toBe(true);
    const added = await api(app, coach.cookie, "POST", `/api/meets/${nextMeet.id}/events`, {
      name: "Varsity 5K",
      discipline: "cross_country",
      distanceMeters: 5000,
    });
    expect(added.statusCode).toBe(200);

    const hidden = await api(app, stranger.cookie, "GET", `/api/teams/${team.id}/seasons`);
    expect(hidden.statusCode).toBe(403);
    const missing = await api(app, coach.cookie, "GET", `/api/teams/${team.id}/meets?seasonId=not-a-season`);
    expect(missing.statusCode).toBe(404);
  });
});
