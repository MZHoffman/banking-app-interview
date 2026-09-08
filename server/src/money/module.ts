import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { AppError } from "../errors.js";
import { ensureBigintRange, parseAmountMinor } from "./amount.js";

type MoneyType = "deposit" | "withdrawal" | "transfer";

type AccountRow = {
  id: string;
  user_id: string;
  account_number: string;
  balance_minor: string;
  first_name: string;
  last_name: string;
};

type ExistingTransaction = {
  type: MoneyType;
  amount_minor: string;
  source_account_id: string | null;
  destination_account_id: string | null;
  initiated_by_user_id: string;
  balance_after_minor: string;
  recipient_first_name: string | null;
  recipient_last_name: string | null;
  recipient_account_number: string | null;
};

export type MoneyResult = { balanceMinor: string; amountMinor: string };
export type TransferResult = MoneyResult & {
  recipient: { name: string; accountNumber: string };
};
export type TransferPreview = {
  amountMinor: string;
  recipient: { name: string; accountNumber: string };
};

async function findExisting(client: PoolClient, key: string): Promise<ExistingTransaction | undefined> {
  const res = await client.query<ExistingTransaction>(
    `SELECT mt.type, mt.amount_minor, mt.source_account_id, mt.destination_account_id,
            mt.initiated_by_user_id, mt.balance_after_minor,
            recipient.first_name AS recipient_first_name,
            recipient.last_name AS recipient_last_name,
            destination.account_number AS recipient_account_number
     FROM money_transactions mt
     LEFT JOIN accounts destination ON destination.id = mt.destination_account_id
     LEFT JOIN users recipient ON recipient.id = destination.user_id
     WHERE mt.idempotency_key = $1`,
    [key],
  );
  return res.rows[0];
}

type ExpectedTransaction = {
  type: MoneyType;
  amount: bigint;
  sourceId: string | null;
  destinationId: string | null;
  userId: string;
};

// Replay a recorded transaction only when every field matches. The same key carrying
// different data means the caller reused it by mistake, and echoing the old result
// would confirm an operation that never happened.
function replayOf(existing: ExistingTransaction, expected: ExpectedTransaction): MoneyResult {
  const matches =
    existing.type === expected.type &&
    existing.amount_minor === expected.amount.toString() &&
    existing.source_account_id === expected.sourceId &&
    existing.destination_account_id === expected.destinationId &&
    existing.initiated_by_user_id === expected.userId;
  if (!matches) {
    throw new AppError(409, "IDEMPOTENCY_CONFLICT", "This operation key has already been used for another request.");
  }

  return { balanceMinor: existing.balance_after_minor, amountMinor: existing.amount_minor };
}

function replayOfTransfer(existing: ExistingTransaction, expected: ExpectedTransaction): TransferResult {
  const base = replayOf(existing, expected);
  if (!existing.recipient_first_name || !existing.recipient_last_name || !existing.recipient_account_number) {
    throw new Error("Transfer recipient data is missing");
  }
  return {
    ...base,
    recipient: {
      name: `${existing.recipient_first_name} ${existing.recipient_last_name}`,
      accountNumber: existing.recipient_account_number,
    },
  };
}

async function lockOwnAccount(client: PoolClient, userId: string): Promise<AccountRow> {
  const res = await client.query<AccountRow>(
    `SELECT a.id, a.user_id, a.account_number, a.balance_minor, u.first_name, u.last_name
     FROM accounts a JOIN users u ON u.id = a.user_id
     WHERE a.user_id = $1 FOR UPDATE OF a`,
    [userId],
  );
  const account = res.rows[0];
  if (!account) throw new AppError(404, "NOT_FOUND", "The account could not be found.");
  return account;
}

