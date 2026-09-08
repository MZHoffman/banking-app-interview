// The product name shown for the single account each user holds. Presentation copy
// rather than data, so the API does not invent it beside real account fields.
export const ACCOUNT_NAME = "Current Account";

// Mirrors the server rule (server/src/app.ts) so the transfer form can reject
// an obviously wrong number without a round trip. The server checks again anyway.
const ACCOUNT_NUMBER_PATTERN = /^[1-9][0-9]{4}$/;

export function validateAccountNumber(value: string): string | undefined {
  return ACCOUNT_NUMBER_PATTERN.test(value) ? undefined : "Enter a valid five-digit account number.";
}
