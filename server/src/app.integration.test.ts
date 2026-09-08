import { randomUUID } from "node:crypto";
import request, { type Agent } from "supertest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { restoreFixtureState } from "../../database/scripts/test-state.js";
import { createApp } from "./app.js";
import { deleteExpiredSessions } from "./security/session.js";
import { config } from "./config.js";
import { pool } from "./db.js";

const origin = { Origin: "http://localhost:47831" };
const credentials = {
  alex: { email: "alex.morgan@example.test", password: "Demo-Alex!2026" },
  jamie: { email: "jamie.chen@example.test", password: "Demo-Jamie!2026" },
};

let app: Awaited<ReturnType<typeof createApp>>;

async function signIn(agent: Agent, user: keyof typeof credentials = "alex") {
  const res = await agent.post("/api/auth/sign-in").set(origin).send(credentials[user]);
  expect(res.status).toBe(200);
  return res;
}

beforeAll(async () => {
  const schema = await pool.query<{ exists: string | null }>("SELECT to_regclass('public.users') AS exists");
  if (!schema.rows[0]?.exists) throw new Error("Test schema missing. Run npm run db:setup.");
});

beforeEach(async () => {
  await restoreFixtureState(config.databaseUrl);
  app = await createApp(pool);
});

describe("authentication and authorization", () => {
  it("rejects unauthenticated account access", async () => {
    const res = await request(app).get("/api/account");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("AUTHENTICATION_REQUIRED");
  });

  it("does not distinguish an unknown email from a wrong password", async () => {
    const unknown = await request(app)
      .post("/api/auth/sign-in")
      .set(origin)
      .send({ email: "nobody@example.test", password: "wrong" });
    const wrong = await request(app)
      .post("/api/auth/sign-in")
      .set(origin)
      .send({ email: credentials.alex.email, password: "wrong" });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    // Each error carries its own request id, so compare everything else.
    const { requestId: unknownId, ...unknownError } = unknown.body.error;
    const { requestId: wrongId, ...wrongError } = wrong.body.error;
    expect(unknownError).toEqual(wrongError);
    expect(typeof unknownId).toBe("string");
    expect(typeof wrongId).toBe("string");
    expect(unknownId).not.toBe(wrongId);
  });

  it("ignores browser identity claims and rejects unexpected fields", async () => {
    const agent = request.agent(app);
    await signIn(agent);
    const res = await agent.post("/api/deposits").set(origin).send({
      amount: "1.00",
      idempotencyKey: randomUUID(),
      userId: "22222222-2222-4222-8222-222222222222",
    });
    expect(res.status).toBe(400);
    const balances = await pool.query<{ account_number: string; balance_minor: string }>(
      "SELECT account_number, balance_minor FROM accounts ORDER BY account_number",
    );
    expect(balances.rows.find((row) => row.account_number === "61504")?.balance_minor).toBe("89020");
  });

  it("revokes a session on sign out", async () => {
    const agent = request.agent(app);
    await signIn(agent);
    expect((await agent.get("/api/account")).status).toBe(200);
    expect((await agent.post("/api/auth/sign-out").set(origin)).status).toBe(204);
    expect((await agent.get("/api/account")).status).toBe(401);
  });

  it("rejects an idle session with the dedicated expiry response", async () => {
    const agent = request.agent(app);
    await signIn(agent);
    await pool.query("UPDATE sessions SET last_activity_at = CURRENT_TIMESTAMP - INTERVAL '11 minutes'");
    const res = await agent.get("/api/account");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("SESSION_EXPIRED");
    expect((await pool.query("SELECT 1 FROM sessions")).rowCount).toBe(0);
  });

  it("rejects state changes from another origin", async () => {
    const res = await request(app)
      .post("/api/auth/sign-in")
      .set({ Origin: "https://attacker.test" })
      .send(credentials.alex);
    expect(res.status).toBe(403);
  });
});

