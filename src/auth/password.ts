import { promisify } from "node:util";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const scryptAsync = promisify(scrypt);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hex] = stored.split(":");
  if (!salt || !hex) return false;
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hex, "hex");
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
