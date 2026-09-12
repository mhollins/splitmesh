import { buildApp } from "./app.ts";
import { isProduction, resolveDbPath, resolveSessionSecret } from "./config.ts";

const production = isProduction();
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

const app = await buildApp({
  dbPath: resolveDbPath(),
  sessionSecret: resolveSessionSecret(),
  logger: true,
  trustProxy: production,
  cookieSecure: production,
});

await app.listen({ port, host });
app.log.info(`SplitMesh listening on ${host}:${port}`);
