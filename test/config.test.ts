import { describe, expect, it } from "vitest";
import { initialAdminEmail, isProduction, resolveDbPath, resolveSessionSecret } from "../src/config.ts";

describe("hosting config", () => {
  it("uses DATABASE_PATH when set", () => {
    expect(resolveDbPath({ DATABASE_PATH: "/data/splitmesh.db" })).toBe("/data/splitmesh.db");
  });

  it("stores SQLite on a Railway volume when no DATABASE_PATH is set", () => {
    expect(resolveDbPath({ RAILWAY_VOLUME_MOUNT_PATH: "/data" })).toBe("/data/splitmesh.db");
  });

  it("defaults the initial administrator to marchollins@gmail.com", () => {
    expect(initialAdminEmail({})).toBe("marchollins@gmail.com");
  });

  it("requires a real SESSION_SECRET in production", () => {
    expect(() => resolveSessionSecret({ NODE_ENV: "production" })).toThrow(/SESSION_SECRET/);
    expect(isProduction({ NODE_ENV: "production" })).toBe(true);
  });
});
