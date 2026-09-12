import { buildApp } from "./app.ts";

const port = Number(process.env.PORT ?? 3000);
const dbPath = process.env.DATABASE_PATH ?? "data/splitmesh.db";
const sessionSecret = process.env.SESSION_SECRET ?? "dev-splitmesh-secret";

const app = await buildApp({
  dbPath,
  sessionSecret,
  logger: true,
});

await app.listen({ port, host: "0.0.0.0" });
app.log.info(`SplitMesh API listening on http://localhost:${port}`);
