import { randomUUID } from "node:crypto";
import request, { type Agent } from "supertest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { restoreFixtureState } from "../../database/scripts/test-state.js";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db.js";

// Transfers are the only operation that touches two accounts, so they carry every
// failure the single-account operations have plus a recipient that can be missing,
// yourself, or unaffordable. app.integration.test.ts covers the happy path and the
// locking; this file is the error surface around it.

const origin = { Origin: "http://localhost:47831" };
const credentials = {
  alex: { email: "alex.morgan@example.test", password: "Demo-Alex!2026" },
  jamie: { email: "jamie.chen@example.test", password: "Demo-Jamie!2026" },
};

// The seeded accounts, and the balances restoreFixtureState puts back before each test.
const account = { alex: "48271", jamie: "61504", samira: "93826" } as const;
const opening = { alex: "245075", jamie: "89020", samira: "1230000" } as const;
const alexUserId = "11111111-1111-4111-8111-111111111111";
const alexAccountId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const jamieAccountId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const MAX_BIGINT = "9223372036854775807";

type TransferBody = {
  amount?: string;
  recipientAccountNumber?: string;
  idempotencyKey?: string;
  [field: string]: unknown;
};

let app: Awaited<ReturnType<typeof createApp>>;

async function signedInAs(user: keyof typeof credentials = "alex"): Promise<Agent> {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/sign-in").set(origin).send(credentials[user]);
  expect(res.status).toBe(200);
  return agent;
}

// A transfer Alex can afford, with a fresh key. Tests override only the field under test.
function transferOf(overrides: TransferBody = {}) {
  return {
    amount: "10.00",
    recipientAccountNumber: account.jamie,
    idempotencyKey: randomUUID(),
    ...overrides,
  };
}

function previewOf(overrides: TransferBody = {}) {
  return { amount: "10.00", recipientAccountNumber: account.jamie, ...overrides };
}

async function balances(): Promise<Record<string, string>> {
  const res = await pool.query<{ account_number: string; balance_minor: string }>(
    "SELECT account_number, balance_minor FROM accounts",
  );
  return Object.fromEntries(res.rows.map((row) => [row.account_number, row.balance_minor]));
}

async function transferRows() {
  const res = await pool.query(
    `SELECT type, amount_minor, source_account_id, destination_account_id,
            initiated_by_user_id, balance_after_minor
     FROM money_transactions WHERE type = 'transfer'`,
  );
  return res.rows;
}

beforeAll(async () => {
  const schema = await pool.query<{ exists: string | null }>("SELECT to_regclass('public.users') AS exists");
  if (!schema.rows[0]?.exists) throw new Error("Test schema missing. Run npm run db:setup.");
});

beforeEach(async () => {
  await restoreFixtureState(config.databaseUrl);
  app = await createApp(pool);
});

describe("transfer authorization", () => {
  it("refuses an unauthenticated transfer and preview", async () => {
    const transfer = await request(app).post("/api/transfers").set(origin).send(transferOf());
    const preview = await request(app).post("/api/transfers/preview").set(origin).send(previewOf());
    expect([transfer.status, preview.status]).toEqual([401, 401]);
    expect(transfer.body.error.code).toBe("AUTHENTICATION_REQUIRED");
    expect(preview.body.error.code).toBe("AUTHENTICATION_REQUIRED");
    expect(await transferRows()).toEqual([]);
  });

  it("refuses a transfer sent from another origin", async () => {
    const agent = await signedInAs();
    const res = await agent.post("/api/transfers").set({ Origin: "https://attacker.test" }).send(transferOf());
    expect(res.status).toBe(403);
    expect(await transferRows()).toEqual([]);
  });

  it("refuses a transfer on an idle session before touching either balance", async () => {
    const agent = await signedInAs();
    await pool.query("UPDATE sessions SET last_activity_at = CURRENT_TIMESTAMP - INTERVAL '11 minutes'");
    const res = await agent.post("/api/transfers").set(origin).send(transferOf());
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("SESSION_EXPIRED");
    expect(await balances()).toMatchObject({ [account.alex]: opening.alex, [account.jamie]: opening.jamie });
    expect(await transferRows()).toEqual([]);
  });
});