describe("money operations", () => {
  it("deposits and withdraws exact minor units and creates records", async () => {
    const agent = request.agent(app);
    await signIn(agent);
    const deposit = await agent
      .post("/api/deposits")
      .set(origin)
      .send({ amount: "10.05", idempotencyKey: randomUUID() });
    expect(deposit.status).toBe(200);
    expect(deposit.body.result).toEqual({ amountMinor: "1005", balanceMinor: "246080" });

    const withdrawal = await agent
      .post("/api/withdrawals")
      .set(origin)
      .send({ amount: "0.05", idempotencyKey: randomUUID() });
    expect(withdrawal.body.result).toEqual({ amountMinor: "5", balanceMinor: "246075" });
    const records = await pool.query("SELECT 1 FROM money_transactions WHERE initiated_by_user_id = $1", [
      "11111111-1111-4111-8111-111111111111",
    ]);
    expect(records.rowCount).toBe(3);
  });

  it("rolls back a withdrawal that would overdraw", async () => {
    const agent = request.agent(app);
    await signIn(agent);
    const res = await agent
      .post("/api/withdrawals")
      .set(origin)
      .send({ amount: "2450.76", idempotencyKey: randomUUID() });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INSUFFICIENT_FUNDS");
    const account = await pool.query<{ balance_minor: string }>(
      "SELECT balance_minor FROM accounts WHERE account_number = '48271'",
    );
    expect(account.rows[0]?.balance_minor).toBe("245075");
  });

  it("transfers atomically and records the resulting sender balance", async () => {
    const agent = request.agent(app);
    await signIn(agent);
    const preview = await agent
      .post("/api/transfers/preview")
      .set(origin)
      .send({ amount: "25.50", recipientAccountNumber: "61504" });
    expect(preview.body.preview.recipient).toEqual({ name: "Jamie Chen", accountNumber: "61504" });

    const res = await agent.post("/api/transfers").set(origin).send({
      amount: "25.50",
      recipientAccountNumber: "61504",
      idempotencyKey: randomUUID(),
    });
    expect(res.status).toBe(200);
    expect(res.body.result).toEqual({
      amountMinor: "2550",
      balanceMinor: "242525",
      recipient: { name: "Jamie Chen", accountNumber: "61504" },
    });
    const balances = await pool.query<{ account_number: string; balance_minor: string }>(
      "SELECT account_number, balance_minor FROM accounts WHERE account_number IN ('48271', '61504') ORDER BY account_number",
    );
    expect(balances.rows).toEqual([
      { account_number: "48271", balance_minor: "242525" },
      { account_number: "61504", balance_minor: "91570" },
    ]);
    const record = await pool.query<{ balance_after_minor: string }>(
      "SELECT balance_after_minor FROM money_transactions WHERE type = 'transfer'",
    );
    expect(record.rows[0]?.balance_after_minor).toBe("242525");
  });

  it("changes neither account when a transfer fails", async () => {
    const agent = request.agent(app);
    await signIn(agent);
    const res = await agent.post("/api/transfers").set(origin).send({
      amount: "2450.76",
      recipientAccountNumber: "61504",
      idempotencyKey: randomUUID(),
    });
    expect(res.status).toBe(409);
    const balances = await pool.query<{ account_number: string; balance_minor: string }>(
      "SELECT account_number, balance_minor FROM accounts WHERE account_number IN ('48271', '61504') ORDER BY account_number",
    );
    expect(balances.rows).toEqual([
      { account_number: "48271", balance_minor: "245075" },
      { account_number: "61504", balance_minor: "89020" },
    ]);
    expect((await pool.query("SELECT 1 FROM money_transactions WHERE type = 'transfer'")).rowCount).toBe(0);
  });

  it("moves money once for an identical idempotent retry", async () => {
    const agent = request.agent(app);
    await signIn(agent);
    const key = randomUUID();
    const operation = { amount: "100.00", recipientAccountNumber: "61504", idempotencyKey: key };
    const first = await agent.post("/api/transfers").set(origin).send(operation);
    const retry = await agent.post("/api/transfers").set(origin).send(operation);
    expect(retry.body).toEqual(first.body);
    expect((await pool.query("SELECT 1 FROM money_transactions WHERE idempotency_key = $1", [key])).rowCount).toBe(1);
  });

  it("rejects a changed operation that reuses an idempotency key", async () => {
    const agent = request.agent(app);
    await signIn(agent);
    const key = randomUUID();
    await agent.post("/api/deposits").set(origin).send({ amount: "1.00", idempotencyKey: key });
    const res = await agent.post("/api/deposits").set(origin).send({ amount: "2.00", idempotencyKey: key });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("allows only one of two concurrent withdrawals that would jointly overdraw", async () => {
    const firstAgent = request.agent(app);
    const secondAgent = request.agent(app);
    await Promise.all([signIn(firstAgent), signIn(secondAgent)]);
    const [first, second] = await Promise.all([
      firstAgent.post("/api/withdrawals").set(origin).send({ amount: "2000.00", idempotencyKey: randomUUID() }),
      secondAgent.post("/api/withdrawals").set(origin).send({ amount: "2000.00", idempotencyKey: randomUUID() }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const account = await pool.query<{ balance_minor: string }>(
      "SELECT balance_minor FROM accounts WHERE account_number = '48271'",
    );
    expect(account.rows[0]?.balance_minor).toBe("45075");
  });

  it("completes opposite-direction transfers without deadlock", async () => {
    const alex = request.agent(app);
    const jamie = request.agent(app);
    await Promise.all([signIn(alex, "alex"), signIn(jamie, "jamie")]);
    const [toJamie, toAlex] = await Promise.all([
      alex
        .post("/api/transfers")
        .set(origin)
        .send({ amount: "1.00", recipientAccountNumber: "61504", idempotencyKey: randomUUID() }),
      jamie
        .post("/api/transfers")
        .set(origin)
        .send({ amount: "1.00", recipientAccountNumber: "48271", idempotencyKey: randomUUID() }),
    ]);
    expect(toJamie.status).toBe(200);
    expect(toAlex.status).toBe(200);
  });
});

describe("database and abuse controls", () => {
  it("sweeps expired sessions and leaves idle ones for their absolute expiry", async () => {
    const alex = request.agent(app);
    const jamie = request.agent(app);
    await signIn(alex, "alex");
    await signIn(jamie, "jamie");

    // Jamie's is past its absolute expiry; created_at moves too so the
    // sessions_expiry_after_creation constraint still holds.
    const expired = await pool.query(
      `UPDATE sessions
          SET created_at = CURRENT_TIMESTAMP - INTERVAL '9 hours',
              expires_at = CURRENT_TIMESTAMP - INTERVAL '1 hour'
        WHERE user_id = (SELECT id FROM users WHERE email = $1)`,
      [credentials.jamie.email],
    );
    expect(expired.rowCount).toBe(1);

    // Alex's is idle, so unusable, but not yet past its absolute expiry. The sweep
    // leaves it; requireSession is what rejects it.
    await pool.query(
      `UPDATE sessions SET last_activity_at = CURRENT_TIMESTAMP - INTERVAL '11 minutes'
        WHERE user_id = (SELECT id FROM users WHERE email = $1)`,
      [credentials.alex.email],
    );

    expect(await deleteExpiredSessions(pool)).toBe(1);

    const remaining = await pool.query<{ email: string }>(
      "SELECT u.email FROM sessions s JOIN users u ON u.id = s.user_id",
    );
    expect(remaining.rows.map((row) => row.email)).toEqual([credentials.alex.email]);

    // The surviving idle session is still refused.
    const refused = await alex.get("/api/account").set(origin);
    expect(refused.status).toBe(401);
    expect(refused.body.error.code).toBe("SESSION_EXPIRED");
  });

  it("enforces transaction shape constraints in PostgreSQL", async () => {
    await expect(
      pool.query(
        `INSERT INTO money_transactions(
         id, idempotency_key, type, amount_minor, source_account_id,
         destination_account_id, initiated_by_user_id, balance_after_minor
       ) VALUES ($1, $2, 'transfer', 100, NULL, NULL, $3, 0)`,
        [randomUUID(), randomUUID(), "11111111-1111-4111-8111-111111111111"],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("rate limits repeated failed sign-in attempts", async () => {
    const attempts = [];
    for (let index = 0; index < 6; index += 1) {
      attempts.push(
        await request(app)
          .post("/api/auth/sign-in")
          .set(origin)
          .send({ email: credentials.alex.email, password: "wrong" }),
      );
    }
    expect(attempts.at(-1)?.status).toBe(429);
    expect(attempts.at(-1)?.body.error.code).toBe("RATE_LIMITED");
  });

  it("rate limits recipient enumeration attempts", async () => {
    const agent = request.agent(app);
    await signIn(agent);
    let last;
    for (let index = 0; index < 21; index += 1) {
      last = await agent.post("/api/transfers/preview").set(origin).send({
        amount: "1.00",
        recipientAccountNumber: "61504",
      });
    }
    expect(last?.status).toBe(429);
    expect(last?.body.error.code).toBe("RATE_LIMITED");
  });
});
