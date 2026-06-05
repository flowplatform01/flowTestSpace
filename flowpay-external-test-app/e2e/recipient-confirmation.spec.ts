import { expect, test } from "@playwright/test";
import { completeEmbeddedCheckout, paymentForm, readJsonPanel, uniqueRef, waitForMerchantReady } from "./helpers";

test.describe("Recipient confirmation governance", () => {
  test("merchant creates recipient and payout owner confirms via FlowPay link", async ({ page, context }) => {
    await waitForMerchantReady(page);

    const recipientId = uniqueRef("e2e-recipient");
    await page.locator('#recipientForm [name="externalRecipientId"]').fill(recipientId);
    await page.locator('#recipientForm [name="displayName"]').fill("E2E Panama School");
    await page.locator('#recipientForm [name="payoutTarget"]').fill("+237677777777");
    await page.locator('#recipientForm button[type="submit"]').click();

    const recipientPayload = await readJsonPanel(page, "#recipientResult");
    expect(recipientPayload.ok).toBe(true);
    expect(recipientPayload.result?.confirmationUrl).toMatch(/\/recipient-confirm\//);
    expect(recipientPayload.result?.status).toBe("PENDING");

    const confirmationUrl = recipientPayload.result.confirmationUrl as string;
    await expect(page.locator("#recipientConfirmationUrl")).toContainText("/recipient-confirm/");

    const recipientPage = await context.newPage();
    await recipientPage.goto(confirmationUrl, { waitUntil: "networkidle" });
    await expect(recipientPage.getByRole("heading", { name: /Action Required|Account Confirmed/i })).toBeVisible({
      timeout: 60_000
    });

    if (await recipientPage.getByRole("heading", { name: "Action Required" }).isVisible()) {
      await expect(recipientPage.getByText("+237677777777")).toBeVisible();
      await recipientPage.getByRole("button", { name: "Yes, this is my account" }).click();
      await expect(recipientPage.getByRole("heading", { name: "Account Confirmed" })).toBeVisible({ timeout: 30_000 });
    }
    await recipientPage.close();

    await paymentForm(page).locator('[name="scenarioId"]').selectOption("custom");
    await paymentForm(page).locator('[name="amount"]').fill("1800");
    await paymentForm(page).locator('[name="paymentMethod"]').selectOption("MTN_MOMO");
    await paymentForm(page).locator('[name="externalRecipientReference"]').fill(recipientPayload.result.savedRecipientId);
    await paymentForm(page).locator('[name="recipientName"]').fill("E2E Panama School");
    await paymentForm(page).locator('[name="externalReference"]').fill(uniqueRef("e2e-transfer"));
    await page.getByRole("button", { name: "Open Checkout" }).click();

    const paymentPayload = await readJsonPanel(page, "#result");
    expect(paymentPayload.ok).toBe(true);
    expect(paymentPayload.result?.status).toBe("PENDING");

    await completeEmbeddedCheckout(page);
    await expect(page.locator("#result")).toContainText('"status": "SUCCEEDED"', { timeout: 15_000 });
  });
});
