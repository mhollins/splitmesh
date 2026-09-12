import type { Db } from "./db/index.ts";
import type { EventBus } from "./realtime/bus.ts";

export type Clock = { now(): number };

export type AppContext = {
  db: Db;
  clock: Clock;
  sessionSecret: string;
  bus: EventBus;
};

export const COOKIE_NAME = "splitmesh_session";
