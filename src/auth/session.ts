import { createHmac, timingSafeEqual } from "node:crypto";
import { unauthorized } from "../http/errors.ts";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

export type SessionPayload = { userId: string; exp: number };

export function signSession(userId: string, secret: string, now: number): string {
  const payload = Buffer.from(JSON.stringify({ userId, exp: now + SESSION_TTL_MS })).toString(
    "base64url",
  );
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function readSession(token: string | undefined, secret: string, now: number): SessionPayload {
  if (!token) throw unauthorized();
  const [payload, sig] = token.split(".");
  if (!payload || !sig) throw unauthorized();
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw unauthorized();
  let data: SessionPayload;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionPayload;
  } catch {
    throw unauthorized();
  }
  if (!data.userId || data.exp < now) throw unauthorized("Session expired");
  return data;
}
