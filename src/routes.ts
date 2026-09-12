import type { FastifyInstance, FastifyRequest } from "fastify";
import { COOKIE_NAME, type AppContext } from "./appContext.ts";
import { requireUser, setSessionCookie } from "./http/sessionCookies.ts";
import { getUser, authenticateUser, registerUser } from "./services/users.ts";
import {
  adminDeleteTeam,
  adminUpdateTeam,
  listAllTeams,
  listCoaches,
  updateCoach,
} from "./services/admin.ts";
import { createTeam, deleteTeam, joinTeam, listTeamsForUser, requireTeam, updateTeam } from "./services/teams.ts";
import { addAthlete, deleteAthlete, listAthletes, updateAthlete } from "./services/roster.ts";
import { deleteManualRecord, upsertManualRecord } from "./services/records.ts";
import {
  addEntries,
  completeEvent,
  createEvent,
  createMeet,
  deleteMeet,
  getMeet,
  listMeets,
  loadEvent,
  removeEntry,
  setEntryTarget,
  startEvent,
  updateMeet,
} from "./services/meets.ts";
import { buildLiveState, getLiveState, listEventLog, recordObservation, retractObservation } from "./services/live.ts";
import { requireEventAccess } from "./services/access.ts";
import { unauthorized } from "./http/errors.ts";

function uid(request: FastifyRequest, ctx: AppContext): string {
  return requireUser(request, ctx);
}

