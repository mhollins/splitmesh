import { buildApp } from "./app.ts";
import { registerUser } from "./services/users.ts";
import { createTeam, joinTeam } from "./services/teams.ts";
import { addAthlete } from "./services/roster.ts";
import { addEntries, completeEvent, createEvent, createMeet, setEntryTarget, startEvent } from "./services/meets.ts";
import { recordObservation } from "./services/live.ts";

const dbPath = process.env.DATABASE_PATH ?? "data/splitmesh.db";

type MutableClock = { t: number; now: () => number };

async function seed() {
  const now = Date.now();
  const clock: MutableClock = { t: now - 7 * 24 * 60 * 60 * 1000, now: () => clock.t };
  const app = await buildApp({
    dbPath,
    sessionSecret: process.env.SESSION_SECRET ?? "dev-splitmesh-secret",
    clock,
  });
  const ctx = app.ctx;

  const existing = ctx.db.prepare(`SELECT id FROM users WHERE email = ?`).get("coach-a@splitmesh.local");
  if (existing) {
    console.log("SplitMesh demo data already present.");
    await app.close();
    return;
  }

  const coachA = await registerUser(ctx, {
    email: "coach-a@splitmesh.local",
    password: "password123",
    displayName: "Coach Avery",
  });
  const coachB = await registerUser(ctx, {
    email: "coach-b@splitmesh.local",
    password: "password123",
    displayName: "Coach Blake",
  });

  const team = createTeam(ctx, coachA.id, "Lincoln XC");
  joinTeam(ctx, coachB.id, team.inviteCode);

  const roster = [
    ["Maya", "Chen", "girls", "high_school"],
    ["Jordan", "Blake", "boys", "high_school"],
    ["Sam", "Rivera", "boys", "junior_high"],
    ["Avery", "Cole", "girls", "high_school"],
    ["Riley", "Nguyen", "girls", "junior_high"],
    ["Chris", "Patel", "boys", "elementary"],
    ["Taylor", "Brooks", "girls", "elementary"],
    ["Quinn", "Morales", "boys", "high_school"],
  ] as const;

  const athletes = roster.map(([firstName, lastName, gender, gradeLevel]) =>
    addAthlete(ctx, coachA.id, team.id, { firstName, lastName, gender, gradeLevel, graduationYear: 2027 }),
  );
  const maya = athletes[0];
  if (!maya) throw new Error("seed: roster empty");

  const pastMeet = createMeet(ctx, coachA.id, team.id, {
    name: "August Time Trial",
    startsOn: "2026-08-15",
    location: "Lincoln HS",
  });
  const pastEvent = createEvent(ctx, coachA.id, pastMeet.id, {
    name: "5K Time Trial",
    discipline: "cross_country",
    distanceMeters: 5000,
  });
  addEntries(ctx, coachA.id, pastEvent.id, { athleteIds: [maya.id] });
  startEvent(ctx, coachA.id, pastEvent.id);
  const finishPoint = pastEvent.timingPoints.find((p: { isFinish: boolean }) => p.isFinish);
  if (!finishPoint) throw new Error("seed: missing finish point");
  clock.t += 1_152_000; // 19:12.0
  recordObservation(ctx, coachA.id, pastEvent.id, {
    athleteId: maya.id,
    timingPointId: finishPoint.id,
    idempotencyKey: "seed-maya-pr",
  });
  completeEvent(ctx, coachA.id, pastEvent.id);

  clock.t = now;
  const meet = createMeet(ctx, coachA.id, team.id, {
    name: "Early Season Invite",
    startsOn: new Date(now).toISOString().slice(0, 10),
    location: "Riverside Park",
  });
  const event = createEvent(ctx, coachA.id, meet.id, {
    name: "Varsity Boys 5K",
    discipline: "cross_country",
    distanceMeters: 5000,
  });
  addEntries(ctx, coachA.id, event.id, {
    athleteIds: athletes.map((a) => a.id),
  });
  setEntryTarget(ctx, coachA.id, event.id, maya.id, 1_140_000); // 19:00.0
  startEvent(ctx, coachA.id, event.id);

  console.log("SplitMesh demo data ready.");
  console.log("  Coach A  coach-a@splitmesh.local / password123");
  console.log("  Coach B  coach-b@splitmesh.local / password123");
  console.log(`  Team     ${team.name}  invite ${team.inviteCode}`);
  console.log(`  Live     Varsity Boys 5K  (${event.id})`);
  await app.close();
}

await seed();
