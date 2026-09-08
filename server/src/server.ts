import { createServer } from "node:http";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { assertDatabaseReady, pool } from "./db.js";
import { SWEEP_INTERVAL, deleteExpiredSessions } from "./security/session.js";

try {
  await assertDatabaseReady();
  const app = await createApp(pool);
  const server = createServer(app);
  server.listen(config.port, () => console.log(`Banking App server listening on http://localhost:${config.port}`));

  async function sweepSessions(): Promise<void> {
    try {
      const removed = await deleteExpiredSessions(pool);
      if (removed > 0) console.info(JSON.stringify({ event: "sessions.swept", removed }));
    } catch (error) {
      // Not worth taking the server down for: requireSession still refuses any of these sessions.
      console.error("Session sweep failed", error);
    }
  }

  await sweepSessions();
  const sweep = setInterval(() => void sweepSessions(), SWEEP_INTERVAL);
  sweep.unref();

  let shuttingDown = false;
  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(sweep);
    setTimeout(() => process.exit(1), 10_000).unref();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
    process.exit(0);
  }

  process.on("SIGINT", () => void shutdown()); // Ctrl+C
  process.on("SIGTERM", () => void shutdown()); // kill command
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  await pool.end();
  process.exit(1);
}
