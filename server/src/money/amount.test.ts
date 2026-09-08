import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import { parseAmountMinor } from "./amount.js";

describe("parseAmountMinor", () => {
  it.each([
    ["1", 100n],
    ["1.2", 120n],
    ["1.20", 120n],
    ["0.01", 1n],
    ["123456.78", 12_345_678n],
  ])("parses %s without floating-point arithmetic", (input, expected) => {
    expect(parseAmountMinor(input)).toBe(expected);
  });

  it.each(["", "0", "0.00", "-1", "+1", " 1", "1 ", "1,000", "1e3", ".50", "01.00", "1.234"])("rejects %j", (input) =>
    expect(() => parseAmountMinor(input)).toThrow(AppError),
  );
});