describe("transfer input validation", () => {
  it("refuses a malformed recipient account number", async () => {
    const agent = await signedInAs();
    const malformed = ["4827", "482710", "04827", "abcde", " 48271", ""];
    const outcomes: string[] = [];
    for (const recipientAccountNumber of malformed) {
      const res = await agent.post("/api/transfers").set(origin).send(transferOf({ recipientAccountNumber }));
      const fields = Object.keys(res.body.error.fields ?? {});
      outcomes.push(`${JSON.stringify(recipientAccountNumber)} -> ${res.status} ${res.body.error.code} [${fields}]`);
    }
    expect(outcomes).toEqual(
      malformed.map((value) => `${JSON.stringify(value)} -> 400 VALIDATION_ERROR [recipientAccountNumber]`),
    );
    expect(await transferRows()).toEqual([]);
  });

  it("refuses a malformed amount and says why", async () => {
    const agent = await signedInAs();
    const badFormat = "Enter a valid amount with no more than two decimal places.";
    const cases = [
      { amount: "1.234", message: badFormat },
      { amount: "-5.00", message: badFormat },
      { amount: "1,000", message: badFormat },
      { amount: "1e3", message: badFormat },
      { amount: "abc", message: badFormat },
      { amount: "0", message: "Amount must be greater than zero." },
      { amount: "0.00", message: "Amount must be greater than zero." },
      {
        amount: "92233720368547758.08",
        message: "This amount exceeds the maximum your account can process. Enter a smaller amount.",
      },
    ];
    const outcomes = [];
    for (const { amount } of cases) {
      const res = await agent.post("/api/transfers").set(origin).send(transferOf({ amount }));
      outcomes.push({ amount, status: res.status, message: res.body.error.fields?.amount });
    }
    expect(outcomes).toEqual(cases.map(({ amount, message }) => ({ amount, status: 400, message })));
    expect(await transferRows()).toEqual([]);
  });

  it("refuses an empty amount, a non-uuid key and unknown fields", async () => {
    const agent = await signedInAs();
    const noAmount = await agent
      .post("/api/transfers")
      .set(origin)
      .send(transferOf({ amount: "" }));
    const badKey = await agent
      .post("/api/transfers")
      .set(origin)
      .send(transferOf({ idempotencyKey: "not-a-uuid" }));
    // A caller cannot name the sender: the session decides who is paying.
    const extra = await agent
      .post("/api/transfers")
      .set(origin)
      .send(transferOf({ userId: alexUserId }));
    expect([noAmount.status, badKey.status, extra.status]).toEqual([400, 400, 400]);
    expect(Object.keys(noAmount.body.error.fields)).toEqual(["amount"]);
    expect(Object.keys(badKey.body.error.fields)).toEqual(["idempotencyKey"]);
    expect(extra.body.error.code).toBe("VALIDATION_ERROR");
    expect(await transferRows()).toEqual([]);
  });

  it("reports a bad amount without revealing whether the recipient exists", async () => {
    const agent = await signedInAs();
    const res = await agent
      .post("/api/transfers")
      .set(origin)
      .send(transferOf({ amount: "0", recipientAccountNumber: "99999" }));
    expect(res.status).toBe(400);
    expect(res.body.error.fields.amount).toBe("Amount must be greater than zero.");
  });
});

