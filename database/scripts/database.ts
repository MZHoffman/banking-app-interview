import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { hashPassword } from "../../server/src/security/password.ts";

const { Client } = pg;
const migrationsDirectory = fileURLToPath(new URL("../migrations", import.meta.url));

export async function createDatabase(adminUrl: string, databaseName: string): Promise<void> {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const existing = await client.query<{ exists: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS exists",
      [databaseName],
    );
    if (!existing.rows[0]?.exists) {
      const quoted = `"${databaseName.replaceAll('"', '""')}"`;
      await client.query(`CREATE DATABASE ${quoted}`);
      console.log(`Created database ${databaseName}`);
    }
  } finally {
    await client.end();
  }
}

export async function migrateDatabase(connectionString: string): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const files = (await readdir(migrationsDirectory)).filter((file) => /^\d+_.+\.sql$/.test(file)).sort();

    for (const filename of files) {
      const applied = await client.query("SELECT 1 FROM schema_migrations WHERE filename = $1", [filename]);
      if (applied.rowCount) continue;

      const sql = await readFile(path.join(migrationsDirectory, filename), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations(filename) VALUES ($1)", [filename]);
        await client.query("COMMIT");
        console.log(`Applied migration ${filename}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.end();
  }
}

const fixtures = [
  {
    userId: "11111111-1111-4111-8111-111111111111",
    accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    transactionId: "d1111111-1111-4111-8111-111111111111",
    idempotencyKey: "e1111111-1111-4111-8111-111111111111",
    email: "alex.morgan@example.test",
    firstName: "Alex",
    lastName: "Morgan",
    password: "Demo-Alex!2026",
    accountNumber: "48271",
    balanceMinor: "245075",
  },
  {
    userId: "22222222-2222-4222-8222-222222222222",
    accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
    transactionId: "d2222222-2222-4222-8222-222222222222",
    idempotencyKey: "e2222222-2222-4222-8222-222222222222",
    email: "jamie.chen@example.test",
    firstName: "Jamie",
    lastName: "Chen",
    password: "Demo-Jamie!2026",
    accountNumber: "61504",
    balanceMinor: "89020",
  },
  {
    userId: "33333333-3333-4333-8333-333333333333",
    accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
    transactionId: "d3333333-3333-4333-8333-333333333333",
    idempotencyKey: "e3333333-3333-4333-8333-333333333333",
    email: "samira.patel@example.test",
    firstName: "Samira",
    lastName: "Patel",
    password: "Demo-Samira!2026",
    accountNumber: "93826",
    balanceMinor: "1230000",
  },
] as const;

export async function seedDatabase(connectionString: string): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    for (const fixture of fixtures) {
      const passwordDigest = await hashPassword(fixture.password);
      await client.query(
        `INSERT INTO users(id, email, first_name, last_name, password_digest)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [fixture.userId, fixture.email, fixture.firstName, fixture.lastName, passwordDigest],
      );
      await client.query(
        `INSERT INTO accounts(id, user_id, account_number, balance_minor)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [fixture.accountId, fixture.userId, fixture.accountNumber, fixture.balanceMinor],
      );
      await client.query(
        `INSERT INTO money_transactions(
           id, idempotency_key, type, amount_minor, source_account_id,
           destination_account_id, initiated_by_user_id, balance_after_minor
         ) VALUES ($1, $2, 'deposit', $3, NULL, $4, $5, $3)
         ON CONFLICT (id) DO NOTHING`,
        [fixture.transactionId, fixture.idempotencyKey, fixture.balanceMinor, fixture.accountId, fixture.userId],
      );
    }
    await client.query("COMMIT");
    console.log("Seeded demo users and accounts");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

export async function resetDatabase(connectionString: string): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("DROP SCHEMA public CASCADE");
    await client.query("CREATE SCHEMA public");
  } finally {
    await client.end();
  }
}
