// Mirrors the server rule (server/src/money/amount.ts) so the form can reject bad
// input without a round trip. The server re-parses every amount anyway.
const PATTERN = /^(?:0|[1-9]\d*)(?:\.(\d{1,2}))?$/;

export function validateMoney(value: string): string | undefined {
  if (!PATTERN.test(value)) return "Enter a valid amount with no more than two decimal places.";
  const [major = "0", fraction = ""] = value.split(".");
  const minor = BigInt(major) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (minor <= 0n) return "Amount must be greater than zero.";
  return undefined;
}

export function formatEditingMoney(value: string): string {
  if (!PATTERN.test(value)) return value;
  const [major, fraction = ""] = value.split(".");
  return `${major}.${fraction.padEnd(2, "0")}`;
}

export function formatMinor(value: string): string {
  const minor = BigInt(value);
  const pounds = minor / 100n;
  const pence = (minor % 100n).toString().padStart(2, "0");
  return `£${new Intl.NumberFormat("en-GB").format(pounds)}.${pence}`;
}