export function createMoneyModule(pool: Pool) {
  async function runOperation(input: {
    userId: string;
    amount: string;
    idempotencyKey: string;
    type: "deposit" | "withdrawal";
  }): Promise<MoneyResult> {
    const amount = parseAmountMinor(input.amount);
    const client = await pool.connect();
    try {
      await client.query("BEGIN"); // start transaction
      const account = await lockOwnAccount(client, input.userId);
      const sourceId = input.type === "withdrawal" ? account.id : null;
      const destinationId = input.type === "deposit" ? account.id : null;
      const existing = await findExisting(client, input.idempotencyKey);
      if (existing) {
        const res = replayOf(existing, {
          type: input.type,
          amount,
          sourceId,
          destinationId,
          userId: input.userId,
        });
        await client.query("COMMIT"); // commit transaction
        return res;
      }

      const current = BigInt(account.balance_minor);
      if (input.type === "withdrawal" && amount > current) {
        throw new AppError(409, "INSUFFICIENT_FUNDS", "Your account does not have enough available funds.");
      }
      const nextBalance = input.type === "deposit" ? current + amount : current - amount;
      ensureBigintRange(nextBalance);

      await client.query(
        `INSERT INTO money_transactions(
           id, idempotency_key, type, amount_minor, source_account_id,
           destination_account_id, initiated_by_user_id, balance_after_minor
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          randomUUID(),
          input.idempotencyKey,
          input.type,
          amount.toString(),
          sourceId,
          destinationId,
          input.userId,
          nextBalance.toString(),
        ],
      );
      await client.query("UPDATE accounts SET balance_minor = $1 WHERE id = $2", [nextBalance.toString(), account.id]);
      await client.query("COMMIT");
      return { balanceMinor: nextBalance.toString(), amountMinor: amount.toString() };
    } catch (error) {
      await client.query("ROLLBACK");
      // Two requests with the same key can both clear the findExisting check above and
      // race to INSERT. The loser gets unique_violation and resolves into a replay.
      if ((error as { code?: string }).code === "23505") {
        const existing = await findExisting(client, input.idempotencyKey);
        if (existing) {
          const account = await pool.query<{ id: string }>("SELECT id FROM accounts WHERE user_id = $1", [
            input.userId,
          ]);
          const accountId = account.rows[0]?.id ?? null;
          return replayOf(existing, {
            type: input.type,
            amount,
            sourceId: input.type === "withdrawal" ? accountId : null,
            destinationId: input.type === "deposit" ? accountId : null,
            userId: input.userId,
          });
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async function previewTransfer(input: {
    userId: string;
    amount: string;
    recipientAccountNumber: string;
  }): Promise<TransferPreview> {
    const amount = parseAmountMinor(input.amount);
    const res = await pool.query<AccountRow>(
      `SELECT a.id, a.user_id, a.account_number, a.balance_minor, u.first_name, u.last_name
       FROM accounts a JOIN users u ON u.id = a.user_id
       WHERE a.account_number = $1`,
      [input.recipientAccountNumber],
    );
    const recipient = res.rows[0];
    if (!recipient || recipient.user_id === input.userId) {
      throw new AppError(404, "RECIPIENT_UNAVAILABLE", "That recipient is unavailable.");
    }
    return {
      amountMinor: amount.toString(),
      recipient: { name: `${recipient.first_name} ${recipient.last_name}`, accountNumber: recipient.account_number },
    };
  }

  async function transfer(input: {
    userId: string;
    amount: string;
    recipientAccountNumber: string;
    idempotencyKey: string;
  }): Promise<TransferResult> {
    const amount = parseAmountMinor(input.amount);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const ids = await client.query<{ source_id: string; destination_id: string }>(
        `SELECT source.id AS source_id, destination.id AS destination_id
         FROM accounts source
         JOIN accounts destination ON destination.account_number = $2
         WHERE source.user_id = $1 AND destination.user_id <> $1`,
        [input.userId, input.recipientAccountNumber],
      );
      const pair = ids.rows[0];
      if (!pair) throw new AppError(404, "RECIPIENT_UNAVAILABLE", "That recipient is unavailable.");

      const locked = await client.query<AccountRow>(
        `SELECT a.id, a.user_id, a.account_number, a.balance_minor, u.first_name, u.last_name
         FROM accounts a JOIN users u ON u.id = a.user_id
         WHERE a.id = ANY($1::uuid[])
         ORDER BY a.id FOR UPDATE OF a`,
        // Locking in id order keeps two opposite-direction transfers between the same
        // pair of accounts from deadlocking on each other.
        [[pair.source_id, pair.destination_id]],
      );
      const source = locked.rows.find((account) => account.id === pair.source_id);
      const recipient = locked.rows.find((account) => account.id === pair.destination_id);
      if (!source || !recipient) throw new AppError(404, "RECIPIENT_UNAVAILABLE", "That recipient is unavailable.");

      const existing = await findExisting(client, input.idempotencyKey);
      if (existing) {
        const res = replayOfTransfer(existing, {
          type: "transfer",
          amount,
          sourceId: source.id,
          destinationId: recipient.id,
          userId: input.userId,
        });
        await client.query("COMMIT");
        return res;
      }

      const sourceBalance = BigInt(source.balance_minor);
      if (amount > sourceBalance) {
        throw new AppError(409, "INSUFFICIENT_FUNDS", "Your account does not have enough available funds.");
      }
      const sourceAfter = sourceBalance - amount;
      const destinationAfter = BigInt(recipient.balance_minor) + amount;
      ensureBigintRange(destinationAfter);

      await client.query(
        `INSERT INTO money_transactions(
           id, idempotency_key, type, amount_minor, source_account_id,
           destination_account_id, initiated_by_user_id, balance_after_minor
         ) VALUES ($1, $2, 'transfer', $3, $4, $5, $6, $7)`,
        [
          randomUUID(),
          input.idempotencyKey,
          amount.toString(),
          source.id,
          recipient.id,
          input.userId,
          sourceAfter.toString(),
        ],
      );
      await client.query("UPDATE accounts SET balance_minor = $1 WHERE id = $2", [sourceAfter.toString(), source.id]);
      await client.query("UPDATE accounts SET balance_minor = $1 WHERE id = $2", [
        destinationAfter.toString(),
        recipient.id,
      ]);
      await client.query("COMMIT");
      return {
        balanceMinor: sourceAfter.toString(),
        amountMinor: amount.toString(),
        recipient: { name: `${recipient.first_name} ${recipient.last_name}`, accountNumber: recipient.account_number },
      };
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "23505") {
        // duplicate key error
        const existing = await findExisting(client, input.idempotencyKey);
        if (existing) {
          const accounts = await pool.query<{ source_id: string; destination_id: string }>(
            `SELECT source.id AS source_id, destination.id AS destination_id
             FROM accounts source JOIN accounts destination ON destination.account_number = $2
             WHERE source.user_id = $1`,
            [input.userId, input.recipientAccountNumber],
          );
          const pair = accounts.rows[0];
          if (pair) {
            return replayOfTransfer(existing, {
              type: "transfer",
              amount,
              sourceId: pair.source_id,
              destinationId: pair.destination_id,
              userId: input.userId,
            });
          }
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    deposit: (input: { userId: string; amount: string; idempotencyKey: string }) =>
      runOperation({ ...input, type: "deposit" }),
    withdraw: (input: { userId: string; amount: string; idempotencyKey: string }) =>
      runOperation({ ...input, type: "withdrawal" }),
    previewTransfer,
    transfer,
  };
}
