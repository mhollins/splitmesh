import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import staticFiles from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { type AppContext, type Clock } from "./appContext.ts";
import { openDb } from "./db/index.ts";
import { HttpError } from "./http/errors.ts";
import { EventBus } from "./realtime/bus.ts";
import { registerRoutes } from "./routes.ts";

export type BuildOptions = {
  dbPath?: string;
  sessionSecret?: string;
  clock?: Clock;
  logger?: boolean;
};

export async function buildApp(options: BuildOptions = {}): Promise<FastifyInstance> {
  const db = openDb(options.dbPath ?? ":memory:");
  const ctx: AppContext = {
    db,
    clock: options.clock ?? { now: () => Date.now() },
    sessionSecret: options.sessionSecret ?? "dev-splitmesh-secret",
    bus: new EventBus(),
  };

  const app = Fastify({ logger: options.logger ?? false });
  await app.register(cookie);
  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  app.decorate("ctx", ctx);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message },
      });
    }
    const err = error as { statusCode?: number; message?: string };
    const status = err.statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send({
        error: { code: "BAD_REQUEST", message: err.message ?? "Bad request" },
      });
    }
    app.log.error(error);
    return reply.status(500).send({
      error: { code: "INTERNAL", message: "Internal server error" },
    });
  });

  app.addHook("onClose", (_instance, done) => {
    db.close();
    done();
  });

  await registerRoutes(app, ctx);

  const webDist = path.resolve(process.cwd(), "web/dist");
  if (fs.existsSync(webDist)) {
    await app.register(staticFiles, { root: webDist, prefix: "/" });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Not found" },
        });
      }
      return reply.sendFile("index.html");
    });
  }

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    ctx: AppContext;
  }
}
