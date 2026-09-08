import { AppError } from "../errors.js";

const MAX_BIGINT = 9_223_372_036_854_775_807n;
// The authoritative amount format. client/src/money.ts repeats it for fast form
// feedback; every amount is re-parsed here whatever the client sent.
const MONEY_PATTERN = /^(?:0|[1-9]\d*)(?:\.(\d{1,2}))?$/; // no more than two decimal places

export function parseAmountMinor(input: string): bigint {
  const match = MONEY_PATTERN.exec(input);
  if (!match) {
    throw new AppError(400, "VALIDATION_ERROR", "Enter a valid amount with no more than two decimal places.", {
      amount: "Enter a valid amount with no more than two decimal places.",
    });
  }

  const [major = "0", fraction = ""] = input.split(".");
  const value = BigInt(major) * 100n + BigInt(fraction.padEnd(2, "0")); // avoid floating point errs
  if (value <= 0n) {
    throw new AppError(400, "VALIDATION_ERROR", "Amount must be greater than zero.", {
      amount: "Amount must be greater than zero.",
    });
  }
  if (value > MAX_BIGINT) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "This amount exceeds the maximum your account can process. Enter a smaller amount.",
      {
        amount: "This amount exceeds the maximum your account can process. Enter a smaller amount.",
      },
    );
  }
  return value;
}

export function ensureBigintRange(value: bigint): void {
  if (value > MAX_BIGINT) {
    throw new AppError(400, "VALIDATION_ERROR", "The resulting balance is outside the supported numeric range.");
  }
}
