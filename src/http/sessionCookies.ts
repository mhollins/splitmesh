import type { FastifyReply, FastifyRequest } from "fastify";
import { COOKIE_NAME, type AppContext } from "../appContext.ts";
import { readSession, signSession } from "../auth/session.ts";
import { unauthorized } from "./errors.ts";

export function requireUser(request: FastifyRequest, ctx: AppContext): string {
  const token = (request.cookies ?? {})[COOKIE_NAME];
  if (!token) throw unauthorized();
  return readSession(token, ctx.sessionSecret, ctx.clock.now()).userId;
}

export function setSessionCookie(reply: FastifyReply, ctx: AppContext, userId: string): void {
  const token = signSession(userId, ctx.sessionSecret, ctx.clock.now());
  reply.setCookie(COOKIE_NAME, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: Boolean(ctx.cookieSecure),
  });
}
