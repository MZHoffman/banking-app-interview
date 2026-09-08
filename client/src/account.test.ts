import { describe, expect, it } from "vitest";
import { validateAccountNumber } from "./account";

describe("account number validation", () => {
  it.each(["48271", "61504", "93826"])("accepts %s", (value) => {
    expect(validateAccountNumber(value)).toBeUndefined();
  });

  it.each(["", "4827", "04827", "482710", "4827a", " 48271", "48271 "])("rejects %j", (value) => {
    expect(validateAccountNumber(value)).toBeTruthy();
  });
});
