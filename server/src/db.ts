import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
});

export async function assertDatabaseReady(): Promise<void> {
  const res = await pool.query<{ exists: string | null }>("SELECT to_regclass('public.users') AS exists");
  if (!res.rows[0]?.exists) {
    throw new Error("Database schema is missing. Run `npm run db:setup` from the repository root.");
  }
}
