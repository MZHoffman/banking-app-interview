import { describe, expect, it } from "vitest";
import { formatEditingMoney, formatMinor, validateMoney } from "./money";

describe("money presentation", () => {
  it("formats minor units as GBP", () => {
    expect(formatMinor("125034")).toBe("£1,250.34");
    expect(formatMinor("0")).toBe("£0.00");
  });

  it("formats valid editing values on blur", () => {
    expect(formatEditingMoney("12")).toBe("12.00");
    expect(formatEditingMoney("12.3")).toBe("12.30");
  });

  it.each(["", "0", "-1", "1,000", "1e3", "1.234"])("rejects %j", (value) => {
    expect(validateMoney(value)).toBeTruthy();
  });
});
