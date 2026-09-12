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

describe("platform administrators", () => {
  it("promotes marchollins@gmail.com to administrator on register", async () => {
    const harness = await createHarness();
    app = harness.app;
    const admin = await register(app, {
      email: "marchollins@gmail.com",
      displayName: "Marc",
    });
    expect(admin.body.user.isPlatformAdmin).toBe(true);
    const me = await api(app, admin.cookie, "GET", "/api/me");
    expect(me.json().user.isPlatformAdmin).toBe(true);
  });

  it("does not make ordinary coaches platform admins", async () => {
    const harness = await createHarness();
    app = harness.app;
    const coach = await register(app, { email: "coach@test.local", displayName: "Coach" });
    expect(coach.body.user.isPlatformAdmin).toBe(false);
  });

  it("lets an admin list and edit coaches and teams", async () => {
    const harness = await createHarness();
    app = harness.app;
    const admin = await register(app, { email: "marchollins@gmail.com", displayName: "Marc" });
    const coach = await register(app, { email: "coach@test.local", displayName: "Avery" });
    const team = (await api(app, coach.cookie, "POST", "/api/teams", { name: "Lincoln XC" })).json().team;

    const users = await api(app, admin.cookie, "GET", "/api/admin/users");
    expect(users.statusCode).toBe(200);
    expect(users.json().users).toHaveLength(2);

    const renamed = await api(app, admin.cookie, "PATCH", `/api/admin/users/${coach.body.user.id}`, {
      displayName: "Coach Avery",
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().user.displayName).toBe("Coach Avery");

    const teams = await api(app, admin.cookie, "GET", "/api/admin/teams");
    expect(teams.json().teams.some((t: { name: string }) => t.name === "Lincoln XC")).toBe(true);

    const teamEdit = await api(app, admin.cookie, "PATCH", `/api/admin/teams/${team.id}`, {
      name: "Lincoln Track",
    });
    expect(teamEdit.json().team.name).toBe("Lincoln Track");
  });

  it("lets an admin grant admin to another coach but not remove the last admin", async () => {
    const harness = await createHarness();
    app = harness.app;
    const admin = await register(app, { email: "marchollins@gmail.com", displayName: "Marc" });
    const coach = await register(app, { email: "coach@test.local", displayName: "Avery" });

    const promoted = await api(app, admin.cookie, "PATCH", `/api/admin/users/${coach.body.user.id}`, {
      isPlatformAdmin: true,
    });
    expect(promoted.json().user.isPlatformAdmin).toBe(true);

    const demoteLast = await api(app, admin.cookie, "PATCH", `/api/admin/users/${admin.body.user.id}`, {
      isPlatformAdmin: false,
    });
    expect(demoteLast.statusCode).toBe(200);

    const blocked = await api(app, coach.cookie, "PATCH", `/api/admin/users/${coach.body.user.id}`, {
      isPlatformAdmin: false,
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe("LAST_ADMIN");
  });

  it("forbids a non-admin from using admin routes", async () => {
    const harness = await createHarness();
    app = harness.app;
    const coach = await register(app, { email: "coach@test.local", displayName: "Avery" });
    const res = await api(app, coach.cookie, "GET", "/api/admin/users");
    expect(res.statusCode).toBe(403);
  });

  it("lets an admin delete any team", async () => {
    const harness = await createHarness();
    app = harness.app;
    const admin = await register(app, { email: "marchollins@gmail.com", displayName: "Marc" });
    const coach = await register(app, { email: "coach@test.local", displayName: "Avery" });
    const team = (await api(app, coach.cookie, "POST", "/api/teams", { name: "Lincoln XC" })).json().team;
    const deleted = await api(app, admin.cookie, "DELETE", `/api/admin/teams/${team.id}`);
    expect(deleted.statusCode).toBe(200);
    expect((await api(app, coach.cookie, "GET", `/api/teams/${team.id}`)).statusCode).toBe(404);
  });
});