describe("transfer recipients", () => {
  it("refuses a transfer to your own account", async () => {
    const agent = await signedInAs();
    const res = await agent
      .post("/api/transfers")
      .set(origin)
      .send(transferOf({ recipientAccountNumber: account.alex }));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("RECIPIENT_UNAVAILABLE");
    expect((await balances())[account.alex]).toBe(opening.alex);
    expect(await transferRows()).toEqual([]);
  });

  it("refuses a transfer to an account that does not exist", async () => {
    const agent = await signedInAs();
    const res = await agent
      .post("/api/transfers")
      .set(origin)
      .send(transferOf({ recipientAccountNumber: "99999" }));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("RECIPIENT_UNAVAILABLE");
    expect((await balances())[account.alex]).toBe(opening.alex);
    expect(await transferRows()).toEqual([]);
  });

  it("answers identically for an unknown account and your own", async () => {
    // Two different reasons, one answer, so the endpoint cannot be used to find out
    // which account numbers are real.
    const agent = await signedInAs();
    const unknown = await agent
      .post("/api/transfers")
      .set(origin)
      .send(transferOf({ recipientAccountNumber: "99999" }));
    const own = await agent
      .post("/api/transfers")
      .set(origin)
      .send(transferOf({ recipientAccountNumber: account.alex }));
    const { requestId: unknownId, ...unknownError } = unknown.body.error;
    const { requestId: ownId, ...ownError } = own.body.error;
    expect(unknownError).toEqual(ownError);
    expect(unknownId).not.toBe(ownId);
  });

  it("previews a recipient without moving any money", async () => {
    const agent = await signedInAs();
    const res = await agent
      .post("/api/transfers/preview")
      .set(origin)
      .send(previewOf({ amount: "25.50" }));
    expect(res.status).toBe(200);
    expect(res.body.preview).toEqual({
      amountMinor: "2550",
      recipient: { name: "Jamie Chen", accountNumber: account.jamie },
    });
    expect(await balances()).toMatchObject({ [account.alex]: opening.alex, [account.jamie]: opening.jamie });
    expect(await transferRows()).toEqual([]);
  });

  it("refuses to preview your own account or an unknown one", async () => {
    const agent = await signedInAs();
    const own = await agent
      .post("/api/transfers/preview")
      .set(origin)
      .send(previewOf({ recipientAccountNumber: account.alex }));
    const unknown = await agent
      .post("/api/transfers/preview")
      .set(origin)
      .send(previewOf({ recipientAccountNumber: "99999" }));
    expect([own.status, unknown.status]).toEqual([404, 404]);
    expect([own.body.error.code, unknown.body.error.code]).toEqual(["RECIPIENT_UNAVAILABLE", "RECIPIENT_UNAVAILABLE"]);
  });

  it("previews an amount the sender cannot afford, then declines it at confirmation", async () => {
    // The preview confirms who you are paying, not that you can pay. Funds are
    // checked under the row lock, where the answer cannot go stale.
    const agent = await signedInAs();
    const preview = await agent
      .post("/api/transfers/preview")
      .set(origin)
      .send(previewOf({ amount: "9999.00" }));
    expect(preview.status).toBe(200);
    const res = await agent
      .post("/api/transfers")
      .set(origin)
      .send(transferOf({ amount: "9999.00" }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INSUFFICIENT_FUNDS");
    expect(await balances()).toMatchObject({ [account.alex]: opening.alex, [account.jamie]: opening.jamie });
  });
});

describe("transfer amounts", () => {
  it("moves the smallest amount the API accepts", async () => {
    const agent = await signedInAs();
    const res = await agent
      .post("/api/transfers")
      .set(origin)
      .send(transferOf({ amount: "0.01" }));
    expect(res.status).toBe(200);
    expect(res.body.result.amountMinor).toBe("1");
    expect(await balances()).toMatchObject({ [account.alex]: "245074", [account.jamie]: "89021" });
  });

  it("empties the sender's account when the amount is the whole balance", async () => {
    const agent = await signedInAs();
    const res = await agent
      .post("/api/transfers")
      .set(origin)
      .send(transferOf({ amount: "2450.75" }));
    expect(res.status).toBe(200);
    expect(res.body.result.balanceMinor).toBe("0");
    expect(await balances()).toMatchObject({ [account.alex]: "0", [account.jamie]: "334095" });
  });

  it("refuses a transfer that would overflow the recipient's balance", async () => {
    const agent = await signedInAs();
    await pool.query("UPDATE accounts SET balance_minor = $1 WHERE account_number IN ($2, $3)", [
      MAX_BIGINT,
      account.alex,
      account.jamie,
    ]);
    const res = await agent
      .post("/api/transfers")
      .set(origin)
      .send(transferOf({ amount: "0.01" }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(await balances()).toMatchObject({ [account.alex]: MAX_BIGINT, [account.jamie]: MAX_BIGINT });
    expect(await transferRows()).toEqual([]);
  });
});

describe("transfer records", () => {
  it("records one transaction naming both accounts and the sender's new balance", async () => {
    const agent = await signedInAs();
    const res = await agent
      .post("/api/transfers")
      .set(origin)
      .send(transferOf({ amount: "25.50" }));
    expect(res.status).toBe(200);
    expect(await transferRows()).toEqual([
      {
        type: "transfer",
        amount_minor: "2550",
        source_account_id: alexAccountId,
        destination_account_id: jamieAccountId,
        initiated_by_user_id: alexUserId,
        balance_after_minor: "242525",
      },
    ]);
  });

  it("credits the recipient, who sees the funds on their own account", async () => {
    const alex = await signedInAs("alex");
    expect(
      (
        await alex
          .post("/api/transfers")
          .set(origin)
          .send(transferOf({ amount: "25.50" }))
      ).status,
    ).toBe(200);
    const jamie = await signedInAs("jamie");
    const res = await jamie.get("/api/account");
    expect(res.status).toBe(200);
    expect(res.body.account).toEqual({
      holderName: "Jamie Chen",
      accountNumber: account.jamie,
      balanceMinor: "91570",
    });
  });
});

describe("transfer idempotency", () => {
  it("refuses a replay that changes the amount", async () => {
    const agent = await signedInAs();
    const idempotencyKey = randomUUID();
    const first = await agent
      .post("/api/transfers")
      .set(origin)
      .send(transferOf({ amount: "10.00", idempotencyKey }));
    expect(first.status).toBe(200);
    const res = await agent
      .post("/api/transfers")
      .set(origin)
      .send(transferOf({ amount: "20.00", idempotencyKey }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(await balances()).toMatchObject({ [account.alex]: "244075", [account.jamie]: "90020" });
    expect(await transferRows()).toHaveLength(1);
  });

  it("refuses a replay that changes the recipient", async () => {
    const agent = await signedInAs();
    const idempotencyKey = randomUUID();
    const first = await agent.post("/api/transfers").set(origin).send(transferOf({ idempotencyKey }));
    expect(first.status).toBe(200);
    const res = await agent
      .post("/api/transfers")
      .set(origin)
      .send(transferOf({ idempotencyKey, recipientAccountNumber: account.samira }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(await balances()).toMatchObject({ [account.samira]: opening.samira });
    expect(await transferRows()).toHaveLength(1);
  });

  it("refuses a transfer that reuses a deposit's key", async () => {
    const agent = await signedInAs();
    const idempotencyKey = randomUUID();
    const deposit = await agent.post("/api/deposits").set(origin).send({ amount: "10.00", idempotencyKey });
    expect(deposit.status).toBe(200);
    const res = await agent
      .post("/api/transfers")
      .set(origin)
      .send(transferOf({ amount: "10.00", idempotencyKey }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(await transferRows()).toEqual([]);
  });

  it("refuses a deposit that reuses a transfer's key", async () => {
    const agent = await signedInAs();
    const idempotencyKey = randomUUID();
    const transfer = await agent
      .post("/api/transfers")
      .set(origin)
      .send(transferOf({ amount: "10.00", idempotencyKey }));
    expect(transfer.status).toBe(200);
    const res = await agent.post("/api/deposits").set(origin).send({ amount: "10.00", idempotencyKey });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(await balances()).toMatchObject({ [account.alex]: "244075" });
  });

  it("moves money once when the same transfer arrives twice at the same moment", async () => {
    const first = await signedInAs();
    const second = await signedInAs();
    const body = transferOf({ amount: "100.00" });
    const [a, b] = await Promise.all([
      first.post("/api/transfers").set(origin).send(body),
      second.post("/api/transfers").set(origin).send(body),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body).toEqual(b.body);
    expect(await transferRows()).toHaveLength(1);
    expect(await balances()).toMatchObject({ [account.alex]: "235075", [account.jamie]: "99020" });
  });

  it("allows the same amount and recipient again under a fresh key", async () => {
    const agent = await signedInAs();
    const first = await agent
      .post("/api/transfers")
      .set(origin)
      .send(transferOf({ amount: "5.00" }));
    const second = await agent
      .post("/api/transfers")
      .set(origin)
      .send(transferOf({ amount: "5.00" }));
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(second.body.result.balanceMinor).toBe("244075");
    expect(await transferRows()).toHaveLength(2);
  });
});

describe("concurrent transfers", () => {
  it("allows only one of two concurrent transfers that would jointly overdraw", async () => {
    const first = await signedInAs();
    const second = await signedInAs();
    const [a, b] = await Promise.all([
      first
        .post("/api/transfers")
        .set(origin)
        .send(transferOf({ amount: "2000.00" })),
      second
        .post("/api/transfers")
        .set(origin)
        .send(transferOf({ amount: "2000.00" })),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await balances()).toMatchObject({ [account.alex]: "45075", [account.jamie]: "289020" });
    expect(await transferRows()).toHaveLength(1);
  });
});

describe("transfer abuse controls", () => {
  it("rate limits repeated transfer attempts, per user", async () => {
    const agent = await signedInAs();
    const statuses: number[] = [];
    for (let index = 0; index < 21; index += 1) {
      // An amount the API rejects, so the limit is what is under test and the
      // balance never gets in the way.
      const res = await agent
        .post("/api/transfers")
        .set(origin)
        .send(transferOf({ amount: "0" }));
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 20)).toEqual(Array<number>(20).fill(400));
    expect(statuses.at(-1)).toBe(429);

    // The bucket is keyed by user, so Alex hitting the limit cannot lock Jamie out.
    const jamie = await signedInAs("jamie");
    const theirs = await jamie
      .post("/api/transfers/preview")
      .set(origin)
      .send(previewOf({ recipientAccountNumber: account.alex }));
    expect(theirs.status).toBe(200);
  });

  it("counts previews and transfers against the same limit", async () => {
    const agent = await signedInAs();
    for (let index = 0; index < 20; index += 1) {
      const preview = await agent
        .post("/api/transfers/preview")
        .set(origin)
        .send(previewOf({ amount: "1.00" }));
      expect(preview.status).toBe(200);
    }
    const res = await agent
      .post("/api/transfers")
      .set(origin)
      .send(transferOf({ amount: "1.00" }));
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("RATE_LIMITED");
    expect(await transferRows()).toEqual([]);
  });
});
