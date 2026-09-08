import pg from "pg";

const { Client } = pg;

export async function restoreFixtureState(connectionString: string): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM sessions");
    await client.query(
      `DELETE FROM money_transactions
       WHERE id NOT IN (
         'd1111111-1111-4111-8111-111111111111',
         'd2222222-2222-4222-8222-222222222222',
         'd3333333-3333-4333-8333-333333333333'
       )`,
    );
    await client.query(`
      UPDATE accounts SET balance_minor = CASE account_number
        WHEN '48271' THEN 245075
        WHEN '61504' THEN 89020
        WHEN '93826' THEN 1230000
      END
    `);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}
