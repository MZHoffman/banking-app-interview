import { test, expect } from "@playwright/test";
import { restoreFixtureState } from "../database/scripts/test-state";
import { connectedDatabaseUrl } from "../database/scripts/config";

async function signIn(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/account$/);
}

test.beforeEach(async () => {
  await restoreFixtureState(connectedDatabaseUrl);
});

test("Alex deposits and withdraws exact amounts", async ({ page }) => {
  await signIn(page, "alex.morgan@example.test", "Demo-Alex!2026");
  await expect(page.getByText("£2,450.75")).toBeVisible();

  await page.getByRole("link", { name: "Deposit" }).click();
  await page.getByLabel("Amount").fill("10.25");
  await page.getByRole("button", { name: "Deposit money" }).click();
  await expect(page.getByText("£2,461.00")).toBeVisible();

  await page.getByRole("link", { name: "Withdraw" }).click();
  await page.getByLabel("Amount").fill("1.00");
  await page.getByRole("button", { name: "Withdraw money" }).click();
  await expect(page.getByText("£2,460.00")).toBeVisible();
});

test("Alex transfers to Jamie and Jamie receives the funds", async ({ page }) => {
  await signIn(page, "alex.morgan@example.test", "Demo-Alex!2026");
  await page.getByRole("link", { name: "Transfer" }).click();
  await page.getByLabel("Recipient account number").fill("61504");
  await page.getByLabel("Amount").fill("25.50");
  await page.getByRole("button", { name: "Review transfer" }).click();
  await expect(page.getByText("Jamie Chen")).toBeVisible();
  await expect(page.getByText("Transferred funds may not be recoverable.")).toBeVisible();
  await page.getByRole("button", { name: "Confirm and send" }).click();
  await expect(page.getByText(/Sent £25.50 to Jamie Chen/)).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();

  await signIn(page, "jamie.chen@example.test", "Demo-Jamie!2026");
  await expect(page.getByText("£915.70")).toBeVisible();
});

test("Alex is told why a transfer cannot go through, and nothing moves", async ({ page }) => {
  await signIn(page, "alex.morgan@example.test", "Demo-Alex!2026");
  await page.getByRole("link", { name: "Transfer" }).click();

  // A malformed account number never reaches the server.
  await page.getByLabel("Recipient account number").fill("4827");
  await page.getByLabel("Amount").fill("10.00");
  await page.getByRole("button", { name: "Review transfer" }).click();
  await expect(page.getByText("Enter a valid five-digit account number.")).toBeVisible();

  // A well-formed number nobody holds is the server's answer to give.
  await page.getByLabel("Recipient account number").fill("99999");
  await page.getByRole("button", { name: "Review transfer" }).click();
  await expect(page.getByText("That recipient is unavailable.")).toBeVisible();

  // More than the balance passes the preview and is refused at the confirmation,
  // where the funds are checked under the row lock.
  await page.getByLabel("Recipient account number").fill("61504");
  await page.getByLabel("Amount").fill("9999.00");
  await page.getByRole("button", { name: "Review transfer" }).click();
  await expect(page.getByRole("heading", { name: "Check before you send" })).toBeVisible();
  await page.getByRole("button", { name: "Confirm and send" }).click();
  await expect(page.getByText("Your account does not have enough available funds.")).toBeVisible();

  await page.getByRole("link", { name: "Back to account" }).click();
  await expect(page.getByText("£2,450.75")).toBeVisible();
});