export async function registerRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get("/api/health", async () => ({ ok: true, name: "SplitMesh" }));

  app.post("/api/auth/register", async (request, reply) => {
    const body = request.body as { email?: string; password?: string; displayName?: string };
    const user = await registerUser(ctx, {
      email: body.email ?? "",
      password: body.password ?? "",
      displayName: body.displayName ?? "",
    });
    setSessionCookie(reply, ctx, user.id);
    return { user };
  });

  app.post("/api/auth/login", async (request, reply) => {
    const body = request.body as { email?: string; password?: string };
    const user = await authenticateUser(ctx, {
      email: body.email ?? "",
      password: body.password ?? "",
    });
    setSessionCookie(reply, ctx, user.id);
    return { user };
  });

  app.post("/api/auth/logout", async (_request, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: "/" });
    return { ok: true };
  });

  app.get("/api/me", async (request) => {
    const userId = uid(request, ctx);
    const user = getUser(ctx, userId);
    if (!user) throw unauthorized();
    return { user, teams: listTeamsForUser(ctx, userId) };
  });

  app.get("/api/admin/users", async (request) => {
    const userId = uid(request, ctx);
    return { users: listCoaches(ctx, userId) };
  });

  app.patch("/api/admin/users/:userId", async (request) => {
    const actorId = uid(request, ctx);
    const { userId } = request.params as { userId: string };
    const body = request.body as { displayName?: string; isPlatformAdmin?: boolean };
    return { user: updateCoach(ctx, actorId, userId, body) };
  });

  app.get("/api/admin/teams", async (request) => {
    const userId = uid(request, ctx);
    return { teams: listAllTeams(ctx, userId) };
  });

  app.patch("/api/admin/teams/:teamId", async (request) => {
    const userId = uid(request, ctx);
    const { teamId } = request.params as { teamId: string };
    const body = request.body as { name?: string };
    return { team: adminUpdateTeam(ctx, userId, teamId, body.name ?? "") };
  });

  app.delete("/api/admin/teams/:teamId", async (request) => {
    const userId = uid(request, ctx);
    const { teamId } = request.params as { teamId: string };
    return adminDeleteTeam(ctx, userId, teamId);
  });

  app.post("/api/teams", async (request) => {
    const userId = uid(request, ctx);
    const body = request.body as { name?: string };
    const team = createTeam(ctx, userId, body.name ?? "");
    return { team };
  });

  app.post("/api/teams/join", async (request) => {
    const userId = uid(request, ctx);
    const body = request.body as { inviteCode?: string };
    const team = joinTeam(ctx, userId, body.inviteCode ?? "");
    return { team };
  });

  app.get("/api/teams/:teamId", async (request) => {
    const userId = uid(request, ctx);
    const { teamId } = request.params as { teamId: string };
    return { team: requireTeam(ctx, userId, teamId) };
  });

  app.patch("/api/teams/:teamId", async (request) => {
    const userId = uid(request, ctx);
    const { teamId } = request.params as { teamId: string };
    const body = request.body as { name?: string };
    return { team: updateTeam(ctx, userId, teamId, body.name ?? "") };
  });

  app.delete("/api/teams/:teamId", async (request) => {
    const userId = uid(request, ctx);
    const { teamId } = request.params as { teamId: string };
    return deleteTeam(ctx, userId, teamId);
  });

  app.get("/api/teams/:teamId/athletes", async (request) => {
    const userId = uid(request, ctx);
    const { teamId } = request.params as { teamId: string };
    return { athletes: listAthletes(ctx, userId, teamId) };
  });

  app.post("/api/teams/:teamId/athletes", async (request) => {
    const userId = uid(request, ctx);
    const { teamId } = request.params as { teamId: string };
    const body = request.body as {
      firstName?: string;
      lastName?: string;
      gender?: string;
      gradeLevel?: string;
      graduationYear?: number;
    };
    const athlete = addAthlete(ctx, userId, teamId, {
      firstName: body.firstName ?? "",
      lastName: body.lastName ?? "",
      gender: body.gender,
      gradeLevel: body.gradeLevel,
      graduationYear: body.graduationYear,
    });
    return { athlete };
  });

  app.get("/api/teams/:teamId/meets", async (request) => {
    const userId = uid(request, ctx);
    const { teamId } = request.params as { teamId: string };
    return { meets: listMeets(ctx, userId, teamId) };
  });

  app.post("/api/teams/:teamId/meets", async (request) => {
    const userId = uid(request, ctx);
    const { teamId } = request.params as { teamId: string };
    const body = request.body as { name?: string; startsOn?: string; location?: string };
    const meet = createMeet(ctx, userId, teamId, {
      name: body.name ?? "",
      startsOn: body.startsOn ?? "",
      location: body.location,
    });
    return { meet };
  });

  app.put("/api/athletes/:athleteId/records", async (request) => {
    const userId = uid(request, ctx);
    const { athleteId } = request.params as { athleteId: string };
    const body = request.body as { distanceMeters?: number; markValueMs?: number; discipline?: string };
    return {
      records: upsertManualRecord(ctx, userId, athleteId, {
        distanceMeters: body.distanceMeters ?? 0,
        markValueMs: body.markValueMs ?? 0,
        discipline: body.discipline,
      }),
    };
  });

  app.delete("/api/athletes/:athleteId/records/:recordId", async (request) => {
    const userId = uid(request, ctx);
    const { athleteId, recordId } = request.params as { athleteId: string; recordId: string };
    return { records: deleteManualRecord(ctx, userId, athleteId, recordId) };
  });

  app.patch("/api/athletes/:athleteId", async (request) => {
    const userId = uid(request, ctx);
    const { athleteId } = request.params as { athleteId: string };
    const body = request.body as {
      firstName?: string;
      lastName?: string;
      gender?: string;
      gradeLevel?: string;
      graduationYear?: number | null;
    };
    return { athlete: updateAthlete(ctx, userId, athleteId, body) };
  });

  app.delete("/api/athletes/:athleteId", async (request) => {
    const userId = uid(request, ctx);
    const { athleteId } = request.params as { athleteId: string };
    return deleteAthlete(ctx, userId, athleteId);
  });

  app.get("/api/meets/:meetId", async (request) => {
    const userId = uid(request, ctx);
    const { meetId } = request.params as { meetId: string };
    return { meet: getMeet(ctx, userId, meetId) };
  });

  app.patch("/api/meets/:meetId", async (request) => {
    const userId = uid(request, ctx);
    const { meetId } = request.params as { meetId: string };
    const body = request.body as { name?: string; startsOn?: string; location?: string | null };
    return { meet: updateMeet(ctx, userId, meetId, body) };
  });

  app.delete("/api/meets/:meetId", async (request) => {
    const userId = uid(request, ctx);
    const { meetId } = request.params as { meetId: string };
    return deleteMeet(ctx, userId, meetId);
  });

  app.post("/api/meets/:meetId/events", async (request) => {
    const userId = uid(request, ctx);
    const { meetId } = request.params as { meetId: string };
    const body = request.body as {
      name?: string;
      discipline?: string;
      distanceMeters?: number;
      timingPoints?: { name: string; distanceMeters: number }[];
    };
    const event = createEvent(ctx, userId, meetId, {
      name: body.name ?? "",
      discipline: body.discipline,
      distanceMeters: body.distanceMeters ?? 0,
      timingPoints: body.timingPoints,
    });
    return { event };
  });

  app.get("/api/events/:eventId", async (request) => {
    const userId = uid(request, ctx);
    const { eventId } = request.params as { eventId: string };
    requireEventAccess(ctx, userId, eventId, "viewer");
    return { event: loadEvent(ctx, eventId) };
  });

  app.post("/api/events/:eventId/entries", async (request) => {
    const userId = uid(request, ctx);
    const { eventId } = request.params as { eventId: string };
    const body = request.body as { athleteIds?: string[]; targetTimeMs?: number | null };
    const event = addEntries(ctx, userId, eventId, {
      athleteIds: body.athleteIds ?? [],
      targetTimeMs: body.targetTimeMs,
    });
    return { event };
  });

  app.patch("/api/events/:eventId/entries/:athleteId", async (request) => {
    const userId = uid(request, ctx);
    const { eventId, athleteId } = request.params as { eventId: string; athleteId: string };
    const body = request.body as { targetTimeMs?: number | null };
    const event = setEntryTarget(ctx, userId, eventId, athleteId, body.targetTimeMs ?? null);
    return { event };
  });

  app.delete("/api/events/:eventId/entries/:athleteId", async (request) => {
    const userId = uid(request, ctx);
    const { eventId, athleteId } = request.params as { eventId: string; athleteId: string };
    return { event: removeEntry(ctx, userId, eventId, athleteId) };
  });

  app.post("/api/events/:eventId/start", async (request) => {
    const userId = uid(request, ctx);
    const { eventId } = request.params as { eventId: string };
    return { event: startEvent(ctx, userId, eventId) };
  });

  app.post("/api/events/:eventId/complete", async (request) => {
    const userId = uid(request, ctx);
    const { eventId } = request.params as { eventId: string };
    return { event: completeEvent(ctx, userId, eventId) };
  });

  app.get("/api/events/:eventId/state", async (request) => {
    const userId = uid(request, ctx);
    const { eventId } = request.params as { eventId: string };
    return { state: getLiveState(ctx, userId, eventId) };
  });

  app.get("/api/events/:eventId/log", async (request) => {
    const userId = uid(request, ctx);
    const { eventId } = request.params as { eventId: string };
    const since = Number((request.query as { since?: string }).since ?? 0) || 0;
    return listEventLog(ctx, userId, eventId, since);
  });

  app.post("/api/events/:eventId/observations", async (request) => {
    const userId = uid(request, ctx);
    const { eventId } = request.params as { eventId: string };
    const body = request.body as {
      athleteId?: string;
      timingPointId?: string;
      idempotencyKey?: string;
      clientObservedAt?: number;
    };
    const result = recordObservation(ctx, userId, eventId, {
      athleteId: body.athleteId ?? "",
      timingPointId: body.timingPointId ?? "",
      idempotencyKey: body.idempotencyKey ?? "",
      clientObservedAt: body.clientObservedAt,
    });
    return {
      observation: {
        id: result.observation.id,
        role: result.observation.role,
        athleteId: result.observation.athlete_id,
        timingPointId: result.observation.timing_point_id,
        observedAt: result.observation.observed_at,
        conflictsWithId: result.observation.conflicts_with_id,
        duplicate: result.duplicate,
      },
      seq: result.seq,
    };
  });

  app.post("/api/observations/:observationId/retract", async (request) => {
    const userId = uid(request, ctx);
    const { observationId } = request.params as { observationId: string };
    const result = retractObservation(ctx, userId, observationId);
    return {
      observation: {
        id: result.observation.id,
        role: result.observation.role,
      },
      seq: result.seq,
    };
  });

  app.get("/api/events/:eventId/stream", async (request, reply) => {
    const userId = uid(request, ctx);
    const { eventId } = request.params as { eventId: string };
    requireEventAccess(ctx, userId, eventId, "viewer");

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const send = () => {
      try {
        const state = buildLiveState(ctx, eventId);
        reply.raw.write(`id: ${state.seq}\n`);
        reply.raw.write(`event: state\n`);
        reply.raw.write(`data: ${JSON.stringify(state)}\n\n`);
      } catch {
        reply.raw.end();
      }
    };

    send();
    const unsub = ctx.bus.subscribe(eventId, () => send());
    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(`: ping\n\n`);
      } catch {
        cleanup();
      }
    }, 15000);

    const cleanup = () => {
      clearInterval(heartbeat);
      unsub();
      try {
        reply.raw.end();
      } catch {
        // already closed
      }
    };
    request.raw.on("close", cleanup);
    request.raw.on("aborted", cleanup);
  });
}
