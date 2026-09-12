import type { AppContext } from "../appContext.ts";
import { hashPassword, verifyPassword } from "../auth/password.ts";
import { newId } from "../db/index.ts";
import { badRequest, unauthorized } from "../http/errors.ts";

export type User = {
  id: string;
  email: string;
  displayName: string;
};

function asUser(row: { id: string; email: string; display_name: string }): User {
  return { id: row.id, email: row.email, displayName: row.display_name };
}

export async function registerUser(
  ctx: AppContext,
  input: { email: string; password: string; displayName: string },
): Promise<User> {
  const email = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim();
  if (!email || !email.includes("@")) throw badRequest("Valid email is required");
  if (input.password.length < 8) throw badRequest("Password must be at least 8 characters");
  if (!displayName) throw badRequest("Name is required");

  const existing = ctx.db.prepare(`SELECT id FROM users WHERE email = ?`).get(email);
  if (existing) throw badRequest("Email already registered", "EMAIL_TAKEN");

  const user = {
    id: newId(),
    email,
    password_hash: await hashPassword(input.password),
    display_name: displayName,
    created_at: ctx.clock.now(),
  };
  ctx.db
    .prepare(
      `INSERT INTO users (id, email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(user.id, user.email, user.password_hash, user.display_name, user.created_at);
  return asUser(user);
}

export async function authenticateUser(
  ctx: AppContext,
  input: { email: string; password: string },
): Promise<User> {
  const email = input.email.trim().toLowerCase();
  const row = ctx.db
    .prepare(`SELECT id, email, password_hash, display_name FROM users WHERE email = ?`)
    .get(email) as
    | { id: string; email: string; password_hash: string; display_name: string }
    | undefined;
  if (!row || !(await verifyPassword(input.password, row.password_hash))) {
    throw unauthorized("Invalid email or password");
  }
  return asUser(row);
}

export function getUser(ctx: AppContext, userId: string): User | undefined {
  const row = ctx.db
    .prepare(`SELECT id, email, display_name FROM users WHERE id = ?`)
    .get(userId) as { id: string; email: string; display_name: string } | undefined;
  return row ? asUser(row) : undefined;
}
