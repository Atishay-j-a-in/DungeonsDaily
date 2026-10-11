import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { connectMongo, closeMongo } from "./db/mongo.js";
import { initSentry } from "./observability/sentry.js";

async function main(): Promise<void> {
  initSentry();
  await connectMongo().catch((err) => {
    console.warn("[db] Mongo connection failed — using in-memory store:", err.message);
  });

  const app = createApp();
  const server = app.listen(env.port, "0.0.0.0", () => {
    console.log(`[api] DungeonsDaily API listening on :${env.port}`);
    console.log(`[api] health: http://localhost:${env.port}/api/v1/health`);
  });

  const shutdown = async (signal: string) => {
    console.log(`[api] received ${signal}, shutting down...`);
    server.close(async () => {
      await closeMongo().catch(() => undefined);
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[api] fatal startup error:", err);
  process.exit(1);
});
