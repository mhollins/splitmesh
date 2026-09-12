import path from "node:path";

export function isProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "production";
}

export function resolveDbPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.DATABASE_PATH) return env.DATABASE_PATH;
  if (env.RAILWAY_VOLUME_MOUNT_PATH) {
    return path.join(env.RAILWAY_VOLUME_MOUNT_PATH, "splitmesh.db");
  }
  return "data/splitmesh.db";
}

export function resolveSessionSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.SESSION_SECRET;
  if (isProduction(env)) {
    if (!secret || secret === "dev-splitmesh-secret") {
      throw new Error("SESSION_SECRET must be set to a strong random value in production");
    }
    return secret;
  }
  return secret || "dev-splitmesh-secret";
}
